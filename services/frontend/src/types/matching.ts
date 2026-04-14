export interface QueueUpdateEvent {
  type: "QUEUE_UPDATE";
  position: number;
  queueLength: number;
}

export interface MatchFoundEvent {
  type: "MATCH_FOUND";
  peer: string;
  matchedAt: number;
}

export interface TimeoutEvent {
  type: "TIMEOUT";
}

export type MatchingSSEEvent = QueueUpdateEvent | MatchFoundEvent | TimeoutEvent;
