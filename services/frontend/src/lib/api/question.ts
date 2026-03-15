import { apiFetch } from "./client";
import type { Question, QuestionUpsertRequest } from "@/types/question";

export interface PaginatedQuestions {
  data: Question[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

export async function listQuestions(
  skip = 0,
  limit = 20,
): Promise<PaginatedQuestions> {
  return apiFetch<PaginatedQuestions>(
    `/api/questions-list?skip=${skip}&limit=${limit}`,
  );
}

export async function getQuestion(title: string): Promise<Question> {
  return apiFetch<Question>(`/api/questions-get/${encodeURIComponent(title)}`);
}

export async function upsertQuestion(data: QuestionUpsertRequest) {
  return apiFetch("/api/questions-upsert", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteQuestion(title: string) {
  return apiFetch("/api/questions-delete", {
    method: "DELETE",
    body: JSON.stringify({ title }),
  });
}

export async function fetchRandomQuestion(
  topics: string,
  difficulty: string,
): Promise<Question> {
  return apiFetch<Question>(
    `/api/questions-fetch?topics=${encodeURIComponent(topics)}&difficulty=${encodeURIComponent(difficulty)}`,
  );
}

/**
 * Deterministically select a question matching the given topic and difficulty.
 * Uses the sessionId as a seed so both matched users independently pick the same question.
 * Returns null if no matching questions exist.
 */
export async function fetchDeterministicQuestion(
  topic: string,
  difficulty: string,
  sessionId: string,
): Promise<Question | null> {
  // Fetch all matching questions via paginated API — keep fetching until hasMore is false
  const all: Question[] = [];
  let skip = 0;
  const limit = 100;

  while (true) {
    const page = await listQuestions(skip, limit);
    all.push(...page.data);
    if (!page.hasMore) break;
    skip += limit;
  }

  const filtered = all
    .filter((q) => q.topics.includes(topic) && q.difficulty === difficulty)
    .sort((a, b) => a.title.localeCompare(b.title));

  if (filtered.length === 0) return null;

  const index = parseInt(sessionId.slice(0, 8), 16) % filtered.length;
  return filtered[index];
}