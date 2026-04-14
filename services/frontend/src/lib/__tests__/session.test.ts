import { describe, it, expect } from "vitest";
import { generateSessionId } from "../session";

describe("generateSessionId", () => {
  const now = Date.now();

  it("produces the same ID regardless of email order", async () => {
    const a = await generateSessionId("alice@test.com", "bob@test.com", now);
    const b = await generateSessionId("bob@test.com", "alice@test.com", now);
    expect(a).toBe(b);
  });

  it("is case-insensitive", async () => {
    const a = await generateSessionId("Alice@Test.com", "BOB@test.com", now);
    const b = await generateSessionId("alice@test.com", "bob@test.com", now);
    expect(a).toBe(b);
  });

  it("returns a 16-character hex string", async () => {
    const id = await generateSessionId("a@b.com", "c@d.com", now);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different IDs for different email pairs", async () => {
    const a = await generateSessionId("alice@test.com", "bob@test.com", now);
    const b = await generateSessionId("alice@test.com", "charlie@test.com", now);
    expect(a).not.toBe(b);
  });

  it("produces different IDs in different time buckets", async () => {
    const t1 = new Date("2026-03-09T12:00:00Z").getTime();
    const t2 = new Date("2026-03-09T12:06:00Z").getTime(); // 6 min later = different bucket

    const a = await generateSessionId("a@b.com", "c@d.com", t1);
    const b = await generateSessionId("a@b.com", "c@d.com", t2);
    expect(a).not.toBe(b);
  });

  it("produces the same ID within the same time bucket", async () => {
    const t1 = new Date("2026-03-09T12:00:00Z").getTime();
    const t2 = new Date("2026-03-09T12:04:00Z").getTime(); // 4 min later = same bucket

    const a = await generateSessionId("a@b.com", "c@d.com", t1);
    const b = await generateSessionId("a@b.com", "c@d.com", t2);
    expect(a).toBe(b);
  });
});
