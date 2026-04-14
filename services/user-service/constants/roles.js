/**
 * System User Roles Enumeration
 *
 * Roles are stored in two locations:
 * 1. Firestore user document (persistent source of truth)
 * 2. Firebase Auth Custom Claims (cached inside JWT tokens for 60 minutes)
 */
export const USER_ROLES = Object.freeze({
  ADMIN: "admin",
  USER: "user",
});

/**
 * Validates if a given value is a valid system role
 * @param {string} role Role value to validate
 * @returns {boolean} True if value is a valid role
 */
export const isValidRole = (role) => Object.values(USER_ROLES).includes(role);