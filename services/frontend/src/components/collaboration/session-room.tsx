"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { useCollaboration } from "@/hooks/use-collaboration";
import { CodeEditor } from "@/components/collaboration/code-editor";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { getQuestion } from "@/lib/api/question";
import { createAttempt } from "@/lib/api/user";
import { explainCode, type AIExplainResult } from "@/lib/api/ai";
import {
  SUPPORTED_LANGUAGES,
  LANGUAGE_LABELS,
  LANGUAGE_FILE_EXTENSIONS,
  type SupportedLanguage,
} from "@/types/collaboration";
import type { Question } from "@/types/question";
import { ChevronDown, ChevronRight } from "lucide-react";

function SessionContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuth();
  const { toast } = useToast();
  const sessionId = params.id as string;
  const questionTitle = searchParams.get("question") || "";
  const difficulty = searchParams.get("difficulty") || "";
  const topic = searchParams.get("topic") || "";

  const [question, setQuestion] = useState<Question | null>(null);
  const [showEndModal, setShowEndModal] = useState(false);
  const [expandedHint, setExpandedHint] = useState<number | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<AIExplainResult | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const sessionStartRef = useRef<number>(Date.now());

  const {
    ytext,
    awareness,
    undoManager,
    connected,
    userCount,
    language,
    sessionEnded,
    endedBy,
    partnerDisconnected,
    endSession,
    changeLanguage,
  } = useCollaboration({
    sessionId,
    userId: user?.id || "anonymous",
    username: user?.username || "Anonymous",
  });

  // Load question data
  useEffect(() => {
    if (!questionTitle) return;
    getQuestion(questionTitle)
      .then(setQuestion)
      .catch(() => {
        setQuestion({
          _id: "mock",
          title: questionTitle,
          description: "Question data unavailable. The question service may be offline.",
          topics: [],
          difficulty: (difficulty as "Easy" | "Medium" | "Hard") || "Medium",
          hints: [],
          version: 1,
        });
      });
  }, [questionTitle, difficulty]);

  const recordAttempt = useRef(false);

  const saveAttempt = async () => {
    if (recordAttempt.current || !user?.id || !questionTitle || !topic || !difficulty) return;
    recordAttempt.current = true;
    const durationSeconds = Math.round((Date.now() - sessionStartRef.current) / 1000);
    try {
      await createAttempt(user.id, {
        questionTitle,
        topic,
        difficulty: difficulty as "Easy" | "Medium" | "Hard",
        status: "attempted",
        durationSeconds,
        language,
        sessionId,
      });
    } catch {
      // Non-critical — don't block the redirect
    }
  };

  // Handle session end (triggered by remote user or server)
  useEffect(() => {
    if (sessionEnded) {
      saveAttempt();
      toast(`Session ended by ${endedBy}`, "info");
      setTimeout(() => router.push("/match"), 2000);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionEnded]);

  // Handle partner disconnect
  useEffect(() => {
    if (partnerDisconnected) {
      toast("Partner disconnected", "error");
    }
  }, [partnerDisconnected, toast]);

  const handleExplainCode = async () => {
    if (!ytext || !ytext.toString().trim()) {
      setAiError("Please write some code first");
      return;
    }

    setAiLoading(true);
    setAiError(null);
    setAiResult(null);

    try {
      const result = await explainCode({
        code: ytext.toString(),
        language,
        questionTitle: questionTitle || "unknown",
        focus: "general",
      });
      setAiResult(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to explain code";
      setAiError(message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleEndSession = async () => {
    setShowEndModal(false);
    endSession();
    toast("Session ended", "info");
    await saveAttempt();
    setTimeout(() => router.push("/match"), 1000);
  };

  if (!user) return null;

  return (
    <div className="flex h-screen flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-700 bg-gray-900 px-4 py-2 text-white">
        <div className="flex items-center gap-4">
          <span className="text-sm font-mono text-gray-400">Session #{sessionId}</span>
          <span className="text-sm text-gray-400">
            {difficulty} &middot; {questionTitle}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
            <span className="text-xs text-gray-300">You</span>
          </div>
          <div className="flex items-center gap-2">
            <div className={`h-2.5 w-2.5 rounded-full ${userCount >= 2 ? "bg-orange-500" : "bg-gray-600"}`} />
            <span className="text-xs text-gray-300">Partner</span>
          </div>
          {!connected && <span className="text-xs text-yellow-400">Connecting...</span>}
        </div>
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel — question */}
        <div className="w-[40%] overflow-y-auto border-r border-gray-200 bg-white p-6">
          {question && (
            <>
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold">{question.title}</h2>
              </div>
              <Badge variant="difficulty" difficulty={question.difficulty} className="mb-4">
                {question.difficulty}
              </Badge>

              {/* AI Assist Panel */}
              <div className="mb-6 rounded-md border border-gray-200 bg-gray-50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-800">AI Assist</h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExplainCode}
                    disabled={aiLoading}
                  >
                    {aiLoading ? "Explaining..." : "Explain My Code"}
                  </Button>
                </div>

                {aiError && (
                  <div className="mb-3 rounded bg-red-50 p-2 text-xs text-red-700">
                    {aiError}
                  </div>
                )}

                {aiResult && (
                  <div className="space-y-3 text-xs text-gray-700">
                    <div>
                      <p className="font-semibold text-gray-800 mb-1">Summary</p>
                      <p className="text-gray-600">{aiResult.summary}</p>
                    </div>

                    {aiResult.stepByStep.length > 0 && (
                      <div>
                        <p className="font-semibold text-gray-800 mb-1">Step by Step</p>
                        <ul className="list-disc pl-5 space-y-1 text-gray-600">
                          {aiResult.stepByStep.map((step, i) => (
                            <li key={i}>{step}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiResult.keyConcepts.length > 0 && (
                      <div>
                        <p className="font-semibold text-gray-800 mb-1">Key Concepts</p>
                        <div className="flex flex-wrap gap-2">
                          {aiResult.keyConcepts.map((concept, i) => (
                            <span
                              key={i}
                              className="inline-block rounded bg-gray-200 px-2 py-1 text-xs text-gray-700"
                            >
                              {concept}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {aiResult.potentialIssues.length > 0 && (
                      <div>
                        <p className="font-semibold text-gray-800 mb-1">Potential Issues</p>
                        <ul className="list-disc pl-5 space-y-1 text-gray-600">
                          {aiResult.potentialIssues.map((issue, i) => (
                            <li key={i}>{issue}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div>
                      <p className="font-semibold text-gray-800 mb-1">Confidence</p>
                      <p className="text-gray-600">
                        {(aiResult.confidence * 100).toFixed(0)}%
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="prose prose-sm max-w-none mb-6">
                <p className="whitespace-pre-wrap text-gray-700">{question.description}</p>
              </div>

              {question.hints.length > 0 && (
                <div className="space-y-2 mb-6">
                  {question.hints.map((hint, i) => (
                    <div key={i} className="rounded-md border border-gray-200">
                      <button
                        onClick={() => setExpandedHint(expandedHint === i ? null : i)}
                        className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
                      >
                        {expandedHint === i ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        Hint {i + 1}{expandedHint !== i && " (click to expand)"}
                      </button>
                      {expandedHint === i && (
                        <div className="border-t border-gray-200 px-3 py-2 text-sm text-gray-600">
                          {hint}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <Button variant="danger" className="w-full" onClick={() => setShowEndModal(true)}>
                End Session
              </Button>
            </>
          )}
        </div>

        {/* Right panel — code editor */}
        <div className="flex-1 flex flex-col bg-[#282c34]">
          {/* Editor toolbar */}
          <div className="flex items-center justify-between border-b border-gray-700 px-4 py-2">
            <span className="text-sm text-gray-400 font-mono">
              {LANGUAGE_FILE_EXTENSIONS[language]}
            </span>
            <select
              value={language}
              onChange={(e) => changeLanguage(e.target.value as SupportedLanguage)}
              className="rounded bg-gray-700 px-2 py-1 text-xs text-gray-300 border-0 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {SUPPORTED_LANGUAGES.map((lang) => (
                <option key={lang} value={lang}>
                  {LANGUAGE_LABELS[lang]}
                </option>
              ))}
            </select>
          </div>

          {/* Editor */}
          <div className="flex-1 overflow-hidden">
            {ytext && awareness && undoManager ? (
              <CodeEditor
                ytext={ytext}
                awareness={awareness}
                language={language}
                undoManager={undoManager}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-gray-500">
                Connecting to session...
              </div>
            )}
          </div>
        </div>
      </div>

      {/* End session modal */}
      <Modal open={showEndModal} onClose={() => setShowEndModal(false)}>
        <div className="text-center space-y-4">
          <h2 className="text-lg font-semibold">End Session?</h2>
          <p className="text-gray-600">
            Are you sure? This will end the session for both users.
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={() => setShowEndModal(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleEndSession}>
              End Session
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export function SessionRoom() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#5568EE]" /></div>}>
      <SessionContent />
    </Suspense>
  );
}
