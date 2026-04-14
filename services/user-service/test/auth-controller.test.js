import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRes } from "./test-utils.js";

const verifyIdTokenMock = vi.fn();
const setCustomUserClaimsMock = vi.fn();
const getUserByEmailMock = vi.fn();
const generatePasswordResetLinkMock = vi.fn();
const createUserMock = vi.fn();
const findUserByFirebaseUuidMock = vi.fn();

vi.mock("../config/firebase.js", () => ({
  default: {
    auth: () => ({
      verifyIdToken: verifyIdTokenMock,
      setCustomUserClaims: setCustomUserClaimsMock,
      getUserByEmail: getUserByEmailMock,
      generatePasswordResetLink: generatePasswordResetLinkMock,
    }),
  },
}));

vi.mock("../model/firebase-repository.js", () => ({
  createUser: createUserMock,
  findUserByFirebaseUuid: findUserByFirebaseUuidMock,
}));

vi.mock("../controller/user-controller.js", () => ({
  formatUserResponse: (user) => user,
}));

const { handleForgotPassword, handleRegister } = await import(
  "../controller/auth-controller.js"
);

describe("auth-controller Firebase flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handleRegister returns 201 when Firebase token is valid", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "firebase-uid-1",
      email: "user@example.com",
    });
    findUserByFirebaseUuidMock.mockResolvedValueOnce(null);
    setCustomUserClaimsMock.mockResolvedValueOnce();
    createUserMock.mockResolvedValueOnce({
      id: "mongo-id-1",
      username: "Test User",
      email: "user@example.com",
      firebaseuuid: "firebase-uid-1",
      role: "user",
    });

    const req = {
      body: { name: "Test User" },
      headers: { authorization: "Bearer id-token" },
    };
    const res = createMockRes();

    await handleRegister(req, res);

    expect(verifyIdTokenMock).toHaveBeenCalledWith("id-token");
    expect(setCustomUserClaimsMock).toHaveBeenCalledWith("firebase-uid-1", {
      role: "user",
    });
    expect(createUserMock).toHaveBeenCalledWith({
      firebaseuuid: "firebase-uid-1",
      email: "user@example.com",
      username: "Test User",
      role: "user",
    });
    expect(res.statusCode).toBe(201);
    expect(res.body.message).toBe("User registered");
  });

  it("handleRegister returns 200 when user already exists", async () => {
    verifyIdTokenMock.mockResolvedValueOnce({
      uid: "firebase-uid-1",
      email: "user@example.com",
    });
    findUserByFirebaseUuidMock.mockResolvedValueOnce({
      id: "mongo-id-1",
      username: "Test User",
      email: "user@example.com",
      firebaseuuid: "firebase-uid-1",
      role: "user",
    });

    const req = {
      body: { name: "Test User" },
      headers: { authorization: "Bearer existing-token" },
    };
    const res = createMockRes();

    await handleRegister(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("User already registered");
    expect(setCustomUserClaimsMock).not.toHaveBeenCalled();
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("handleRegister returns 500 when Firebase token verification fails", async () => {
    verifyIdTokenMock.mockRejectedValueOnce(new Error("invalid token"));

    const req = {
      body: { name: "Test User" },
      headers: { authorization: "Bearer bad-token" },
    };
    const res = createMockRes();

    await handleRegister(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body.message).toBe("invalid token");
  });

  it("handleForgotPassword returns 400 when email is missing", async () => {
    const req = { body: {} };
    const res = createMockRes();

    await handleForgotPassword(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Email is required");
    expect(getUserByEmailMock).not.toHaveBeenCalled();
    expect(generatePasswordResetLinkMock).not.toHaveBeenCalled();
  });

  it("handleForgotPassword returns success without leaking reset link", async () => {
    getUserByEmailMock.mockResolvedValueOnce({ uid: "firebase-uid-1" });
    generatePasswordResetLinkMock.mockResolvedValueOnce(
      "https://example.com/reset-link"
    );

    const req = { body: { email: "user@example.com" } };
    const res = createMockRes();

    await handleForgotPassword(req, res);

    expect(generatePasswordResetLinkMock).toHaveBeenCalledWith("user@example.com");
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe("If an account with this email exists, a password reset email has been sent");
    expect(res.body.data).toBeUndefined();
  });

  it("handleForgotPassword returns generic success when user is not found", async () => {
    const err = new Error("missing user");
    err.code = "auth/user-not-found";
    getUserByEmailMock.mockRejectedValueOnce(err);

    const req = { body: { email: "missing@example.com" } };
    const res = createMockRes();

    await handleForgotPassword(req, res);

    expect(generatePasswordResetLinkMock).toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toBe(
      "If an account with this email exists, a password reset email has been sent"
    );
  });
});
