export const ROUTE_TYPES = [
  "direct",
  "lookup",
  "research",
  "reverify",
] as const;

export type RouteType = (typeof ROUTE_TYPES)[number];

export const SEARCH_TOPICS = ["general", "news"] as const;

export type SearchTopic = (typeof SEARCH_TOPICS)[number];

export const SEARCH_DEPTHS = ["snippets", "deep"] as const;

export type SearchDepth = (typeof SEARCH_DEPTHS)[number];

export interface SearchRequest {
  query: string;
  topic?: SearchTopic;
  afterDate?: string;
  beforeDate?: string;
  domains?: string[];
  depth?: SearchDepth;
  maxResults?: number;
}

export interface EvidenceCard {
  id: string;
  url: string;
  title: string;
  domain: string;
  excerpt: string;
  publishedDate?: string;
  retrievedAt: string;
}

export interface SearchResponse {
  cards: EvidenceCard[];
  query: string;
  error?: string;
}

export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TurnFlags {
  noHistoryForDate?: boolean;
  searchFailed?: boolean;
  unsupportedFigures?: boolean;
  invalidCitations?: boolean;
}

export interface TurnRecord {
  turnId: string;
  conversationId: string;
  timestamp: string;
  timeZone: string;
  userMessage: string;
  assistantMessage: string;
  route: RouteType;
  escalated: boolean;
  queries: SearchRequest[];
  evidence: EvidenceCard[];
  flags: TurnFlags;
  usage?: TurnUsage;
}
