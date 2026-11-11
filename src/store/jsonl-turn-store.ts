import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  RouteType,
  TurnRecord,
} from "@/src/types/domain";
import type { TurnStore } from "@/src/store/turns";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_DATA_DIRECTORY = path.join(process.cwd(), "data", "turns");

export interface JsonlTurnStoreOptions {
  directory?: string;
}

export class JsonlTurnStore implements TurnStore {
  private readonly directory: string;

  constructor(options: JsonlTurnStoreOptions = {}) {
    this.directory = options.directory ?? DEFAULT_DATA_DIRECTORY;
  }

  async append(userId: string, turn: TurnRecord): Promise<void> {
    const validatedTurn = validateTurnRecord(turn);
    const filePath = this.getUserFilePath(userId);

    await mkdir(this.directory, { recursive: true });
    await appendFile(filePath, `${JSON.stringify(validatedTurn)}\n`, "utf8");
  }

  async getRecent(userId: string, limit: number): Promise<TurnRecord[]> {
    const records = await this.readUserRecords(userId);
    return records.slice(-validateLimit(limit)).reverse();
  }

  async getByDate(
    userId: string,
    date: string,
    timeZone: string,
  ): Promise<TurnRecord[]> {
    validateDate(date);
    validateTimeZone(timeZone);

    const records = await this.readUserRecords(userId);
    return records.filter(
      (record) => formatDateInTimeZone(record.timestamp, timeZone) === date,
    );
  }

  async getByConversation(
    userId: string,
    conversationId: string,
  ): Promise<TurnRecord[]> {
    const normalizedConversationId = requireIdentifier(
      conversationId,
      "conversationId",
    );
    const records = await this.readUserRecords(userId);

    return records.filter(
      (record) => record.conversationId === normalizedConversationId,
    );
  }

  async getLatestWithEvidence(
    userId: string,
    limit: number,
  ): Promise<TurnRecord[]> {
    const records = await this.readUserRecords(userId);
    return records
      .filter((record) => record.evidence.length > 0)
      .slice(-validateLimit(limit))
      .reverse();
  }

  private getUserFilePath(userId: string): string {
    const normalizedUserId = requireIdentifier(userId, "userId");
    const fileName = `${encodeURIComponent(normalizedUserId)}.jsonl`;
    return path.join(this.directory, fileName);
  }

  private async readUserRecords(userId: string): Promise<TurnRecord[]> {
    const filePath = this.getUserFilePath(userId);
    let contents: string;

    try {
      contents = await readFile(filePath, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return [];
      }

      throw new Error(
        `Unable to read turn history for user "${userId}": ${getErrorMessage(error)}`,
      );
    }

    const lines = contents.split("\n").filter((line) => line.trim().length > 0);

    return lines.map((line, index) => {
      try {
        return validateTurnRecord(JSON.parse(line) as unknown);
      } catch (error) {
        throw new Error(
          `Invalid turn record at ${filePath}, line ${index + 1}: ${getErrorMessage(error)}`,
        );
      }
    });
  }
}

function validateTurnRecord(value: unknown): TurnRecord {
  if (!isRecord(value)) {
    throw new Error("Turn record must be an object");
  }

  const requiredStringFields = [
    "turnId",
    "conversationId",
    "timestamp",
    "timeZone",
    "userMessage",
    "assistantMessage",
  ] as const;

  for (const field of requiredStringFields) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0) {
      throw new Error(`Turn record field "${field}" must be a non-empty string`);
    }
  }

  if (!isRouteType(value.route)) {
    throw new Error(`Unsupported route: ${String(value.route)}`);
  }

  if (typeof value.escalated !== "boolean") {
    throw new Error("Turn record field \"escalated\" must be a boolean");
  }

  if (!Array.isArray(value.queries) || !value.queries.every(isSearchRequest)) {
    throw new Error("Turn record field \"queries\" must contain search requests");
  }

  if (!Array.isArray(value.evidence) || !value.evidence.every(isEvidenceCard)) {
    throw new Error("Turn record field \"evidence\" must contain evidence cards");
  }

  if (!isRecord(value.flags)) {
    throw new Error("Turn record field \"flags\" must be an object");
  }

  const timestamp = value.timestamp;
  if (typeof timestamp !== "string" || Number.isNaN(Date.parse(timestamp))) {
    throw new Error("Turn record field \"timestamp\" must be a valid date");
  }

  return value as unknown as TurnRecord;
}

function isSearchRequest(value: unknown): boolean {
  if (!isRecord(value) || typeof value.query !== "string") {
    return false;
  }

  return (
    (value.topic === undefined ||
      value.topic === "general" ||
      value.topic === "news") &&
    (value.depth === undefined ||
      value.depth === "snippets" ||
      value.depth === "deep") &&
    (value.maxResults === undefined ||
      (typeof value.maxResults === "number" &&
        Number.isInteger(value.maxResults) &&
        value.maxResults > 0))
  );
}

function isEvidenceCard(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.title === "string" &&
    typeof value.domain === "string" &&
    typeof value.excerpt === "string" &&
    typeof value.retrievedAt === "string"
  );
}

function isRouteType(value: unknown): value is RouteType {
  return (
    value === "direct" ||
    value === "lookup" ||
    value === "research" ||
    value === "reverify"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Limit must be a positive integer, received: ${limit}`);
  }

  return limit;
}

function validateDate(date: string): void {
  if (!ISO_DATE_PATTERN.test(date)) {
    throw new Error(`Date must use YYYY-MM-DD format, received: ${date}`);
  }

  const parsedDate = new Date(`${date}T00:00:00.000Z`);
  if (parsedDate.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid calendar date, received: ${date}`);
  }
}

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new Error(`Invalid time zone, received: ${timeZone}`);
  }
}

function formatDateInTimeZone(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(timestamp));
  const values = new Map(
    parts
      .filter(({ type }) => type !== "literal")
      .map(({ type, value }) => [type, value]),
  );

  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

function requireIdentifier(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return normalizedValue;
}

function isFileNotFoundError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
