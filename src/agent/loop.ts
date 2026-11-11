import type { RouteBudget } from "@/src/config";
import {
  getEscalatedRoute,
  shouldEscalate,
} from "@/src/agent/escalation";
import type {
  EvidenceCard,
  RouteType,
  SearchRequest,
  SearchResponse,
  StepTrace,
  TurnUsage,
} from "@/src/types/domain";
import type { WebSearchTool } from "@/src/search/tool";

const SEARCH_SENTINEL = "[[SEARCH]]";

export interface AgentModelInput {
  route: RouteType;
  model: string;
  round: number;
  userMessage: string;
  systemPrompt: string;
  context: string;
  evidence: EvidenceCard[];
  forceFinal: boolean;
}

export interface AgentModelOutput {
  kind: "search" | "final";
  searchRequests?: SearchRequest[];
  text?: string;
  usage: TurnUsage;
}

export interface AgentModel {
  generate(input: AgentModelInput): Promise<AgentModelOutput>;
}

export interface AgentLoopInput {
  route: RouteType;
  userMessage: string;
  systemPrompt: string;
  context: string;
  budgets: Readonly<Record<RouteType, RouteBudget>>;
  model: AgentModel;
  searchTool: WebSearchTool;
  now?: () => number;
}

export interface AgentLoopResult {
  answer: string;
  route: RouteType;
  escalated: boolean;
  evidence: EvidenceCard[];
  queries: SearchRequest[];
  usage: TurnUsage;
  steps: StepTrace[];
  stopReason:
    | "completed"
    | "budget-exhausted"
    | "search-failed"
    | "model-failed";
}

interface LoopState {
  route: RouteType;
  budget: RouteBudget;
  budgets: Readonly<Record<RouteType, RouteBudget>>;
  round: number;
  searches: number;
  usage: TurnUsage;
  evidence: EvidenceCard[];
  queries: SearchRequest[];
  steps: StepTrace[];
  startedAt: number;
  escalated: boolean;
}

