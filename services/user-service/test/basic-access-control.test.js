import { describe, expect, it, vi } from "vitest";
import { verifyIsAdmin, verifyIsOwnerOrAdmin } from "../middleware/basic-access-control.js";

const FORBIDDEN_MESSAGE = "Not authorized to access this resource";

function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
  };

  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (payload) => {
    res.body = payload;
    return res;
  };

  return res;
}

describe("basic-access-control middleware", () => {
  it("verifyIsAdmin calls next when user is admin", () => {
    const req = { user: { role: "admin" } };
    const res = createMockRes();
    const next = vi.fn();

    verifyIsAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.statusCode).toBeNull();
  });

  it("verifyIsAdmin returns 403 when user is not admin", () => {
    const req = { user: { role: "user" } };
    const res = createMockRes();
    const next = vi.fn();

    verifyIsAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ message: FORBIDDEN_MESSAGE });
  });

  it("verifyIsOwnerOrAdmin calls next when request user owns target resource", () => {
    const req = {
      user: { id: "owner-id", role: "user" },
      params: { id: "owner-id" },
    };
    const res = createMockRes();
    const next = vi.fn();

    verifyIsOwnerOrAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("verifyIsOwnerOrAdmin returns 403 when user is neither owner nor admin", () => {
    const req = {
      user: { id: "user-1", role: "user" },
      params: { id: "different-user" },
    };
    const res = createMockRes();
    const next = vi.fn();

    verifyIsOwnerOrAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ message: FORBIDDEN_MESSAGE });
  });
});
