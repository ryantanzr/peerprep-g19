const admin = require("../config/firebase");

async function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ message: "No token provided" });
  }

  try {
    const decodedToken = await admin.auth().verifyIdToken(token);

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      role: decodedToken.role || "user",
    };
    next();
  } catch (error) {
    return res.status(403).json({ message: "Invalid token" });
  }
}

module.exports = {
  authenticateToken,
};
