"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { listQuestions, deleteQuestion } from "@/lib/api/question";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getDifficultyColor } from "@/lib/utils";
import type { Question } from "@/types/question";

const ITEMS_PER_PAGE = 20;

const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
type Difficulty = (typeof DIFFICULTIES)[number];

const DIFFICULTY_STYLES: Record<Difficulty, { bar: string; badge: string; text: string }> = {
  Easy:   { bar: "bg-green-400",  badge: "bg-green-50 text-green-700 border-green-200",   text: "text-green-600" },
  Medium: { bar: "bg-yellow-400", badge: "bg-yellow-50 text-yellow-700 border-yellow-200", text: "text-yellow-600" },
  Hard:   { bar: "bg-red-400",    badge: "bg-red-50 text-red-700 border-red-200",          text: "text-red-600" },
};

export default function AdminQuestionsPage() {
  const { toast } = useToast();

  // — data —
  const [questions, setQuestions] = useState<Question[]>([]);
  const [allQuestions, setAllQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // — delete —
  const [deleteTarget, setDeleteTarget] = useState<Question | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // — filters —
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<Difficulty | "All">("All");
  const [topicFilter, setTopicFilter] = useState<string>("All");

  // Reset to page 1 whenever a filter changes
  useEffect(() => { setPage(1); }, [difficultyFilter, topicFilter]);

  // Debounce search — also reset to page 1 so results always show from the top
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedQuery(searchQuery); setPage(1); }, 300);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Derive unique topics from all loaded questions
  const allTopics = useMemo(() => {
    const set = new Set<string>();
    allQuestions.forEach((q) => q.topics.forEach((t) => set.add(t)));
    return ["All", ...Array.from(set).sort()];
  }, [allQuestions]);

  // Difficulty breakdown counts for the widget
  const breakdownCounts = useMemo(() => {
    const counts: Record<Difficulty, number> = { Easy: 0, Medium: 0, Hard: 0 };
    allQuestions.forEach((q) => {
      if (q.difficulty in counts) counts[q.difficulty as Difficulty]++;
    });
    return counts;
  }, [allQuestions]);

  // Client-side filter: run over the FULL bank (allQuestions) so search isn't
  // limited to the current page. Falls back to the paginated slice while
  // allQuestions is still loading.
  const sourceForFilter = allQuestions.length > 0 ? allQuestions : questions;

  const allFilteredQuestions = useMemo(() => {
    return sourceForFilter.filter((q) => {
      if (debouncedQuery.trim() && !q.title.toLowerCase().includes(debouncedQuery.toLowerCase()))
        return false;
      if (difficultyFilter !== "All" && q.difficulty !== difficultyFilter)
        return false;
      if (topicFilter !== "All" && !q.topics.includes(topicFilter))
        return false;
      return true;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceForFilter, debouncedQuery, difficultyFilter, topicFilter]);

  // When filtering, paginate allFilteredQuestions locally.
  // When not filtering, use the server-paginated questions slice as-is.
  const isFiltering = debouncedQuery.trim() !== "" || difficultyFilter !== "All" || topicFilter !== "All";
  const filteredTotal = isFiltering ? allFilteredQuestions.length : total;
  const filteredTotalPages = Math.max(1, Math.ceil(filteredTotal / ITEMS_PER_PAGE));

  const filteredQuestions = useMemo(() => {
    if (!isFiltering) return questions;
    const start = (page - 1) * ITEMS_PER_PAGE;
    return allFilteredQuestions.slice(start, start + ITEMS_PER_PAGE);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allFilteredQuestions, isFiltering, page, questions]);

  // Paginated fetch for the table
  const fetchQuestions = async (pageNum: number) => {
    setLoading(true);
    try {
      const skip = (pageNum - 1) * ITEMS_PER_PAGE;
      const response = await listQuestions(skip, ITEMS_PER_PAGE);
      setQuestions(response.data);
      setTotal(response.total);
      setPage(pageNum);
    } catch {
      toast("Failed to load questions", "error");
    } finally {
      setLoading(false);
    }
  };

  // Full fetch for stats widget + topic list (runs once, non-blocking)
  const fetchAllForStats = async () => {
    try {
      const all: Question[] = [];
      let skip = 0;
      while (true) {
        const res = await listQuestions(skip, 100);
        all.push(...res.data);
        if (!res.hasMore) break;
        skip += 100;
      }
      setAllQuestions(all);
    } catch {
      // non-critical — widget silently skipped
    }
  };

  useEffect(() => {
    fetchQuestions(1);
    fetchAllForStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget || deleteConfirm !== "DELETE") return;
    setDeleting(true);
    try {
      await deleteQuestion(deleteTarget.title);
      toast(`Deleted "${deleteTarget.title}"`, "success");
      setDeleteTarget(null);
      setDeleteConfirm("");
      setAllQuestions((prev) => prev.filter((q) => q._id !== deleteTarget._id));
      const newTotal = total - 1;
      const maxPage = Math.max(1, Math.ceil(newTotal / ITEMS_PER_PAGE));
      fetchQuestions(Math.min(page, maxPage));
    } catch {
      toast("Failed to delete question", "error");
    } finally {
      setDeleting(false);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setDifficultyFilter("All");
    setTopicFilter("All");
  };

  const hasActiveFilters = isFiltering;


  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#5568EE]" />
      </div>
    );
  }

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Question Bank</h1>
        <Link href="/admin/questions/new/edit">
          <Button>+ Add Question</Button>
        </Link>
      </div>

      {/* ── Difficulty Breakdown Widget ── */}
      {allQuestions.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">
            Difficulty Breakdown of all questions
          </p>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {DIFFICULTIES.map((d) => {
              const count = breakdownCounts[d];
              const pct = allQuestions.length > 0
                ? Math.round((count / allQuestions.length) * 100)
                : 0;
              const styles = DIFFICULTY_STYLES[d];
              return (
                <button
                  key={d}
                  onClick={() => setDifficultyFilter(difficultyFilter === d ? "All" : d)}
                  className={`rounded-lg border px-3 py-3 text-left transition-all hover:shadow-sm ${
                    difficultyFilter === d
                      ? `${styles.badge} border-current shadow-sm`
                      : "border-gray-100 bg-gray-50 hover:border-gray-200"
                  }`}
                >
                  <p className={`text-2xl font-bold ${styles.text}`}>{count}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{d} · {pct}%</p>
                </button>
              );
            })}
          </div>
          {/* Stacked proportion bar */}
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-gray-100">
            {DIFFICULTIES.map((d) => {
              const pct = allQuestions.length > 0
                ? (breakdownCounts[d] / allQuestions.length) * 100
                : 0;
              return pct > 0 ? (
                <div
                  key={d}
                  className={`${DIFFICULTY_STYLES[d].bar} transition-all`}
                  style={{ width: `${pct}%` }}
                  title={`${d}: ${breakdownCounts[d]}`}
                />
              ) : null;
            })}
          </div>
          <p className="mt-2 text-xs text-gray-400 text-right">
            {allQuestions.length} total questions
          </p>
        </div>
      )}

      {/* ── Search + Filters row ── */}
      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative flex-1">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0Z" />
          </svg>
          <input
            type="text"
            placeholder="Search by title..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-8 text-sm text-gray-900 placeholder-gray-400 focus:border-[#5568EE] focus:outline-none focus:ring-1 focus:ring-[#5568EE]"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              aria-label="Clear search"
            >
              ✕
            </button>
          )}
        </div>

        {/* Difficulty dropdown */}
        <select
          value={difficultyFilter}
          onChange={(e) => setDifficultyFilter(e.target.value as Difficulty | "All")}
          className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-[#5568EE] focus:outline-none focus:ring-1 focus:ring-[#5568EE]"
        >
          <option value="All">All Difficulties</option>
          {DIFFICULTIES.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>

        {/* Topic dropdown */}
        <select
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className="rounded-lg border border-gray-200 bg-white py-2 pl-3 pr-8 text-sm text-gray-700 focus:border-[#5568EE] focus:outline-none focus:ring-1 focus:ring-[#5568EE]"
        >
          {allTopics.map((t) => (
            <option key={t} value={t}>{t === "All" ? "All Topics" : t}</option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="whitespace-nowrap text-sm text-gray-400 hover:text-gray-600 underline underline-offset-2"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Active filter pills */}
      {hasActiveFilters && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {debouncedQuery && (
            <span className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs text-gray-600">
              &quot;{debouncedQuery}&quot;
              <button onClick={() => setSearchQuery("")} className="opacity-50 hover:opacity-100">✕</button>
            </span>
          )}
          {difficultyFilter !== "All" && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs ${DIFFICULTY_STYLES[difficultyFilter].badge}`}>
              {difficultyFilter}
              <button onClick={() => setDifficultyFilter("All")} className="opacity-50 hover:opacity-100">✕</button>
            </span>
          )}
          {topicFilter !== "All" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#5568EE]/30 bg-[#5568EE]/5 px-2.5 py-0.5 text-xs text-[#5568EE]">
              {topicFilter}
              <button onClick={() => setTopicFilter("All")} className="opacity-50 hover:opacity-100">✕</button>
            </span>
          )}
        </div>
      )}

      {/* ── Table ── */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Topics</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Difficulty</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredQuestions.map((q) => (
              <tr key={q._id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium">{q.title}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {q.topics.map((t) => (
                      <button
                        key={t}
                        onClick={() => setTopicFilter(t)}
                        title={`Filter by ${t}`}
                        className="rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs text-gray-600 hover:border-[#5568EE]/40 hover:bg-[#5568EE]/5 hover:text-[#5568EE] transition-colors"
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={`font-medium ${getDifficultyColor(q.difficulty).split(" ")[0]}`}>
                    {q.difficulty}
                  </span>
                </td>
                <td className="px-4 py-3 space-x-3">
                  <Link
                    href={`/admin/questions/${encodeURIComponent(q.title)}/edit`}
                    className="text-[#5568EE] hover:underline"
                  >
                    Edit
                  </Link>
                  <button
                    onClick={() => setDeleteTarget(q)}
                    className="text-red-600 hover:underline cursor-pointer"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {filteredQuestions.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                  {hasActiveFilters
                    ? "No questions match the current filters."
                    : "No questions yet. Add your first one!"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      {total > 0 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-gray-600">
            {hasActiveFilters
              ? `Showing ${(page - 1) * ITEMS_PER_PAGE + 1}–${Math.min(page * ITEMS_PER_PAGE, filteredTotal)} of ${filteredTotal} result${filteredTotal !== 1 ? "s" : ""}`
              : `Showing ${(page - 1) * ITEMS_PER_PAGE + 1}–${Math.min(page * ITEMS_PER_PAGE, total)} of ${total} questions`}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page === 1} onClick={() => { if (isFiltering) setPage(p => p - 1); else fetchQuestions(page - 1); }}>
              Previous
            </Button>
            <span className="flex items-center px-3 text-sm text-gray-600">
              Page {page} of {filteredTotalPages}
            </span>
            <Button variant="secondary" disabled={page >= filteredTotalPages} onClick={() => { if (isFiltering) setPage(p => p + 1); else fetchQuestions(page + 1); }}>
              Next
            </Button>
          </div>
        </div>
      )}

      {/* ── Delete Modal ── */}
      <Modal
        open={!!deleteTarget}
        onClose={() => { setDeleteTarget(null); setDeleteConfirm(""); }}
      >
        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-red-600 text-center">Confirm Deletion</h2>
          <p className="text-center text-gray-600">
            Type &quot;DELETE&quot; to confirm removing{" "}
            <span className="font-medium">&quot;{deleteTarget?.title}&quot;</span>
          </p>
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
          <div className="flex justify-end">
            <Button
              variant="danger"
              disabled={deleteConfirm !== "DELETE" || deleting}
              onClick={handleDelete}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}