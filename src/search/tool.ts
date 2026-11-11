import type {
  SearchRequest,
  SearchResponse,
} from "@/src/types/domain";
import type { SearchProvider } from "@/src/search/provider";
import { shapeSearchResults } from "@/src/search/result-shaper";

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 8;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

interface CacheEntry {
  expiresAt: number;
  response: SearchResponse;
}

export interface WebSearchToolOptions {
  provider: SearchProvider;
  now?: () => Date;
  cacheTtlMs?: number;
}

export interface WebSearchOptions {
  bypassCache?: boolean;
}

export class WebSearchTool {
  private readonly provider: SearchProvider;
  private readonly now: () => Date;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();
  private nextEvidenceId = 1;

  constructor(options: WebSearchToolOptions) {
    this.provider = options.provider;
    this.now = options.now ?? (() => new Date());
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  }

  async execute(
    request: SearchRequest,
    options: WebSearchOptions = {},
  ): Promise<SearchResponse> {
    const validatedRequest = validateSearchRequest(request);
    const cacheKey = createCacheKey(validatedRequest);
    const cachedResponse = options.bypassCache
      ? undefined
      : this.getCachedResponse(cacheKey);

    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      const rawResults = await this.provider.search(validatedRequest);
      const cards = shapeSearchResults(
        rawResults,
        validatedRequest,
        this.now().toISOString(),
        () => `[${this.nextEvidenceId++}]`,
      );
      const response: SearchResponse = {
        query: validatedRequest.query,
        cards,
        ...(cards.length === 0
          ? {
              error:
                `No usable results for "${validatedRequest.query}". ` +
                "Try a broader query or remove date and domain filters.",
            }
          : {}),
      };

      if (!options.bypassCache) {
        this.cache.set(cacheKey, {
          response,
          expiresAt: this.now().getTime() + this.cacheTtlMs,
        });
      }

      return response;
    } catch (error) {
      return {
        query: validatedRequest.query,
        cards: [],
        error: `Web search failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private getCachedResponse(key: string): SearchResponse | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= this.now().getTime()) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.response;
  }
}

function validateSearchRequest(request: SearchRequest): SearchRequest {
  const query = request.query.trim();
  if (!query) {
    throw new Error("Search query must be a non-empty string");
  }

  if (
    request.maxResults !== undefined &&
    (!Number.isInteger(request.maxResults) ||
      request.maxResults < 1 ||
      request.maxResults > MAX_RESULTS)
  ) {
    throw new Error(`maxResults must be an integer from 1 to ${MAX_RESULTS}`);
  }

  validateDate(request.afterDate, "afterDate");
  validateDate(request.beforeDate, "beforeDate");
  if (request.afterDate && request.beforeDate &&
      request.afterDate > request.beforeDate) {
    throw new Error("afterDate must not be later than beforeDate");
  }

  const domains = request.domains?.map((domain) => domain.trim()).filter(Boolean);
  if (request.domains && domains?.length === 0) {
    throw new Error("domains must contain at least one non-empty domain");
  }

  return {
    ...request,
    query,
    maxResults: request.maxResults ?? DEFAULT_MAX_RESULTS,
    ...(domains ? { domains } : {}),
  };
}

function validateDate(value: string | undefined, fieldName: string): void {
  if (value === undefined) {
    return;
  }

  if (!ISO_DATE_PATTERN.test(value)) {
    throw new Error(`${fieldName} must use YYYY-MM-DD format`);
  }

  const parsedDate = new Date(`${value}T00:00:00.000Z`);
  if (parsedDate.toISOString().slice(0, 10) !== value) {
    throw new Error(`${fieldName} must be a valid calendar date`);
  }
}

function createCacheKey(request: SearchRequest): string {
  return JSON.stringify({
    query: request.query.toLowerCase(),
    topic: request.topic ?? "general",
    afterDate: request.afterDate ?? null,
    beforeDate: request.beforeDate ?? null,
    domains: [...(request.domains ?? [])].sort(),
    depth: request.depth ?? "snippets",
    maxResults: request.maxResults ?? DEFAULT_MAX_RESULTS,
  });
}
