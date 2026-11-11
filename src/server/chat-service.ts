import { chooseRoute } from "@/src/agent/router";
import { buildRouterPrompt, buildSystemPrompt } from "@/src/agent/prompts";
import { prepareTurn } from "@/src/agent/prepare";
import { runAgentLoop, type AgentModel } from "@/src/agent/loop";
import { validateResponse } from "@/src/agent/validate";
import type { AppConfig } from "@/src/config";
import type { WebSearchTool } from "@/src/search/tool";
import type { TurnStore } from "@/src/store/turns";
import type { RouteType, TurnRecord } from "@/src/types/domain";

export interface ChatRequest {
  userId: string;
  conversationId: string;
  message: string;
  clientTimestamp?: string;
  timeZone?: string;
}

export interface ChatEvent {
  type: "status" | "answer" | "error";
  message: string;
  route?: RouteType;
  flags?: TurnRecord["flags"];
}

export interface ChatServiceDependencies {
  config: AppConfig;
  store: TurnStore;
  routerModel: {
    complete(prompt: string): Promise<string>;
  };
  agentModel: AgentModel;
  searchTool: WebSearchTool;
  clock?: () => Date;
}

export async function runChatTurn(
  request: ChatRequest,
  dependencies: ChatServiceDependencies,
  onEvent?: (event: ChatEvent) => void,
): Promise<ChatEvent> {
  validateChatRequest(request);
  const emit = onEvent ?? (() => undefined);
  const startedAt = Date.now();

  emit({ type: "status", message: "Preparing your conversation context." });
  const preparedTurn = await prepareTurn(
    {
      userId: request.userId,
      conversationId: request.conversationId,
      message: request.message,
      clientTimestamp: request.clientTimestamp,
      timeZone: request.timeZone,
    },
    {
      store: dependencies.store,
      ...(dependencies.clock ? { clock: { now: dependencies.clock } } : {}),
    },
  );

  emit({ type: "status", message: "Choosing the appropriate research effort." });
  const routeDecision = await chooseRoute(
    { message: request.message, preparedTurn },
    dependencies.routerModel,
    buildRouterPrompt({
      message: request.message,
      preparedTurn,
    }),
  );
  emit({
    type: "status",
    message: routeDecision.fallbackUsed
      ? "Using a search-backed fallback route."
      : "Research plan selected.",
    route: routeDecision.route,
  });

  const historyContext = JSON.stringify(preparedTurn.history);
  const loopResult = await runAgentLoop({
    route: routeDecision.route,
    userMessage: request.message,
    systemPrompt: buildSystemPrompt(routeDecision.route),
    context: [
      `Current time: ${preparedTurn.now} (${preparedTurn.timeZone})`,
      `Resolved dates: ${JSON.stringify(preparedTurn.dateReferences)}`,
      `Preparation flags: ${JSON.stringify(preparedTurn.flags)}`,
      `History: ${historyContext}`,
    ].join("\n"),
    budgets: dependencies.config.routeBudgets,
    model: dependencies.agentModel,
    searchTool: dependencies.searchTool,
  });

  emit({ type: "status", message: "Validating the answer against its evidence." });
  const validation = validateResponse({
    answer: loopResult.answer,
    evidence: loopResult.evidence,
    searchFailed: loopResult.stopReason === "search-failed",
    skipNumericGrounding: loopResult.stopReason === "model-failed",
  });
  const timestamp = (dependencies.clock ?? (() => new Date()))().toISOString();
  const turn: TurnRecord = {
    turnId: crypto.randomUUID(),
    conversationId: request.conversationId,
    timestamp,
    timeZone: preparedTurn.timeZone,
    userMessage: request.message,
    assistantMessage: validation.answer,
    route: loopResult.route,
    escalated: loopResult.escalated,
    queries: loopResult.queries,
    evidence: loopResult.evidence,
    flags: {
      ...validation.flags,
      ...(preparedTurn.flags.noHistoryForDate
        ? { noHistoryForDate: true }
        : {}),
    },
    usage: loopResult.usage,
    trace: {
      steps: loopResult.steps,
      totalDurationMs: Date.now() - startedAt,
    },
  };

  await dependencies.store.append(request.userId, turn);
  const answerEvent: ChatEvent = {
    type: "answer",
    message: validation.answer,
    route: loopResult.route,
    flags: turn.flags,
  };
  emit(answerEvent);
  return answerEvent;
}

function validateChatRequest(request: ChatRequest): void {
  if (!request.userId.trim()) {
    throw new Error("userId must be a non-empty string");
  }
  if (!request.conversationId.trim()) {
    throw new Error("conversationId must be a non-empty string");
  }
  if (!request.message.trim()) {
    throw new Error("message must be a non-empty string");
  }
}
