import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSSEChunk, connectToMatchingQueue, leaveQueue } from "../matching";

// ─── parseSSEChunk ──────────────────────────────────────────────────────────

describe("parseSSEChunk", () => {
  it("parses a single complete SSE frame", () => {
    const raw = 'data: {"type":"TIMEOUT"}\n\n';
    const { events, remainder } = parseSSEChunk(raw);
    expect(events).toEqual(['{"type":"TIMEOUT"}']);
    expect(remainder).toBe("");
  });

  it("parses multiple SSE frames", () => {
    const raw =
      'data: {"type":"QUEUE_UPDATE","position":1,"top5":["a"],"queueLength":3}\n\n' +
      'data: {"type":"MATCH_FOUND","peer":"bob@test.com","matchedAt":1700000000000}\n\n';
    const { events, remainder } = parseSSEChunk(raw);
    expect(events).toHaveLength(2);
    expect(JSON.parse(events[0])).toEqual({
      type: "QUEUE_UPDATE",
      position: 1,
      top5: ["a"],
      queueLength: 3,
    });
    expect(JSON.parse(events[1])).toEqual({
      type: "MATCH_FOUND",
      peer: "bob@test.com",
      matchedAt: 1700000000000,
    });
    expect(remainder).toBe("");
  });

  it("keeps incomplete frames as remainder", () => {
    const raw = 'data: {"type":"QUEUE_UP';
    const { events, remainder } = parseSSEChunk(raw);
    expect(events).toEqual([]);
    expect(remainder).toBe('data: {"type":"QUEUE_UP');
  });

  it("handles a complete frame followed by partial data", () => {
    const raw = 'data: {"type":"TIMEOUT"}\n\ndata: {"type":"QU';
    const { events, remainder } = parseSSEChunk(raw);
    expect(events).toEqual(['{"type":"TIMEOUT"}']);
    expect(remainder).toBe('data: {"type":"QU');
  });

  it("returns empty events for empty input", () => {
    const { events, remainder } = parseSSEChunk("");
    expect(events).toEqual([]);
    expect(remainder).toBe("");
  });

  it("ignores lines without data: prefix", () => {
    const raw = 'event: update\ndata: {"type":"TIMEOUT"}\n\n';
    const { events, remainder } = parseSSEChunk(raw);
    expect(events).toEqual(['{"type":"TIMEOUT"}']);
    expect(remainder).toBe("");
  });
});

// ─── helpers ────────────────────────────────────────────────────────────────

/** Build a ReadableStream from an array of string chunks. */
function makeStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.close();
      }
    },
  });
}

/** Build a ReadableStream that errors after yielding given chunks. */
function makeErrorStream(chunks: string[], error: Error): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i++]));
      } else {
        controller.error(error);
      }
    },
  });
}

// ─── connectToMatchingQueue ─────────────────────────────────────────────────

describe("connectToMatchingQueue", () => {
  const token = "test-token";
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fires onQueueUpdate when QUEUE_UPDATE event is received", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"QUEUE_UPDATE","position":2,"top5":["a","b"],"queueLength":5}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onQueueUpdate).toHaveBeenCalledWith(2, 5);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toContain("/api/v1/queue/join");
  });

  it("fires onMatchFound when MATCH_FOUND event is received", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"MATCH_FOUND","peer":"bob@test.com","matchedAt":1700000000000}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onMatchFound).toHaveBeenCalledWith("bob@test.com", 1700000000000);
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("fires onTimeout when TIMEOUT event is received", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"TIMEOUT"}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("DP", "Hard", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onTimeout).toHaveBeenCalled();
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("fires onError on non-ok HTTP response", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: "Already in queue" }),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("Already in queue");
  });

  it("fires onError with HTTP status fallback when JSON parse fails", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("parse failed")),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("HTTP 500");
  });

  it("fires onError when response has no body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: null,
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("No response stream");
  });

  it("silently ignores AbortError from fetch", async () => {
    const abortError = new DOMException("The operation was aborted.", "AbortError");
    fetchSpy.mockRejectedValueOnce(abortError);

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await new Promise((r) => setTimeout(r, 50));
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("fires onError on non-abort fetch failure", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("Network failure"));

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("Network failure");
  });

  it("fires onError for non-Error fetch rejection", async () => {
    fetchSpy.mockRejectedValueOnce("string error");

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("Connection failed");
  });

  it("does not fire onError when stream closes after MATCH_FOUND", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"MATCH_FOUND","peer":"x@y.com","matchedAt":1700000000000}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onMatchFound).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("does not fire onError when stream closes after TIMEOUT", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"TIMEOUT"}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onTimeout).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("fires onError when stream errors unexpectedly without a terminal event", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeErrorStream(
        ['data: {"type":"QUEUE_UPDATE","position":1,"top5":[],"queueLength":1}\n\n'],
        new Error("Connection lost"),
      ),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
    expect(callbacks.onError.mock.calls[0][0].message).toBe("Connection lost");
  });

  it("does not fire onError when stream errors after MATCH_FOUND", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeErrorStream(
        ['data: {"type":"MATCH_FOUND","peer":"x@y.com","matchedAt":1700000000000}\n\n'],
        new Error("Connection reset"),
      ),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onMatchFound).toHaveBeenCalled();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("wraps non-Error stream exceptions in Error", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeErrorStream([], new Error("boom")),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onError).toHaveBeenCalled();
    });
  });

  it("skips malformed JSON in SSE data", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: NOT_JSON\n\n' +
        'data: {"type":"TIMEOUT"}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onTimeout).toHaveBeenCalled();
    });
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it("sends correct request headers and body", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Graphs", "Hard", "my-jwt", callbacks);

    await vi.waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/v1/queue/join");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer my-jwt",
    });
    expect(JSON.parse(opts.body)).toEqual({ topic: "Graphs", difficulty: "Hard" });
  });

  it("returns an AbortController", () => {
    fetchSpy.mockResolvedValue({ ok: true, body: makeStream([]) });
    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };
    const controller = connectToMatchingQueue("Arrays", "Easy", token, callbacks);
    expect(controller).toBeInstanceOf(AbortController);
  });

  it("handles multiple QUEUE_UPDATE events across chunks", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      body: makeStream([
        'data: {"type":"QUEUE_UPDATE","position":3,"top5":["a","b","c"],"queueLength":10}\n\n',
        'data: {"type":"QUEUE_UPDATE","position":1,"top5":["a"],"queueLength":8}\n\n',
      ]),
    });

    const callbacks = {
      onQueueUpdate: vi.fn(),
      onMatchFound: vi.fn(),
      onTimeout: vi.fn(),
      onError: vi.fn(),
    };

    connectToMatchingQueue("Arrays", "Easy", token, callbacks);

    await vi.waitFor(() => {
      expect(callbacks.onQueueUpdate).toHaveBeenCalledTimes(2);
    });
    expect(callbacks.onQueueUpdate).toHaveBeenNthCalledWith(1, 3, 10);
    expect(callbacks.onQueueUpdate).toHaveBeenNthCalledWith(2, 1, 8);
  });
});

// ─── leaveQueue ─────────────────────────────────────────────────────────────

describe("leaveQueue", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends POST to /queue/leave with auth header", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchSpy as typeof fetch;

    await leaveQueue("my-token");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain("/api/v1/queue/leave");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toMatchObject({
      Authorization: "Bearer my-token",
    });
  });

  it("swallows network errors", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error")) as typeof fetch;
    await expect(leaveQueue("token")).resolves.toBeUndefined();
  });

  it("swallows HTTP errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as typeof fetch;
    await expect(leaveQueue("token")).resolves.toBeUndefined();
  });
});
