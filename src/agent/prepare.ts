import type { Clock } from "@/src/clock";
import { SystemClock } from "@/src/clock";
import type { DateReference } from "@/src/agent/date-resolver";
import { resolveDateReferences } from "@/src/agent/date-resolver";
import type { TurnStore } from "@/src/store/turns";
import type { EvidenceCard, TurnRecord } from "@/src/types/domain";

const DEFAULT_TIME_ZONE = "UTC";
const DEFAULT_RECENT_LIMIT = 8;
const DEFAULT_HISTORY_CHARACTER_LIMIT = 12_000;
const DEFAULT_MESSAGE_CHARACTER_LIMIT = 2_000;
const DEFAULT_ANSWER_CHARACTER_LIMIT = 4_000;

export interface PrepareTurnInput {
  userId: string;
  conversationId: string;
  message: string;
  clientTimestamp?: string;
  timeZone?: string;
  recentLimit?: number;
  historyCharacterLimit?: number;
}

export interface PreparedHistoryTurn {
  turnId: string;
  conversationId: string;
  timestamp: string;
  userMessage: string;
  assistantMessage: string;
  evidence?: EvidenceCard[];
}

export interface PreparedTurn {
  now: string;
  timeZone: string;
  dateReferences: DateReference[];
  history: PreparedHistoryTurn[];
  flags: {
    noHistoryForDate: boolean;
    unresolvedDateReference: boolean;
  };
}

export interface PrepareTurnDependencies {
  store: TurnStore;
  clock?: Clock;
}

export async function prepareTurn(
  input: PrepareTurnInput,
  dependencies: PrepareTurnDependencies,
): Promise<PreparedTurn> {
  const clock = dependencies.clock ?? new SystemClock();
  const now = resolveCurrentTime(input.clientTimestamp, clock);
  const timeZone = input.timeZone?.trim() || DEFAULT_TIME_ZONE;
  validateTimeZone(timeZone);
  validateInput(input);

  const recentTurns = await dependencies.store.getRecent(
    input.userId,
    input.recentLimit ?? DEFAULT_RECENT_LIMIT,
  );
  const historyAnchorDate = recentTurns[0]
    ? formatDateInTimeZone(new Date(recentTurns[0].timestamp), timeZone)
    : undefined;
  const dateResolution = resolveDateReferences(
    input.message,
    now,
    timeZone,
    historyAnchorDate,
  );
  const datedTurns = await loadDatedTurns(
    dependencies.store,
    input.userId,
    dateResolution.references,
    timeZone,
  );
  const evidenceTurns = hasBackwardReference(input.message)
    ? await dependencies.store.getLatestWithEvidence(input.userId, 3)
    : [];
  const selectedTurns = mergeTurns(recentTurns, datedTurns, evidenceTurns);
  const includeEvidence = isReverificationRequest(input.message);
  const history = compactHistory(
    selectedTurns,
    includeEvidence,
    input.historyCharacterLimit ?? DEFAULT_HISTORY_CHARACTER_LIMIT,
  );

  return {
    now: now.toISOString(),
    timeZone,
    dateReferences: dateResolution.references,
    history,
    flags: {
      noHistoryForDate:
        dateResolution.references.length > 0 && datedTurns.length === 0,
      unresolvedDateReference: dateResolution.hasUnresolvedReference,
    },
  };
}

async function loadDatedTurns(
  store: TurnStore,
  userId: string,
  references: DateReference[],
  timeZone: string,
): Promise<TurnRecord[]> {
  const turnsById = new Map<string, TurnRecord>();

  for (const reference of references) {
    const turns = await store.getByDate(userId, reference.date, timeZone);
    for (const turn of turns) {
      turnsById.set(turn.turnId, turn);
    }
  }

  return [...turnsById.values()];
}

function mergeTurns(...turnGroups: TurnRecord[][]): TurnRecord[] {
  const turnsById = new Map<string, TurnRecord>();

  for (const turns of turnGroups) {
    for (const turn of turns) {
      turnsById.set(turn.turnId, turn);
    }
  }

  return [...turnsById.values()].sort(
    (first, second) =>
      Date.parse(first.timestamp) - Date.parse(second.timestamp),
  );
}

function compactHistory(
  turns: TurnRecord[],
  includeEvidence: boolean,
  characterLimit: number,
): PreparedHistoryTurn[] {
  if (!Number.isInteger(characterLimit) || characterLimit <= 0) {
    throw new Error(
      `historyCharacterLimit must be a positive integer, received: ${characterLimit}`,
    );
  }

  const compacted: PreparedHistoryTurn[] = [];
  let usedCharacters = 0;

  for (const turn of turns) {
    const compactedTurn: PreparedHistoryTurn = {
      turnId: turn.turnId,
      conversationId: turn.conversationId,
      timestamp: turn.timestamp,
      userMessage: truncate(turn.userMessage, DEFAULT_MESSAGE_CHARACTER_LIMIT),
      assistantMessage: truncate(
        turn.assistantMessage,
        DEFAULT_ANSWER_CHARACTER_LIMIT,
      ),
      ...(includeEvidence && turn.evidence.length > 0
        ? { evidence: turn.evidence }
        : {}),
    };
    const turnCharacters = JSON.stringify(compactedTurn).length;

    if (usedCharacters + turnCharacters > characterLimit) {
      break;
    }

    compacted.push(compactedTurn);
    usedCharacters += turnCharacters;
  }

  return compacted;
}

function resolveCurrentTime(clientTimestamp: string | undefined, clock: Clock) {
  if (!clientTimestamp) {
    return clock.now();
  }

  const parsedTimestamp = new Date(clientTimestamp);
  if (Number.isNaN(parsedTimestamp.getTime())) {
    throw new Error(`Invalid client timestamp, received: ${clientTimestamp}`);
  }

  return parsedTimestamp;
}

function validateInput(input: PrepareTurnInput): void {
  if (!input.userId.trim()) {
    throw new Error("userId must be a non-empty string");
  }

  if (!input.conversationId.trim()) {
    throw new Error("conversationId must be a non-empty string");
  }

  if (!input.message.trim()) {
    throw new Error("message must be a non-empty string");
  }
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

function hasBackwardReference(message: string): boolean {
  return /\b(what you said|those|that answer|previous|earlier|before)\b/i.test(
    message,
  );
}

function isReverificationRequest(message: string): boolean {
  return /\b(still correct|changed since|any update|re-?verify|verify again)\b/i.test(
    message,
  );
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}...` : value;
}
