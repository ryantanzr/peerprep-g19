import admin from "../config/firebase.js";
import { USER_ROLES } from "../constants/roles.js";

export const verifyAccessToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Authentication failed" });
  }

  const idToken = authHeader.split("Bearer ")[1];

  try {
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    req.user = decodedToken; // { uid, email, name, ... }
    next();
  } catch (error) {
    return res.status(401).json({ message: "Authentication failed" });
  }
};

export const verifyIsAdmin = (req, res, next) => {
  if (req.user?.role !== USER_ROLES.ADMIN) {
    return res
      .status(403)
      .json({ message: "Not authorized to access this resource" });
  }
  next();
};

export const verifyUserOrAdmin = (req, res, next) => {
  const validRoles = [USER_ROLES.USER, USER_ROLES.ADMIN];
  if (!validRoles.includes(req.user?.role)) {
    return res.status(403).json({ message: "Access required" });
  }
  next();
};

export const verifyIsOwnerOrAdmin = async (req, res, next) => {
  if (req.user?.role === USER_ROLES.ADMIN) {
    return next();
  }

  const ownerIdFromParams = req.params.uid || req.params.id;
  const userIdFromToken = req.user?.uid;

  if (!ownerIdFromParams || !userIdFromToken) {
    return res
      .status(403)
      .json({ message: "Not authorized to access this resource" });
  }

  if (ownerIdFromParams === userIdFromToken) {
    return next();
  }

  return res
    .status(403)
    .json({ message: "Not authorized to access this resource" });
};
