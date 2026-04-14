import { beforeEach, describe, expect, it, vi } from "vitest";

let store = new Map();

function makeSnapshot(id, data) {
  return {
    id,
    exists: data !== undefined,
    data: () => data,
  };
}

function buildCollectionRef() {
  return {
    doc: vi.fn((id) => ({
      set: vi.fn(async (payload, options) => {
        const current = store.get(id) || {};
        const next = options?.merge ? { ...current, ...payload } : payload;
        store.set(id, next);
      }),
      get: vi.fn(async () => makeSnapshot(id, store.get(id))),
      update: vi.fn(async (updates) => {
        const current = store.get(id);
        if (!current) {
          throw new Error("not-found");
        }
        store.set(id, { ...current, ...updates });
      }),
      delete: vi.fn(async () => {
        store.delete(id);
      }),
    })),
    where: vi.fn((field, _operator, value) => ({
      limit: vi.fn((n) => ({
        get: vi.fn(async () => {
          const matches = [];
          for (const [id, data] of store.entries()) {
            if (data?.[field] === value) {
              matches.push(makeSnapshot(id, data));
            }
          }

          const docs = matches.slice(0, n);
          return {
            empty: docs.length === 0,
            docs,
          };
        }),
      })),
    })),
    get: vi.fn(async () => ({
      docs: Array.from(store.entries()).map(([id, data]) => makeSnapshot(id, data)),
    })),
  };
}

vi.mock("../config/firebase.js", () => ({
  default: {
    firestore: () => ({
      collection: () => buildCollectionRef(),
    }),
  },
}));


const {
  createUser,
  findUserByEmail,
  findUserByFirebaseUuid,
  findUserByUsernameOrEmail,
  updateUserById,
} = await import("../model/firebase-repository.js");

describe("firebase-repository", () => {
  beforeEach(() => {
    store = new Map();
    vi.clearAllMocks();
  });

  it("createUser stores user and can be found by firebase uuid", async () => {
    const user = await createUser({
      firebaseuuid: "uid-1",
      email: "a@example.com",
      username: "alice",
      role: "user",
    });

    expect(user.id).toBe("uid-1");
    expect(user.firebaseuuid).toBe("uid-1");

    const found = await findUserByFirebaseUuid("uid-1");
    expect(found?.email).toBe("a@example.com");
  });

  it("findUserByEmail returns null when not found", async () => {
    const found = await findUserByEmail("missing@example.com");
    expect(found).toBeNull();
  });

  it("findUserByUsernameOrEmail finds by email fallback", async () => {
    await createUser({
      firebaseuuid: "uid-2",
      email: "b@example.com",
      username: "bob",
    });

    const found = await findUserByUsernameOrEmail("unknown", "b@example.com");
    expect(found?.id).toBe("uid-2");
    expect(found?.username).toBe("bob");
  });

  it("updateUserById updates profile fields", async () => {
    await createUser({
      firebaseuuid: "uid-3",
      email: "c@example.com",
      username: "carol",
    });

    const updated = await updateUserById("uid-3", { username: "carol-new" });

    expect(updated?.username).toBe("carol-new");
    expect(updated?.updatedAt).toBeDefined();
  });
});
