import type { PreparedTurn } from "@/src/agent/prepare";
import type { RouteDecision, RouteType } from "@/src/types/domain";

const MAX_REASON_WORDS = 20;

export interface RouterInput {
  message: string;
  preparedTurn: PreparedTurn;
}

export interface RouterModel {
  complete(prompt: string): Promise<string>;
}

export async function chooseRoute(
  input: RouterInput,
  model: RouterModel,
  prompt: string,
): Promise<RouteDecision> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await model.complete(prompt);
      const decision = parseRouteDecision(response);

      if (
        decision.route === "reverify" &&
        !hasReverificationHistory(input.preparedTurn)
      ) {
        return {
          route: "lookup",
          reason: "No prior evidence is available for re-verification.",
          fallbackUsed: true,
        };
      }

      return {
        ...decision,
        fallbackUsed: false,
      };
    } catch (error) {
      lastError = toError(error);
    }
  }

  return {
    route: "lookup",
    reason: `Router failed after two attempts: ${lastError?.message ?? "unknown error"}`,
    fallbackUsed: true,
  };
}

export function parseRouteDecision(response: string): RouteDecision {
  const parsed = parseJsonObject(response);
  const route = parsed.route;
  const reason = parsed.reason;

  if (!isRouteType(route)) {
    throw new Error(`Router returned an unsupported route: ${String(route)}`);
  }

  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("Router response must include a non-empty reason");
  }

  if (reason.trim().split(/\s+/).length > MAX_REASON_WORDS) {
    throw new Error(
      `Router reason must be ${MAX_REASON_WORDS} words or fewer`,
    );
  }

  return {
    route,
    reason: reason.trim(),
    fallbackUsed: false,
  };
}

function parseJsonObject(response: string): Record<string, unknown> {
  const normalizedResponse = response
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "");

  let parsed: unknown;
  try {
    parsed = JSON.parse(normalizedResponse);
  } catch {
    throw new Error("Router response must be valid JSON");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Router response must be a JSON object");
  }

  return parsed as Record<string, unknown>;
}

function hasReverificationHistory(preparedTurn: PreparedTurn): boolean {
  return preparedTurn.history.some(
    (historyTurn) =>
      historyTurn.evidence !== undefined && historyTurn.evidence.length > 0,
  );
}

function isRouteType(value: unknown): value is RouteType {
  return (
    value === "direct" ||
    value === "lookup" ||
    value === "research" ||
    value === "reverify"
  );
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
