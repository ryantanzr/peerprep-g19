import { apiFetch } from "./client";

export interface AIExplainRequest {
  code: string;
  language: string;
  questionTitle: string;
  focus?: string;
}

export interface AIExplainResult {
  summary: string;
  stepByStep: string[];
  keyConcepts: string[];
  potentialIssues: string[];
  confidence: number;
}

export interface AIExplainResponse {
  explanation: AIExplainResult;
}

export async function explainCode(request: AIExplainRequest): Promise<AIExplainResult> {
  const response = await apiFetch<AIExplainResponse>("/api/ai/explain", {
    method: "POST",
    body: JSON.stringify(request),
  });
  return response.explanation;
}
