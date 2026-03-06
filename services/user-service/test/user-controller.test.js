import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockRes } from "./test-utils.js";

const repositoryMocks = {
  createUser: vi.fn(),
  findUserByUsernameOrEmail: vi.fn(),
};

const bcryptMocks = {
  genSaltSync: vi.fn(),
  hashSync: vi.fn(),
};

vi.mock("../model/repository.js", () => ({
  createUser: repositoryMocks.createUser,
  findUserByUsernameOrEmail: repositoryMocks.findUserByUsernameOrEmail,
  deleteUserById: vi.fn(),
  findAllUsers: vi.fn(),
  findUserByEmail: vi.fn(),
  findUserById: vi.fn(),
  findUserByUsername: vi.fn(),
  updateUserById: vi.fn(),
  updateUserPrivilegeById: vi.fn(),
}));

vi.mock("bcrypt", () => ({
  default: bcryptMocks,
}));

const { createUser } = await import("../controller/user-controller.js");

describe("user-controller createUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 when required fields are missing", async () => {
    const req = { body: { username: "john" } };
    const res = createMockRes();

    await createUser(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("missing");
  });

  it("returns 409 when username or email already exists", async () => {
    repositoryMocks.findUserByUsernameOrEmail.mockResolvedValueOnce({ id: "existing-id" });

    const req = {
      body: {
        username: "john",
        email: "john@example.com",
        password: "password123",
      },
    };
    const res = createMockRes();

    await createUser(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ message: "username or email already exists" });
  });

  it("returns 201 with formatted user when creation succeeds", async () => {
    repositoryMocks.findUserByUsernameOrEmail.mockResolvedValueOnce(null);
    bcryptMocks.genSaltSync.mockReturnValueOnce("salt");
    bcryptMocks.hashSync.mockReturnValueOnce("hashed-password");
    repositoryMocks.createUser.mockResolvedValueOnce({
      id: "abc123",
      username: "john",
      email: "john@example.com",
      role: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
      password: "hashed-password",
    });

    const req = {
      body: {
        username: "john",
        email: "john@example.com",
        password: "password123",
      },
    };
    const res = createMockRes();

    await createUser(req, res);

    expect(bcryptMocks.hashSync).toHaveBeenCalledWith("password123", "salt");
    expect(repositoryMocks.createUser).toHaveBeenCalledWith(
      "john",
      "john@example.com",
      "hashed-password",
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.data).toEqual({
      id: "abc123",
      username: "john",
      email: "john@example.com",
      role: "user",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
