import { describe, it, expect, vi, beforeEach } from "vitest";
import { listQuestions, getQuestion, upsertQuestion, deleteQuestion, fetchRandomQuestion, fetchDeterministicQuestion, getQuestionStats } from "../question";

vi.mock("../client", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "../client";
const mockApiFetch = vi.mocked(apiFetch);

const makeQuestion = (title: string, topics: string[], difficulty: string) => ({
  _id: title,
  title,
  description: `desc for ${title}`,
  topics,
  difficulty,
  hints: [],
  version: 1,
});

describe("question API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listQuestions", () => {
    it("calls GET /api/questions with no params by default", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 20, hasMore: false });
      const result = await listQuestions();
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions");
      expect(result.data).toEqual([]);
    });

    it("passes skip and limit as query params", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 10, limit: 5, hasMore: false });
      await listQuestions({ skip: 10, limit: 5 });
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions?skip=10&limit=5");
    });

    it("passes search param", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 20, hasMore: false });
      await listQuestions({ search: "two sum" });
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions?search=two+sum");
    });

    it("passes difficulty param", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 20, hasMore: false });
      await listQuestions({ difficulty: "Hard" });
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions?difficulty=Hard");
    });

    it("passes topic param", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 20, hasMore: false });
      await listQuestions({ topic: "Arrays" });
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions?topic=Arrays");
    });

    it("combines multiple params", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 10, hasMore: false });
      await listQuestions({ skip: 0, limit: 10, search: "sum", difficulty: "Easy", topic: "Arrays" });
      const calledUrl = mockApiFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("skip=0");
      expect(calledUrl).toContain("limit=10");
      expect(calledUrl).toContain("search=sum");
      expect(calledUrl).toContain("difficulty=Easy");
      expect(calledUrl).toContain("topic=Arrays");
    });

    it("omits empty string params", async () => {
      mockApiFetch.mockResolvedValue({ data: [], total: 0, skip: 0, limit: 20, hasMore: false });
      await listQuestions({ search: "", difficulty: "" });
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions");
    });
  });

  describe("getQuestionStats", () => {
    it("calls GET /api/questions/stats", async () => {
      const stats = { total: 10, difficulty_counts: { Easy: 5 }, topics: ["Arrays"] };
      mockApiFetch.mockResolvedValue(stats);
      const result = await getQuestionStats();
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/stats");
      expect(result).toEqual(stats);
    });
  });

  describe("getQuestion", () => {
    it("calls GET /api/questions/:title with encoded title", async () => {
      mockApiFetch.mockResolvedValue({ title: "Two Sum" });
      await getQuestion("Two Sum");
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/Two%20Sum");
    });
  });

  describe("upsertQuestion", () => {
    it("calls POST /api/questions/create for new questions", async () => {
      const data = { title: "Q1", description: "desc", topics: ["Arrays"], difficulty: "Easy" as const };
      mockApiFetch.mockResolvedValue({});
      await upsertQuestion(data);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/create", {
        method: "POST",
        body: JSON.stringify(data),
      });
    });

    it("calls PUT /api/questions/update/:id for existing questions", async () => {
      const data = { _id: "abc123", title: "Q1", description: "desc", topics: ["Arrays"], difficulty: "Easy" as const };
      mockApiFetch.mockResolvedValue({});
      await upsertQuestion(data);
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/update/abc123", {
        method: "PUT",
        body: JSON.stringify(data),
      });
    });
  });

  describe("deleteQuestion", () => {
    it("calls DELETE /api/questions/delete with title", async () => {
      mockApiFetch.mockResolvedValue({});
      await deleteQuestion("Q1");
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/delete", {
        method: "DELETE",
        body: JSON.stringify({ title: "Q1" }),
      });
    });
  });

  describe("fetchRandomQuestion", () => {
    it("calls GET /api/questions/fetch with query params", async () => {
      mockApiFetch.mockResolvedValue({ title: "Q" });
      await fetchRandomQuestion("Arrays,DP", "Medium");
      expect(mockApiFetch).toHaveBeenCalledWith("/api/questions/fetch?topics=Arrays%2CDP&difficulty=Medium");
    });
  });

  describe("fetchDeterministicQuestion", () => {
    it("filters by topic and difficulty via server params", async () => {
      mockApiFetch.mockResolvedValue({
        data: [makeQuestion("Two Sum", ["Arrays"], "Easy")],
        total: 1,
        skip: 0,
        limit: 100,
        hasMore: false,
      });

      const result = await fetchDeterministicQuestion("Arrays", "Easy", "0000000000000000");
      expect(result).not.toBeNull();
      expect(result!.title).toBe("Two Sum");
      const calledUrl = mockApiFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain("topic=Arrays");
      expect(calledUrl).toContain("difficulty=Easy");
      expect(calledUrl).toContain("limit=100");
    });

    it("returns null when no questions match", async () => {
      mockApiFetch.mockResolvedValue({
        data: [],
        total: 0,
        skip: 0,
        limit: 100,
        hasMore: false,
      });

      const result = await fetchDeterministicQuestion("Arrays", "Easy", "abcdef1234567890");
      expect(result).toBeNull();
    });

    it("sorts by title and picks deterministically based on sessionId", async () => {
      const questions = [
        makeQuestion("Zebra Problem", ["Arrays"], "Easy"),
        makeQuestion("Alpha Problem", ["Arrays"], "Easy"),
        makeQuestion("Middle Problem", ["Arrays"], "Easy"),
      ];
      mockApiFetch.mockResolvedValue({
        data: questions,
        total: 3,
        skip: 0,
        limit: 100,
        hasMore: false,
      });

      const result = await fetchDeterministicQuestion("Arrays", "Easy", "0000000000000000");
      // parseInt("00000000", 16) = 0, 0 % 3 = 0 → first sorted = "Alpha Problem"
      expect(result!.title).toBe("Alpha Problem");
    });

    it("same sessionId always picks the same question", async () => {
      const questions = [
        makeQuestion("Q1", ["DP"], "Hard"),
        makeQuestion("Q2", ["DP"], "Hard"),
        makeQuestion("Q3", ["DP"], "Hard"),
      ];
      const response = {
        data: [...questions],
        total: 3,
        skip: 0,
        limit: 100,
        hasMore: false,
      };

      mockApiFetch.mockResolvedValue({ ...response, data: [...questions] });
      const a = await fetchDeterministicQuestion("DP", "Hard", "abcdef1234567890");

      mockApiFetch.mockResolvedValue({ ...response, data: [...questions] });
      const b = await fetchDeterministicQuestion("DP", "Hard", "abcdef1234567890");

      expect(a!.title).toBe(b!.title);
    });

    it("different sessionIds can pick different questions", async () => {
      const questions = [
        makeQuestion("Q1", ["Arrays"], "Easy"),
        makeQuestion("Q2", ["Arrays"], "Easy"),
        makeQuestion("Q3", ["Arrays"], "Easy"),
      ];

      mockApiFetch.mockResolvedValue({
        data: [...questions],
        total: 3,
        skip: 0,
        limit: 100,
        hasMore: false,
      });
      const a = await fetchDeterministicQuestion("Arrays", "Easy", "0000000100000000");

      mockApiFetch.mockResolvedValue({
        data: [...questions],
        total: 3,
        skip: 0,
        limit: 100,
        hasMore: false,
      });
      const b = await fetchDeterministicQuestion("Arrays", "Easy", "0000000200000000");

      expect(a!.title).not.toBe(b!.title);
    });

    it("paginates when hasMore is true", async () => {
      const page1 = Array.from({ length: 100 }, (_, i) => makeQuestion(`Q${String(i).padStart(3, "0")}`, ["Arrays"], "Easy"));
      const page2 = [makeQuestion("Q100", ["Arrays"], "Easy")];

      mockApiFetch
        .mockResolvedValueOnce({ data: page1, total: 101, skip: 0, limit: 100, hasMore: true })
        .mockResolvedValueOnce({ data: page2, total: 101, skip: 100, limit: 100, hasMore: false });

      const result = await fetchDeterministicQuestion("Arrays", "Easy", "0000000000000000");
      expect(mockApiFetch).toHaveBeenCalledTimes(2);
      expect(result).not.toBeNull();
    });
  });
});
