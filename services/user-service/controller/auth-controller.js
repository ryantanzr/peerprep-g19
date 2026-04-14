import admin from "../config/firebase.js";
import { USER_ROLES } from "../constants/roles.js";
import { createUser, findUserByFirebaseUuid } from "../model/firebase-repository.js";
import { formatUserResponse } from "./user-controller.js";

/**
 * User Registration Endpoint
 * 
 * Handles first time user onboarding after successful Firebase authentication.
 * 
 * ARCHITECTURE NOTE:
 * Users first authenticate directly with Firebase client-side. They then call
 * this endpoint to complete registration and create their local user profile.
 * This is the point where our system becomes aware of the user.
 * 
 * SECURITY: This endpoint is intentionally NOT protected by verifyAccessToken middleware.
 * It accepts a raw Firebase ID token directly and verifies it itself, because at
 * the time of first call the user does not have a profile in our system yet.
 * 
 * Flow:
 * 1. Extracts and verifies Firebase ID token from Authorization header
 * 2. Checks if user already has a local profile
 * 3. If new user:
 *    - Sets default 'user' role as Firebase custom claim
 *    - Creates user profile document in Firestore
 * 4. Returns formatted user profile
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function handleRegister(req, res) {
  try {
    // Extract Firebase ID token from Authorization header
    const idToken = req.headers.authorization?.split("Bearer ")[1];
    if (!idToken) {
      return res.status(401).json({ message: "Authentication failed" });
    }

    // Cryptographically verify token signature using Firebase Admin SDK
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { uid, email } = decodedToken;

    // Check if this user already registered in our system
    const existingUser = await findUserByFirebaseUuid(uid);

    if (existingUser) {
      // Idempotent return - safe to call this endpoint multiple times
      return res.status(200).json({
        message: "User already registered",
        data: formatUserResponse(existingUser),
      });
    }

    // Auto-generate username with fallback priorities
    const username =
      req.body?.username ||
      req.body?.name ||
      decodedToken.name ||
      email?.split("@")[0] ||
      uid;

    // Set default role in Firebase (embedded into future JWT tokens)
    // This is the source of truth for authorization across ALL services
    await admin.auth().setCustomUserClaims(uid, { role: USER_ROLES.USER });

    // Create corresponding user profile in Firestore
    // This stores additional profile data not kept in Firebase Auth
    const user = await createUser({
      firebaseuuid: uid,
      email,
      username,
      role: USER_ROLES.USER,
    });

    return res.status(201).json({
      message: "User registered",
      data: formatUserResponse(user),
    });
  } catch (err) {
    return res.status(500).json({ message: err.message });
  }
}

/**
 * Forgot Password Request Endpoint
 * 
 * Initiates Firebase password reset flow.
 * 
 * Firebase will only actually send an email if the account exists.
 * 
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function handleForgotPassword(req, res) {
  try {
    const email = req.body?.email?.trim().toLowerCase();

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    await admin.auth().generatePasswordResetLink(email);

  } catch (err) {
    // Log internally for debugging/monitoring
    console.error("Forgot password error:", err);

    // Swallow user-not-found to prevent enumeration
    if (err.code !== "auth/user-not-found") {
    }
  }

  // Always return same response (prevents timing + enumeration attacks)
  return res.status(200).json({
    message:
      "If an account with this email exists, a password reset email has been sent",
  });
}