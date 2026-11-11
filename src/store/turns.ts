import type { TurnRecord } from "@/src/types/domain";

export interface TurnStore {
  append(userId: string, turn: TurnRecord): Promise<void>;
  getRecent(userId: string, limit: number): Promise<TurnRecord[]>;
  getByDate(
    userId: string,
    date: string,
    timeZone: string,
  ): Promise<TurnRecord[]>;
  getByConversation(
    userId: string,
    conversationId: string,
  ): Promise<TurnRecord[]>;
  getLatestWithEvidence(userId: string, limit: number): Promise<TurnRecord[]>;
}
