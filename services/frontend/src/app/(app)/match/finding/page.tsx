"use client";

import { useEffect, useState, useRef, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { useAuth } from "@/providers/auth-provider";
import { getToken } from "@/lib/auth";
import { connectToMatchingQueue, leaveQueue } from "@/lib/api/matching";
import { fetchDeterministicQuestion } from "@/lib/api/question";
import { generateSessionId } from "@/lib/session";

const TIMEOUT_SECONDS = 60;

function FindingMatchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const difficulty = searchParams.get("difficulty") || "Medium";
  const topic = searchParams.get("topic") || "Arrays";

  const [countdown, setCountdown] = useState(TIMEOUT_SECONDS);
  const [queuePosition, setQueuePosition] = useState<number | null>(null);
  const [queueLength, setQueueLength] = useState<number>(0);
  const [matchFound, setMatchFound] = useState(false);
  const [cancelled, setCancelled] = useState(false);

  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Stable primitive — only changes when the actual email changes, not on every render
  const userEmail = user?.email;

  const cleanup = useCallback(() => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  }, []);

  useEffect(() => {
    const token = getToken();
    if (!token || !userEmail) return;

    // Start countdown timer (visual only — server TIMEOUT is authoritative)
    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          cleanup();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const controller = connectToMatchingQueue(topic, difficulty, token, {
      onQueueUpdate: (position, length) => {
        setQueuePosition(position);
        setQueueLength(length);
      },
      onMatchFound: async (peerId, matchedAt) => {
        cleanup();
        setMatchFound(true);

        try {
          // peerId is a Firebase UID from the match service — use user.id (also a UID)
          // so both matched users compute the same deterministic session ID
          const sessionId = await generateSessionId(user!.id, peerId, matchedAt);
          const question = await fetchDeterministicQuestion(topic, difficulty, sessionId);
          const questionParam = question
            ? encodeURIComponent(question.title)
            : "";

          router.push(
            `/session/${sessionId}?question=${questionParam}&difficulty=${encodeURIComponent(difficulty)}&topic=${encodeURIComponent(topic)}`,
          );
        } catch {
          toast("Matched but failed to load session. Please try again.", "error");
          router.push("/match");
        }
      },
      onTimeout: () => {
        cleanup();
        toast("No match found. Try again.", "error");
        router.push("/match");
      },
      onError: (err) => {
        cleanup();
        toast(err.message || "Matching failed", "error");
        router.push("/match");
      },
    });

    abortRef.current = controller;

    return () => {
      cleanup();
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty, topic, cleanup, userEmail]);

  const handleCancel = async () => {
    setCancelled(true);
    cleanup();
    abortRef.current?.abort();

    const token = getToken();
    if (token) await leaveQueue(token);

    router.push("/match");
  };

  if (matchFound) {
    return (
      <div className="flex flex-col items-center pt-16 text-center">
        <h1 className="text-3xl font-bold text-green-600 mb-2">Match Found!</h1>
        <p className="text-gray-500 mb-8">Joining session...</p>
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-green-500" />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center pt-16 text-center">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Finding Match...</h1>

      <div className="mb-4">
        <div className="h-16 w-16 rounded-full border-4 border-gray-200 border-t-[#5568EE] animate-spin-slow" />
      </div>

      <p className="text-sm text-gray-500 mb-2">
        {difficulty} &middot; {topic}
      </p>
      <p className="text-lg font-bold mb-1">
        {queuePosition !== null
          ? `Queue position: #${queuePosition}`
          : "Joining queue..."}
      </p>
      {queueLength > 0 && (
        <p className="text-sm text-gray-400 mb-1">{queueLength} in queue</p>
      )}
      <p className="text-sm text-gray-400 mb-8">Timeout in {countdown}s</p>

      <Button variant="outline" onClick={handleCancel} disabled={cancelled}>
        Cancel
      </Button>
    </div>
  );
}

export default function FindingMatchPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#5568EE]" /></div>}>
      <FindingMatchContent />
    </Suspense>
  );
}
