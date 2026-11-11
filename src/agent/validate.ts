import { validateCitations } from "@/src/agent/citations";
import { checkNumericGrounding } from "@/src/agent/numeric-grounding";
import type {
  EvidenceCard,
  TurnFlags,
} from "@/src/types/domain";

export interface ValidationInput {
  answer: string;
  evidence: EvidenceCard[];
  searchFailed?: boolean;
}

export interface ValidationResult {
  answer: string;
  flags: TurnFlags;
  citedIds: string[];
  unsupportedFigures: string[];
  unknownCitationIds: string[];
}

export function validateResponse(input: ValidationInput): ValidationResult {
  const citationResult = validateCitations(input.answer, input.evidence);
  const numericResult = checkNumericGrounding(
    citationResult.answer,
    input.evidence,
  );
  const flags: TurnFlags = {
    ...(input.searchFailed ? { searchFailed: true } : {}),
    ...(citationResult.hasInvalidCitations
      ? { invalidCitations: true }
      : {}),
    ...(numericResult.unsupportedFigures.length > 0
      ? { unsupportedFigures: true }
      : {}),
  };

  let answer = citationResult.answer;
  if (numericResult.unsupportedFigures.length > 0) {
    answer = appendGroundingCaveat(answer);
  }

  return {
    answer,
    flags,
    citedIds: citationResult.citedIds,
    unsupportedFigures: numericResult.unsupportedFigures,
    unknownCitationIds: citationResult.unknownIds,
  };
}

function appendGroundingCaveat(answer: string): string {
  const caveat =
    "I could not verify every figure in the retrieved sources; treat unsupported numbers as unverified.";

  return answer.includes(caveat) ? answer : `${answer}\n\n${caveat}`;
}
