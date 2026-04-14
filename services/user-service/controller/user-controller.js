import admin from "../config/firebase.js";
import { USER_ROLES, isValidRole } from "../constants/roles.js";
import {
  deleteUserById,
  findAllUsers,
  findUserById,
  findUserByUsername,
  updateUserById,
  updateUserPrivilegeById,
} from "../model/firebase-repository.js";
import { setUserRoleClaim } from "../helper/firebase-auth-helper.js";

/**
 * Get Single User by ID
 * 
 * Retrieves user profile information for a specific user ID.
 * 
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 *              Users can only access their own profile, admins can access any user
 * 
 * @param {Request} req Express request object containing user id parameter
 * @param {Response} res Express response object
 */
export async function getUser(req, res) {
  try {
    const userId = req.params.id;
    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    return res
      .status(200)
      .json({ message: "Found user", data: formatUserResponse(user) });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Unknown error when getting user!" });
  }
}

/**
 * Get All Users
 * 
 * Returns list of all registered users in the system.
 * 
 * PERMISSIONS: Requires verifyIsAdmin middleware
 *              ONLY administrators may call this endpoint
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function getAllUsers(req, res) {
  try {
    const users = await findAllUsers();

    return res
      .status(200)
      .json({ message: "Found users", data: users.map(formatUserResponse) });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Unknown error when getting all users!" });
  }
}

/**
 * Update User Profile
 * 
 * Updates user profile information. Currently only allows updating username.
 * 
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 * 
 * Business Rules:
 * - Usernames must be globally unique across the entire system
 * - Duplicate usernames are rejected
 * - Users can only change their own username unless they are admin
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function updateUser(req, res) {
  try {
    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ message: "Username is missing!" });
    }

    const userId = req.params.id;
    const user = await findUserById(userId);
    if (!user) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    const existingUser = await findUserByUsername(username);
    if (existingUser && existingUser.id !== userId) {
      return res.status(400).json({ message: "Username already exists" });
    }

    const updatedUser = await updateUserById(userId, { username });

    return res.status(200).json({
      message: `Updated data for user ${userId}`,
      data: formatUserResponse(updatedUser),
    });
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json({ message: "Unknown error when updating user!" });
  }
}

/**
 * Update User Role / Privilege
 * 
 * Changes a user's system role (user <-> admin).
 * This is the single authority for role changes in the entire system.
 * 
 * PERMISSIONS: Requires verifyIsAdmin middleware
 *              ONLY administrators may modify user roles
 * 
 * IMPORTANT ARCHITECTURE NOTE:
 * This operation updates BOTH:
 * 1. Firestore user document (persistent source of truth)
 * 2. Firebase Custom Claims (embedded in all future JWT tokens)
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function updateUserPrivilege(req, res) {
  try {
    const { role } = req.body;
    const userId = req.params.id;

    if (!isValidRole(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const updatedUser = await updateUserPrivilegeById(userId, role);
    
    // Update Firebase so future tokens have new role
    await setUserRoleClaim(updatedUser.firebaseuuid, role);

    return res.status(200).json({
      message: `Updated privilege for user ${userId}`,
      data: formatUserResponse(updatedUser),
    });
  } catch (err) {
    console.error(err);
    
    // Pass through known error messages from repository
    if (err.message.includes("not found")) {
      return res.status(404).json({ message: err.message });
    }
    
    if (err.message.includes("last remaining administrator")) {
      return res.status(400).json({ message: err.message });
    }

    return res
      .status(500)
      .json({ message: "Unknown error when updating user privilege!" });
  }
}

/**
 * Delete User
 * 
 * Permanently removes a user from the system.
 * 
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 * 
 * IMPLEMENTATION NOTE:
 * Uses best effort pattern for Firebase deletion:
 * 1. Always delete Firestore record first (this is authoritative)
 * 2. Attempt to delete Firebase Auth account
 * 3. If Firebase deletion fails, LOG ERROR BUT RETURN SUCCESS
 * 
 * This ensures users are always removed from our system even if Firebase
 * experiences temporary downtime. Orphaned Firebase accounts are harmless.
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function deleteUser(req, res) {
  try {
    const userId = req.params.id;

    const deletedUser = await deleteUserById(userId);

    if (!deletedUser) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    try {
      await admin.auth().deleteUser(userId);
    } catch (authErr) {
      console.error(`Failed to delete Firebase Auth account for ${userId}:`, authErr.message);
    }

    return res
      .status(200)
      .json({ message: `Deleted user ${userId} successfully` });
  } catch (err) {
    console.error(err);
    
    // Pass through known error messages from repository
    if (err.message.includes("last remaining administrator")) {
      return res.status(400).json({ message: err.message });
    }

    return res
      .status(500)
      .json({ message: "Unknown error when deleting user!" });
  }
}

/**
 * Safe User Response Serializer
 * 
 * Whitelists exactly which fields are returned from user API endpoints.
 * Prevents accidental exposure of sensitive internal fields.
 * 
 * ALL user responses from this service MUST pass through this function.
 * 
 * @param {Object} user Raw user document from database
 * @returns {Object} Safe serialized user object for API responses
 */
export function formatUserResponse(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}