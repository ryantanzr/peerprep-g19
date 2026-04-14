export type Difficulty = 'easy' | 'medium' | 'hard';

export interface QueueEntry {
  userId: string;
  topic: string;
  difficulty: Difficulty;
  joinedAt: number;
}

export type SSEEventType = 'QUEUE_UPDATE' | 'MATCH_FOUND' | 'TIMEOUT';

export interface QueueUpdateEvent {
  type: 'QUEUE_UPDATE';
  position: number;
  top5: string[];
  queueLength: number;
}

export interface MatchFoundEvent {
  type: 'MATCH_FOUND';
  peer: string;
  matchedAt: number;
}

export interface TimeoutEvent {
  type: 'TIMEOUT';
}

export interface QueueChangedPayload {
  topic: string;
  difficulty: string;
}