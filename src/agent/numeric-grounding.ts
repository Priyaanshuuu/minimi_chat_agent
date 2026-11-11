import type { EvidenceCard } from "@/src/types/domain";

const FIGURE_PATTERN =
  /(?:[$€£₹]\s*)?\b\d[\d,]*(?:\.\d+)?\s*(?:%|[KMB](?:\b|(?=\s))|per\s+(?:month|year|user)|x)?\b/gi;

export interface NumericGroundingResult {
  figures: string[];
  unsupportedFigures: string[];
  isGrounded: boolean;
}

export function checkNumericGrounding(
  answer: string,
  evidence: EvidenceCard[],
): NumericGroundingResult {
  const answerWithoutCitations = answer.replace(/\[\d+\]/g, "");
  const figures = [...new Set(
    [...answerWithoutCitations.matchAll(FIGURE_PATTERN)]
      .map(([figure]) => figure.trim())
      .filter(isMeaningfulFigure),
  )];
  const evidenceText = evidence
    .map(({ title, excerpt }) => `${title} ${excerpt}`)
    .join(" ");
  const unsupportedFigures = figures.filter(
    (figure) => !containsNormalizedFigure(evidenceText, figure),
  );

  return {
    figures,
    unsupportedFigures,
    isGrounded: unsupportedFigures.length === 0,
  };
}

function containsNormalizedFigure(text: string, figure: string): boolean {
  const normalizedText = normalizeFigureText(text);
  const normalizedFigure = normalizeFigureText(figure);

  if (normalizedText.includes(normalizedFigure)) {
    return true;
  }

  const numericValue = extractNumericValue(normalizedFigure);
  return numericValue !== undefined && normalizedText.includes(numericValue);
}

function normalizeFigureText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[$€£₹,\s]/g, "")
    .replace(/per(month|year|user)/g, "");
}

function extractNumericValue(value: string): string | undefined {
  const match = value.match(/\d+(?:\.\d+)?/);
  return match?.[0];
}

function isMeaningfulFigure(value: string): boolean {
  const numericValue = extractNumericValue(value);
  return numericValue !== undefined && Number(numericValue) !== 0;
}
