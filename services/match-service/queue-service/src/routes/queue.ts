import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import {
  redis,
  redisSub,
  queueKey,
  userMetaKey,
  queueUpdateChannel,
} from '../services/redis';
import { addConnection, sendEvent, closeConnection } from '../services/sse';
import { watchQueue, unwatchQueue } from '../services/broadcaster';
import { config } from '../config';
import { Difficulty, QueueEntry } from '../types';

const router = Router();

/**
 * Main queue endpoint that handles user joining and real-time updates
 * 
 * Flow:
 * 1. Authenticate user
 * 2. Resolve queue parameters (topic + difficulty)
 * 3. Open SSE connection for real-time updates
 * 4. Add user to Redis queue
 * 5. Send immediate position update
 * 6. Listen for match events
 * 7. Handle cleanup on disconnect/timeout/match
 */

// ── GET /queue/join ───────────────────────────────────────────────────────────
// Opens an SSE stream. Joins the queue immediately if topic+difficulty are
// provided as query params. If the user is already in a queue in Redis
// (e.g. they refreshed the tab), resumes that session instead.
//
// Usage:
//   GET /queue/join?topic=arrays&difficulty=medium
//   Authorization: Bearer <token>
//
// Tab close / network drop → req 'close' event → user auto-removed from queue.

router.get('/join', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  // --- 1. Resolve queue params ---
  // Check if user is already sitting in a Redis queue (e.g. page refresh)
  const existingMeta = await redis.hgetall(userMetaKey(userId));
  const isResuming = !!existingMeta?.topic;

  let topic: string;
  let difficulty: Difficulty;

  if (isResuming) {
    // Resume the existing queue session — ignore any query params
    topic = existingMeta.topic;
    difficulty = existingMeta.difficulty as Difficulty;
  } else {
    // Fresh join — require query params
    const rawTopic = req.query.topic as string | undefined;
    const rawDifficulty = req.query.difficulty as string | undefined;

    if (!rawTopic || !rawDifficulty) {
      res.status(400).json({ error: 'topic and difficulty query params are required' });
      return;
    }
    if (!['easy', 'medium', 'hard'].includes(rawDifficulty)) {
      res.status(400).json({ error: 'difficulty must be easy, medium, or hard' });
      return;
    }

    topic = rawTopic;
    difficulty = rawDifficulty as Difficulty;
  }

  // Prepare Redis keys and channels for this queue
  const key = queueKey(topic, difficulty);           // Sorted set for queue order
  const channel = queueUpdateChannel(topic, difficulty); // Pub/sub for queue updates
  const matchChannel = `match:${userId}`;            // User-specific match notifications

  // --- 2. Open SSE stream immediately ---
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // --- 3. Add to queue (or confirm already in it) ---
  if (isResuming) {
    // User is already in the sorted set — just reconnect the SSE
    sendEvent(userId, {
      type: 'QUEUE_UPDATE',
      position: 0,
      top5: [],
      queueLength: 0,
      status: 'resumed',
    } as any);
  } else {
    // Atomically add to sorted set + store metadata
    const entry: QueueEntry = { userId, topic, difficulty, joinedAt: Date.now() };
    const pipeline = redis.pipeline();
    pipeline.zadd(key, entry.joinedAt, userId);
    pipeline.hset(userMetaKey(userId), {
      topic,
      difficulty,
      joinedAt: String(entry.joinedAt),
    });
    await pipeline.exec();

    // Notify other watchers someone joined
    await redis.publish(channel, JSON.stringify({ topic, difficulty }));
  }

  // --- 4. Register SSE connection + broadcaster watcher ---
  addConnection(userId, res);
  await watchQueue(userId, topic, difficulty);
  await redisSub.subscribe(matchChannel);

  // --- 5. Send immediate position snapshot ---
  const [rank, queueLength, top5] = await Promise.all([
    redis.zrank(key, userId),
    redis.zcard(key),
    redis.zrange(key, 0, 4),
  ]);
  if (rank !== null) {
    sendEvent(userId, {
      type: 'QUEUE_UPDATE',
      position: rank + 1,
      top5,
      queueLength,
    });
  }

  // --- 6. Listen for match events from the match worker ---
  const onMessage = async (channel: string, message: string) => {
    if (channel === matchChannel) {
      const { peer, matchedAt } = JSON.parse(message) as { peer: string; matchedAt: number };
      sendEvent(userId, { type: 'MATCH_FOUND', peer, matchedAt });
      await cleanup('matched');
    }
  };
  redisSub.on('message', onMessage);

  // --- 7. Timeout: remove user if no match within the window ---
  const timeoutHandle = setTimeout(async () => {
    sendEvent(userId, { type: 'TIMEOUT' });
    await cleanup('timeout');
  }, config.matchingTimeoutMs);

  // --- 8. Cleanup: runs on tab close, explicit leave, match, or timeout ---
  let cleanedUp = false;
  async function cleanup(reason: 'disconnect' | 'leave' | 'matched' | 'timeout') {
    if (cleanedUp) return;
    cleanedUp = true;

    console.log(`[queue] cleanup userId=${userId} reason=${reason}`);

    // Clean up timeout timer
    clearTimeout(timeoutHandle);
    
    // Stop listening for Redis messages
    redisSub.off('message', onMessage);
    await redisSub.unsubscribe(matchChannel);
    
    // Stop broadcasting updates for this user
    await unwatchQueue(userId, topic, difficulty);

    // Only remove from the Redis queue if they weren't matched
    // (match worker already removed them atomically via Lua script)
    if (reason !== 'matched') {
      await redis.zrem(key, userId);
      await redis.del(userMetaKey(userId));
      // Notify remaining watchers the queue shrank
      await redis.publish(channel, '{}');
    }

    // Close the SSE connection
    closeConnection(userId);
  }

  // Tab close or network drop — this is the key handler
  req.on('close', () => {
    cleanup('disconnect').catch(console.error);
  });

  // Attach cleanup to res so /leave can trigger it
  (res as any).__cleanup = () => cleanup('leave');
});

// ── POST /queue/leave ─────────────────────────────────────────────────────────
// Explicit leave (e.g. user clicks "Cancel"). Triggers the same cleanup as
// a tab close, then sends a 200. The SSE stream is closed server-side.

router.post('/leave', authenticate, async (req: AuthRequest, res: Response) => {
  const userId = req.userId!;

  // Try to find the active SSE response for this user
  const { getResponse } = await import('../services/sse');
  const activeRes = getResponse(userId);

  if (activeRes && (activeRes as any).__cleanup) {
    // If SSE is active, trigger its cleanup (which will close the connection)
    await (activeRes as any).__cleanup();
  } else {
    // No active SSE connection — clean up Redis directly as a fallback
    const meta = await redis.hgetall(userMetaKey(userId));
    if (meta?.topic) {
      // Remove user from queue and notify others
      const key = queueKey(meta.topic, meta.difficulty);
      const channel = queueUpdateChannel(meta.topic, meta.difficulty);
      await redis.zrem(key, userId);
      await redis.del(userMetaKey(userId));
      await redis.publish(channel, '{}');
    }
    // Ensure connection is closed even if not in active connections map
    closeConnection(userId);
  }

  res.json({ message: 'Left queue' });
});

export default router;