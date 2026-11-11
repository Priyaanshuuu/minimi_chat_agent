import * as chrono from "chrono-node";

export interface DateReference {
  expression: string;
  date: string;
  matchedText: string;
  source: "parsed" | "history";
}

export interface DateResolutionResult {
  references: DateReference[];
  hasUnresolvedReference: boolean;
}

export function resolveDateReferences(
  message: string,
  referenceDate: Date,
  timeZone: string,
  historyAnchorDate?: string,
): DateResolutionResult {
  validateTimeZone(timeZone);

  const parsedResults = chrono.parse(message, {
    instant: referenceDate,
    timezone: timeZone,
  });
  const references: DateReference[] = parsedResults
    .map((result) => {
      const parsedDate = result.start.date();
      const adjustedDate = applyPastBias(
        result.text,
        parsedDate,
        referenceDate,
      );

      return {
        expression: result.text,
        date: formatDateInTimeZone(adjustedDate, timeZone),
        matchedText: result.text,
        source: "parsed" as const,
      };
    })
    .filter(
      (reference, index, allReferences) =>
        allReferences.findIndex(
          (candidate) =>
            candidate.date === reference.date &&
            candidate.matchedText === reference.matchedText,
        ) === index,
    );

  const hasSinceThen = /\bsince\s+(then|that|my last question)\b/i.test(message);
  if (hasSinceThen && historyAnchorDate) {
    references.push({
      expression: "since then",
      date: historyAnchorDate,
      matchedText: "since then",
      source: "history",
    });
  }

  return {
    references,
    hasUnresolvedReference: hasSinceThen && !historyAnchorDate,
  };
}

function applyPastBias(
  matchedText: string,
  parsedDate: Date,
  referenceDate: Date,
): Date {
  const isWeekdayOnly = /^(this\s+|last\s+|next\s+)?(sun|mon|tue|wed|thu|fri|sat)/i.test(
    matchedText.trim(),
  );
  const isPastOriented =
    /\b(last|previous|ago|on|asked|since|from)\b/i.test(matchedText);

  if (
    isWeekdayOnly &&
    isPastOriented &&
    parsedDate.getTime() > referenceDate.getTime()
  ) {
    const adjustedDate = new Date(parsedDate);
    adjustedDate.setUTCDate(adjustedDate.getUTCDate() - 7);
    return adjustedDate;
  }

  if (isWeekdayOnly && parsedDate.getTime() > referenceDate.getTime()) {
    const adjustedDate = new Date(parsedDate);
    adjustedDate.setUTCDate(adjustedDate.getUTCDate() - 7);
    return adjustedDate;
  }

  return parsedDate;
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`Invalid time zone, received: ${timeZone}`);
  }
}

function formatDateInTimeZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = new Map(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}
