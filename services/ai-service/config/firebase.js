const admin = require("firebase-admin");

if (!admin.apps.length) {
  const serviceKeyJson = process.env.FIREBASE_SERVICE_KEY;

  if (serviceKeyJson) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(serviceKeyJson)),
    });
  } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
      }),
    });
  } else if (process.env.NODE_ENV !== "test") {
    throw new Error("Firebase credentials missing. Set FIREBASE_SERVICE_KEY or FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY.");
  }
}

module.exports = admin;
