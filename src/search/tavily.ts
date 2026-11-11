import type { SearchRequest } from "@/src/types/domain";
import {
  SearchProviderError,
  type RawSearchResult,
  type SearchProvider,
} from "@/src/search/provider";

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_RETRIES = 2;

export interface TavilySearchProviderOptions {
  apiKey: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  sleep?: (durationMs: number) => Promise<void>;
}

export class TavilySearchProvider implements SearchProvider {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (durationMs: number) => Promise<void>;

  constructor(options: TavilySearchProviderOptions) {
    if (!options.apiKey.trim()) {
      throw new Error("Tavily API key must be a non-empty string");
    }

    this.apiKey = options.apiKey;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.sleep = options.sleep ?? delay;
  }

  async search(request: SearchRequest): Promise<RawSearchResult[]> {
    const payload = buildTavilyPayload(request, this.apiKey);

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      try {
        const response = await this.fetchWithTimeout(payload);
        if (!response.ok) {
          const error = new SearchProviderError(
            `Tavily search failed with HTTP ${response.status}`,
            {
              retryable: response.status === 408 || response.status === 429 ||
                response.status >= 500,
              statusCode: response.status,
            },
          );

          if (!error.retryable || attempt === MAX_RETRIES) {
            throw error;
          }

          await this.sleep(250 * 2 ** attempt);
          continue;
        }

        const body = (await response.json()) as unknown;
        return parseTavilyResults(body);
      } catch (error) {
        const normalizedError = normalizeProviderError(error);
        if (!normalizedError.retryable || attempt === MAX_RETRIES) {
          throw normalizedError;
        }

        await this.sleep(250 * 2 ** attempt);
      }
    }

    throw new SearchProviderError("Tavily search exhausted all retries", {
      retryable: false,
    });
  }

  private async fetchWithTimeout(
    payload: Record<string, unknown>,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      return await this.fetcher(TAVILY_SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new SearchProviderError(
          `Tavily search timed out after ${this.timeoutMs}ms`,
          { retryable: true },
        );
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildTavilyPayload(
  request: SearchRequest,
  apiKey: string,
): Record<string, unknown> {
  return {
    api_key: apiKey,
    query: request.query,
    topic: request.topic ?? "general",
    search_depth: request.depth === "deep" ? "advanced" : "basic",
    max_results: request.maxResults ?? 5,
    ...(request.afterDate ? { start_date: request.afterDate } : {}),
    ...(request.beforeDate ? { end_date: request.beforeDate } : {}),
    ...(request.domains?.length
      ? { include_domains: request.domains }
      : {}),
  };
}

function parseTavilyResults(value: unknown): RawSearchResult[] {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    throw new SearchProviderError(
      "Tavily returned an invalid response: results array is missing",
      { retryable: false },
    );
  }

  return value.results.flatMap((result) => {
    if (!isRecord(result) || typeof result.url !== "string") {
      return [];
    }

    return [
      {
        url: result.url,
        ...(typeof result.title === "string" ? { title: result.title } : {}),
        ...(typeof result.content === "string"
          ? { content: result.content }
          : {}),
        ...(typeof result.published_date === "string"
          ? { publishedDate: result.published_date }
          : {}),
      },
    ];
  });
}

function normalizeProviderError(error: unknown): SearchProviderError {
  if (error instanceof SearchProviderError) {
    return error;
  }

  return new SearchProviderError(
    `Tavily search request failed: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { retryable: true },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}
