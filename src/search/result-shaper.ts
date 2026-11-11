import type {
  EvidenceCard,
  SearchRequest,
} from "@/src/types/domain";
import type { RawSearchResult } from "@/src/search/provider";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS = 8;
const MAX_RESULTS_PER_DOMAIN = 2;
const SNIPPET_CHARACTER_LIMIT = 600;
const DEEP_CHARACTER_LIMIT = 1_800;

export function shapeSearchResults(
  results: RawSearchResult[],
  request: SearchRequest,
  retrievedAt: string,
  idGenerator: () => string,
): EvidenceCard[] {
  const seenUrls = new Set<string>();
  const resultCount = Math.min(request.maxResults ?? DEFAULT_MAX_RESULTS, MAX_RESULTS);
  const domainCounts = new Map<string, number>();
  const cards: EvidenceCard[] = [];

  for (const result of results) {
    const url = normalizeUrl(result.url);
    const excerpt = result.content?.trim() ?? "";

    if (!url || !excerpt || seenUrls.has(url)) {
      continue;
    }

    const domain = getDomain(url);
    const domainCount = domainCounts.get(domain) ?? 0;
    if (domainCount >= MAX_RESULTS_PER_DOMAIN) {
      continue;
    }

    seenUrls.add(url);
    domainCounts.set(domain, domainCount + 1);
    cards.push({
      id: idGenerator(),
      url,
      title: result.title?.trim() || domain,
      domain,
      excerpt: truncate(
        excerpt,
        request.depth === "deep"
          ? DEEP_CHARACTER_LIMIT
          : SNIPPET_CHARACTER_LIMIT,
      ),
      ...(result.publishedDate
        ? { publishedDate: result.publishedDate }
        : {}),
      retrievedAt,
    });

    if (cards.length >= resultCount) {
      break;
    }
  }

  return cards;
}

function normalizeUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

function getDomain(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