export async function runAgentLoop(
  input: AgentLoopInput,
): Promise<AgentLoopResult> {
  const now = input.now ?? Date.now;
  const state: LoopState = {
    route: input.route,
    budget: input.budgets[input.route],
    budgets: input.budgets,
    round: 0,
    searches: 0,
    usage: emptyUsage(),
    evidence: [],
    queries: [],
    steps: [],
    startedAt: now(),
    escalated: false,
  };

  while (true) {
    const shouldForceFinal =
      state.round >= state.budget.maxRounds ||
      state.searches >= state.budget.maxSearches ||
      state.usage.totalTokens >= state.budget.maxTokens ||
      elapsedMs(state, now) >= state.budget.maxDurationMs;

    let output: AgentModelOutput;
    try {
      output = await generateModelOutput(input, state, shouldForceFinal);
    } catch (error) {
      return completeResult(
        state,
        `I could not complete this request because the model failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        "model-failed",
      );
    }
    addUsage(state.usage, output.usage);

    if (output.kind === "final" || shouldForceFinal) {
      return completeResult(state, cleanAnswer(output.text), "completed");
    }

    const searchRequests = output.searchRequests ?? [];
    if (searchRequests.length === 0) {
      return finalizeFromModel(
        input,
        state,
      );
    }

    const remainingSearches = state.budget.maxSearches - state.searches;
    if (remainingSearches <= 0) {
      const escalated = tryEscalate(state, "search-cap", true);
      if (escalated) {
        continue;
      }

      return forceFinalAnswer(input, state, "budget-exhausted");
    }

    const boundedRequests = searchRequests.slice(0, remainingSearches);
    const executions = await executeSearches(
      input.searchTool,
      boundedRequests,
      state.route === "reverify",
    );
    state.searches += boundedRequests.length;
    state.queries.push(...boundedRequests);
    state.evidence.push(
      ...executions.flatMap(({ response }) => response.cards),
    );
    const latestStep = state.steps[state.steps.length - 1];
    if (latestStep) {
      latestStep.toolCalls.push(
        ...executions.map(({ request, response, durationMs }) => ({
          request,
          resultCount: response.cards.length,
          durationMs,
        })),
      );
    }
    state.round += 1;

    const hasFailure = executions.some(({ response }) => response.error);
    const hasUsableEvidence = state.evidence.length > 0;
    if (hasFailure && !hasUsableEvidence) {
      const escalated = tryEscalate(state, "no-usable-results", false);
      if (escalated) {
        continue;
      }

      return forceFinalAnswer(input, state, "search-failed");
    }

    if (boundedRequests.length < searchRequests.length) {
      const escalated = tryEscalate(state, "search-cap", true);
      if (escalated) {
        continue;
      }
    }
  }
}

async function generateModelOutput(
  input: AgentLoopInput,
  state: LoopState,
  forceFinal: boolean,
): Promise<AgentModelOutput> {
  try {
    const startedAt = Date.now();
    const output = await input.model.generate({
      route: state.route,
      model: state.budget.model,
      round: state.round + 1,
      userMessage: input.userMessage,
      systemPrompt: input.systemPrompt,
      context: input.context,
      evidence: state.evidence,
      forceFinal,
    });
    state.steps.push({
      model: state.budget.model,
      inputTokens: output.usage.inputTokens,
      outputTokens: output.usage.outputTokens,
      toolCalls: [],
      durationMs: Date.now() - startedAt,
    });

    if (state.route === "direct" && output.kind === "final") {
      const answer = output.text?.trim() ?? "";
      if (answer.startsWith(SEARCH_SENTINEL)) {
        const escalated = tryEscalate(
          state,
          "direct-search-sentinel",
          false,
        );
        if (escalated) {
          return generateModelOutput(input, state, false);
        }
      }
    }

    return output;
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function executeSearches(
  searchTool: WebSearchTool,
  requests: SearchRequest[],
  bypassCache: boolean,
): Promise<SearchExecution[]> {
  return Promise.all(
    requests.map((request) =>
      executeSearch(searchTool, request, bypassCache),
    ),
  );
}

async function executeSearch(
  searchTool: WebSearchTool,
  request: SearchRequest,
  bypassCache: boolean,
): Promise<SearchExecution> {
  const startedAt = Date.now();
  try {
    return {
      request,
      response: await searchTool.execute(request, { bypassCache }),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      request,
      response: {
        query: request.query,
        cards: [],
        error: `Web search request was invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      durationMs: Date.now() - startedAt,
    };
  }
}

interface SearchExecution {
  request: SearchRequest;
  response: SearchResponse;
  durationMs: number;
}

function tryEscalate(
  state: LoopState,
  reason:
    | "direct-search-sentinel"
    | "search-cap"
    | "no-usable-results",
  searchesRequested: boolean,
): boolean {
  if (
    state.escalated ||
    !shouldEscalate(state.route, reason, {
      searchesRequested,
      usableEvidence: state.evidence.length > 0,
    })
  ) {
    return false;
  }

  const nextRoute = getEscalatedRoute(state.route);
  if (!nextRoute) {
    return false;
  }

  state.route = nextRoute;
  state.budget = state.budgets[nextRoute];
  state.escalated = true;
  state.round = 0;
  state.searches = 0;
  return true;
}

function completeResult(
  state: LoopState,
  answer: string,
  stopReason: AgentLoopResult["stopReason"],
): AgentLoopResult {
  return {
    answer: answer || "I could not produce an answer.",
    route: state.route,
    escalated: state.escalated,
    evidence: state.evidence,
    queries: state.queries,
    usage: state.usage,
    steps: state.steps,
    stopReason,
  };
}

async function forceFinalAnswer(
  input: AgentLoopInput,
  state: LoopState,
  stopReason: AgentLoopResult["stopReason"],
): Promise<AgentLoopResult> {
  try {
    const output = await input.model.generate({
      route: state.route,
      model: state.budget.model,
      round: state.round + 1,
      userMessage: input.userMessage,
      systemPrompt: input.systemPrompt,
      context:
        `${input.context}\n\nThe search budget is exhausted. ` +
        "Answer from the available evidence and state what could not be verified.",
      evidence: state.evidence,
      forceFinal: true,
    });
    addUsage(state.usage, output.usage);
    return completeResult(state, cleanAnswer(output.text), stopReason);
  } catch (error) {
    return completeResult(
      state,
      `I could not complete this request: ${
        error instanceof Error ? error.message : String(error)
      }`,
      stopReason,
    );
  }
}

async function finalizeFromModel(
  input: AgentLoopInput,
  state: LoopState,
): Promise<AgentLoopResult> {
  return forceFinalAnswer(input, state, "model-failed");
}

function cleanAnswer(text: string | undefined): string {
  return (text ?? "").replace(SEARCH_SENTINEL, "").trim();
}

function emptyUsage(): TurnUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };
}

function addUsage(target: TurnUsage, increment: TurnUsage): void {
  target.inputTokens += increment.inputTokens;
  target.outputTokens += increment.outputTokens;
  target.totalTokens += increment.totalTokens;
}

function elapsedMs(state: LoopState, now: () => number): number {
  return now() - state.startedAt;
}
