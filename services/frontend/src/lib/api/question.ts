import { apiFetch } from "./client";
import type { Question, QuestionUpsertRequest } from "@/types/question";

export interface ListQuestionsParams {
  skip?: number;
  limit?: number;
  search?: string;
  difficulty?: string;
  topic?: string;
}

export interface ListQuestionsResponse {
  data: Question[];
  total: number;
  skip: number;
  limit: number;
  hasMore: boolean;
}

export interface QuestionStats {
  total: number;
  difficulty_counts: Record<string, number>;
  topics: string[];
}

export async function listQuestions(params: ListQuestionsParams = {}): Promise<ListQuestionsResponse> {
  const searchParams = new URLSearchParams();
  if (params.skip != null) searchParams.set("skip", String(params.skip));
  if (params.limit != null) searchParams.set("limit", String(params.limit));
  if (params.search) searchParams.set("search", params.search);
  if (params.difficulty) searchParams.set("difficulty", params.difficulty);
  if (params.topic) searchParams.set("topic", params.topic);

  const qs = searchParams.toString();
  const url = qs ? `/api/questions?${qs}` : "/api/questions";
  return apiFetch<ListQuestionsResponse>(url);
}

export async function getQuestionStats(): Promise<QuestionStats> {
  return apiFetch<QuestionStats>("/api/questions/stats");
}

export async function getQuestion(titleOrId: string): Promise<Question> {
  return apiFetch<Question>(`/api/questions/${encodeURIComponent(titleOrId)}`);
}

export async function upsertQuestion(data: QuestionUpsertRequest) {
  if (data._id) {
    return apiFetch(`/api/questions/update/${data._id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
  } else {
    return apiFetch("/api/questions/create", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }
}

export async function deleteQuestion(title: string) {
  return apiFetch("/api/questions/delete", {
    method: "DELETE",
    body: JSON.stringify({ title }),
  });
}

export async function fetchRandomQuestion(
  topics: string,
  difficulty: string,
): Promise<Question> {
  return apiFetch<Question>(
    `/api/questions/fetch?topics=${encodeURIComponent(topics)}&difficulty=${encodeURIComponent(difficulty)}`,
  );
}

export async function getAllTopics(search?: string): Promise<string[]> {
  const searchParams = new URLSearchParams();
  if (search) searchParams.set("search", search);
  
  const qs = searchParams.toString();
  const url = qs ? `/api/topics?${qs}` : "/api/topics";
  
  return apiFetch<string[]>(url);
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
  // Fetch all matching questions via pagination (backend caps at 100 per page)
  const PAGE_SIZE = 100;
  const MAX_PAGES = 50;
  const allQuestions: Question[] = [];
  let skip = 0;
  let hasMore = true;
  let page = 0;

  while (hasMore && page < MAX_PAGES) {
    const response = await listQuestions({ topic, difficulty, limit: PAGE_SIZE, skip });
    allQuestions.push(...response.data);
    hasMore = response.hasMore;
    skip += PAGE_SIZE;
    page++;
  }

  const sorted = allQuestions.sort((a, b) => a.title.localeCompare(b.title));

  if (sorted.length === 0) return null;

  const index = parseInt(sessionId.slice(0, 8), 16) % sorted.length;
  return sorted[index];
}
