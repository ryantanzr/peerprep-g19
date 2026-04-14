/**
 * Generate a deterministic session ID from two email addresses.
 * Both users independently compute the same ID regardless of order.
 * Uses a shared matchedAt timestamp from the server to avoid time-bucket boundary races.
 */
export async function generateSessionId(email1: string, email2: string, matchedAt: number): Promise<string> {
  const sorted = [email1.toLowerCase(), email2.toLowerCase()].sort();
  const timeBucket = Math.floor(matchedAt / 300_000); // 5-minute window
  const input = `${sorted.join(":")}:${timeBucket}`;

  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
}
