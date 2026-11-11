import type { SearchRequest } from "@/src/types/domain";

export interface RawSearchResult {
  url: string;
  title?: string;
  content?: string;
  publishedDate?: string;
}

export interface SearchProvider {
  search(request: SearchRequest): Promise<RawSearchResult[]>;
}

export class SearchProviderError extends Error {
  readonly retryable: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: { retryable: boolean; statusCode?: number },
  ) {
    super(message);
    this.name = "SearchProviderError";
    this.retryable = options.retryable;
    this.statusCode = options.statusCode;
  }
}
