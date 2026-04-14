"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/providers/auth-provider";
import { getAttemptHistory, getAttemptSummary, type Attempt, type AttemptSummary } from "@/lib/api/user";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

function formatDate(raw: Attempt["attemptedAt"]): string {
  if (!raw) return "-";
  if (typeof raw === "string") return new Date(raw).toLocaleDateString();
  if (raw._seconds) return new Date(raw._seconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });
  return "-";
}

function formatDuration(seconds: number | null): string {
  if (seconds == null) return "-";
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export default function HistoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [summary, setSummary] = useState<AttemptSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [topicFilter, setTopicFilter] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");

  const fetchHistory = useCallback(async (resetCursor = true) => {
    if (!user) return;
    try {
      if (resetCursor) setLoading(true);
      const params: { limit: number; cursor?: string; topic?: string; difficulty?: string } = { limit: 20 };
      if (!resetCursor && cursor) params.cursor = cursor;
      if (topicFilter) params.topic = topicFilter;
      if (difficultyFilter) params.difficulty = difficultyFilter;

      const res = await getAttemptHistory(user.id, params);
      if (resetCursor) {
        setAttempts(res.data);
      } else {
        setAttempts((prev) => [...prev, ...res.data]);
      }
      setCursor(res.pagination.nextCursor);
      setHasMore(!!res.pagination.nextCursor);
    } catch {
      toast("Failed to load history", "error");
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [user, cursor, topicFilter, difficultyFilter, toast]);

  useEffect(() => {
    if (!user) return;
    fetchHistory(true);
    getAttemptSummary(user.id).then((res) => setSummary(res.data)).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, topicFilter, difficultyFilter]);

  const handleLoadMore = () => {
    setLoadingMore(true);
    fetchHistory(false);
  };

  if (!user) return null;

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Question History</h1>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-gray-900">{summary.totalAttempts}</p>
            <p className="text-sm text-gray-500">Total Attempts</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-green-600">{summary.solvedCount}</p>
            <p className="text-sm text-gray-500">Solved</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-yellow-600">{summary.attemptedCount}</p>
            <p className="text-sm text-gray-500">Attempted</p>
          </div>
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-2xl font-bold text-[#5568EE]">
              {summary.totalAttempts > 0 ? `${Math.round(summary.solvedRate * 100)}%` : "-"}
            </p>
            <p className="text-sm text-gray-500">Solve Rate</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <select
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#5568EE] focus:outline-none focus:ring-1 focus:ring-[#5568EE]"
        >
          <option value="">All Difficulties</option>
          <option value="Easy">Easy</option>
          <option value="Medium">Medium</option>
          <option value="Hard">Hard</option>
        </select>
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-[#5568EE] focus:outline-none focus:ring-1 focus:ring-[#5568EE]"
        >
          <option value="">All Topics</option>
          {summary && Object.keys(summary.byTopic).sort().map((t) => (
            <option key={t} value={t}>{t} ({summary.byTopic[t]})</option>
          ))}
        </select>
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#5568EE]" />
        </div>
      ) : attempts.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-500">No attempts yet. Start a session to see your history here.</p>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Question</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Difficulty</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Topic</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Language</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Duration</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a) => (
                  <tr key={a.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{a.questionTitle}</td>
                    <td className="px-4 py-3">
                      <Badge variant="difficulty" difficulty={a.difficulty}>{a.difficulty}</Badge>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{a.topic}</td>
                    <td className="px-4 py-3 text-gray-600">{a.language || "-"}</td>
                    <td className="px-4 py-3 text-gray-600">{formatDuration(a.durationSeconds)}</td>
                    <td className="px-4 py-3 text-gray-500">{formatDate(a.attemptedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {hasMore && (
            <div className="mt-4 text-center">
              <Button variant="outline" onClick={handleLoadMore} disabled={loadingMore}>
                {loadingMore ? "Loading..." : "Load More"}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
