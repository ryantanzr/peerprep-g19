import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRes } from "./test-utils.js";

const repositoryMocks = {
  findUserByEmail: vi.fn(),
};

const bcryptMocks = {
  compare: vi.fn(),
};

const jwtMocks = {
  sign: vi.fn(),
};

vi.mock("../model/repository.js", () => ({
  findUserByEmail: repositoryMocks.findUserByEmail,
}));

vi.mock("bcrypt", () => ({
  default: bcryptMocks,
}));

vi.mock("jsonwebtoken", () => ({
  default: jwtMocks,
}));

const { handleLogin } = await import("../controller/auth-controller.js");

describe("auth-controller handleLogin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.JWT_SECRET = "test-secret";
  });

  it("returns 400 when email or password is missing", async () => {
    const req = { body: { email: "john@example.com" } };
    const res = createMockRes();

    await handleLogin(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ message: "Missing email and/or password" });
  });

  it("returns 401 for unknown user", async () => {
    repositoryMocks.findUserByEmail.mockResolvedValueOnce(null);

    const req = { body: { email: "john@example.com", password: "password123" } };
    const res = createMockRes();

    await handleLogin(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({ message: "Wrong email and/or password" });
  });

  it("returns 200 with access token for valid credentials", async () => {
    repositoryMocks.findUserByEmail.mockResolvedValueOnce({
      id: "user-1",
      username: "john",
      email: "john@example.com",
      password: "hashed-password",
      role: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    bcryptMocks.compare.mockResolvedValueOnce(true);
    jwtMocks.sign.mockReturnValueOnce("token-value");

    const req = { body: { email: "john@example.com", password: "password123" } };
    const res = createMockRes();

    await handleLogin(req, res);

    expect(jwtMocks.sign).toHaveBeenCalledWith(
      { id: "user-1", role: "user" },
      "test-secret",
      { expiresIn: "1d" },
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data.accessToken).toBe("token-value");
    expect(res.body.data).toMatchObject({
      id: "user-1",
      username: "john",
      email: "john@example.com",
      role: "user",
    });
  });
});
