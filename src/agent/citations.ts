import type { EvidenceCard } from "@/src/types/domain";

const CITATION_PATTERN = /\[(\d+)\]/g;

export interface CitationValidationResult {
  answer: string;
  citedIds: string[];
  unknownIds: string[];
  hasInvalidCitations: boolean;
}

export function validateCitations(
  answer: string,
  evidence: EvidenceCard[],
): CitationValidationResult {
  const knownIds = new Set(evidence.map(({ id }) => id));
  const citedIds: string[] = [];
  const unknownIds: string[] = [];

  for (const match of answer.matchAll(CITATION_PATTERN)) {
    const citationId = `[${match[1]}]`;
    if (knownIds.has(citationId)) {
      citedIds.push(citationId);
    } else {
      unknownIds.push(citationId);
    }
  }

  return {
    answer: removeUnknownCitations(answer, new Set(unknownIds)),
    citedIds: [...new Set(citedIds)],
    unknownIds: [...new Set(unknownIds)],
    hasInvalidCitations: unknownIds.length > 0,
  };
}

function removeUnknownCitations(
  answer: string,
  unknownIds: Set<string>,
): string {
  if (unknownIds.size === 0) {
    return answer;
  }

  return answer
    .replace(CITATION_PATTERN, (fullMatch) =>
      unknownIds.has(fullMatch) ? "" : fullMatch,
    )
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
