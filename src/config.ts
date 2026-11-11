import type { RouteType } from "@/src/types/domain";

export interface RouteBudget {
  model: string;
  maxSearches: number;
  maxRounds: number;
  maxTokens: number;
  maxDurationMs: number;
}

export interface AppConfig {
  llmApiKey: string;
  searchApiKey: string;
  routeBudgets: Readonly<Record<RouteType, RouteBudget>>;
}

function requireEnvironmentVariable(
  environment: NodeJS.ProcessEnv,
  name: string,
): string {
  const value = environment[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parsePositiveInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
): number {
  const rawValue = requireEnvironmentVariable(environment, name);
  const value = Number(rawValue);

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Environment variable ${name} must be a positive integer, received: ${rawValue}`,
    );
  }

  return value;
}

export function loadConfig(
  environment: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const fastModel = requireEnvironmentVariable(environment, "MODEL_FAST");
  const mainModel = requireEnvironmentVariable(environment, "MODEL_MAIN");

  return {
    llmApiKey: requireEnvironmentVariable(environment, "ANTHROPIC_API_KEY"),
    searchApiKey: requireEnvironmentVariable(environment, "TAVILY_API_KEY"),
    routeBudgets: {
      direct: {
        model: fastModel,
        maxSearches: 0,
        maxRounds: 1,
        maxTokens: parsePositiveInteger(environment, "DIRECT_MAX_TOKENS"),
        maxDurationMs: parsePositiveInteger(
          environment,
          "DIRECT_MAX_DURATION_MS",
        ),
      },
      lookup: {
        model: fastModel,
        maxSearches: 2,
        maxRounds: 1,
        maxTokens: parsePositiveInteger(environment, "LOOKUP_MAX_TOKENS"),
        maxDurationMs: parsePositiveInteger(
          environment,
          "LOOKUP_MAX_DURATION_MS",
        ),
      },
      research: {
        model: mainModel,
        maxSearches: 8,
        maxRounds: 3,
        maxTokens: parsePositiveInteger(environment, "RESEARCH_MAX_TOKENS"),
        maxDurationMs: parsePositiveInteger(
          environment,
          "RESEARCH_MAX_DURATION_MS",
        ),
      },
      reverify: {
        model: mainModel,
        maxSearches: 12,
        maxRounds: 3,
        maxTokens: parsePositiveInteger(environment, "REVERIFY_MAX_TOKENS"),
        maxDurationMs: parsePositiveInteger(
          environment,
          "REVERIFY_MAX_DURATION_MS",
        ),
      },
    },
  };
}
