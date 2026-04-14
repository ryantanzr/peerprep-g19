import "dotenv/config";
import admin from "../config/firebase.js";
import { USER_ROLES } from "../constants/roles.js";
import {
  findUserByFirebaseUuid,
  updateUserPrivilegeById,
} from "../model/firebase-repository.js";

const setRole = async (uid, role = USER_ROLES.ADMIN) => {
  const user = await findUserByFirebaseUuid(uid);
  if (!user) {
    throw new Error(`No Firestore user found for firebaseuuid=${uid}`);
  }

  await updateUserPrivilegeById(uid, role);
  await admin.auth().setCustomUserClaims(uid, { role });

  console.log(`Updated Firestore role to '${role}' for user ${uid}`);
  console.log(`Updated Firebase custom claim role='${role}' for uid ${uid}`);
};

const uid = process.argv[2];
const role = process.argv[3] || "admin";

if (!uid) {
  console.error("Usage: node scripts/firstAdmin.js <firebase_uid> [role]");
  process.exit(1);
}

setRole(uid, role)
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
