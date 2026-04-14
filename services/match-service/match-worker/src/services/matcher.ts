import { redis, queueKey, userMetaKey, queueUpdateChannel } from './redis';

// Atomically pop two users from the queue if 2+ exist
const matchScript = `
local key = KEYS[1]
local count = redis.call('ZCARD', key)
if count < 2 then return {} end
local members = redis.call('ZRANGE', key, 0, 1)
redis.call('ZREM', key, members[1], members[2])
return members
`;

export async function tryMatchQueue(
  topic: string,
  difficulty: string
): Promise<[string, string] | null> {
  const key = queueKey(topic, difficulty);
  const result = (await redis.eval(matchScript, 1, key)) as string[];
  if (!result || result.length < 2) return null;
  return [result[0], result[1]];
}

export async function getAllQueueKeys(): Promise<string[]> {
  const keys: string[] = [];
  let cursor = '0';
  do {
    const [nextCursor, batch] = await redis.scan(
      cursor, 'MATCH', 'queue:*:*', 'COUNT', 100
    );
    cursor = nextCursor;
    keys.push(...batch);
  } while (cursor !== '0');
  // Exclude the pub/sub channel keys
  return keys.filter(k => !k.startsWith('queue:upd:'));
}

export async function publishMatch(
  user1: string,
  user2: string,
  topic: string,
  difficulty: string
) {
  const channel = queueUpdateChannel(topic, difficulty);
  const matchedAt = Date.now();
  await Promise.all([
    redis.publish(`match:${user1}`, JSON.stringify({ peer: user2, matchedAt })),
    redis.publish(`match:${user2}`, JSON.stringify({ peer: user1, matchedAt })),
    redis.publish(channel, JSON.stringify({ topic, difficulty })),
    redis.del(userMetaKey(user1)),
    redis.del(userMetaKey(user2)),
  ]);
}