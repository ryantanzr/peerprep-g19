import { createRemoteJWKSet, jwtVerify } from "jose";

// Google's public key endpoint for Firebase Auth tokens
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export async function verifyToken(
  token: string,
  projectId: string | undefined,
): Promise<{ uid: string; email?: string } | null> {
  if (!projectId) {
    console.warn("FIREBASE_PROJECT_ID not set — skipping token verification");
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const uid = payload.sub;
    if (!uid) return null;

    return { uid, email: payload.email as string | undefined };
  } catch {
    return null;
  }
}
