"use client";

import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from "react";
import {
  onIdTokenChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  GoogleAuthProvider,
  signInWithPopup,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { setToken, clearToken } from "@/lib/auth";
import { registerUser } from "@/lib/api/user";
import type { User } from "@/types/user";

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  forgotPassword: (email: string) => Promise<void>;
  loginWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

function mapFirebaseError(code: string): string {
  switch (code) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Invalid email or password";
    case "auth/user-not-found":
      return "No account found with this email";
    case "auth/email-already-in-use":
      return "An account with this email already exists";
    case "auth/weak-password":
      return "Password is too weak";
    case "auth/too-many-requests":
      return "Too many attempts. Please try again later.";
    case "auth/invalid-email":
      return "Invalid email address";
    default:
      return "An unexpected error occurred";
  }
}

function toFirebaseError(err: unknown): never {
  const code = (err as { code?: string }).code || "";
  throw new Error(mapFirebaseError(code));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const isRegistering = useRef(false);

  useEffect(() => {
    const unsubscribe = onIdTokenChanged(auth, async (firebaseUser) => {
      // Skip during explicit registration — register() handles user setup itself
      if (isRegistering.current) return;

      if (firebaseUser) {
        const idToken = await firebaseUser.getIdToken();
        setToken(idToken);

        // Fetch/create MongoDB user record via backend
        try {
          const res = await registerUser(firebaseUser.displayName || firebaseUser.email?.split("@")[0] || "user");
          setUser(res.data);
        } catch {
          // Token is valid but backend call failed — keep Firebase session, clear app user
          setUser(null);
        }
      } else {
        clearToken();
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // onIdTokenChanged will fire and set user + token
    } catch (err: unknown) {
      toFirebaseError(err);
    }
  }, []);

  const register = useCallback(async (username: string, email: string, password: string) => {
    isRegistering.current = true;
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const idToken = await cred.user.getIdToken();
      setToken(idToken);
      const res = await registerUser(username);
      setUser(res.data);
      setLoading(false);
    } catch (err: unknown) {
      // Firebase errors have a `code` property; API errors don't
      if ((err as { code?: string }).code) {
        toFirebaseError(err);
      }
      throw err instanceof Error ? err : new Error("Registration failed");
    } finally {
      isRegistering.current = false;
    }
  }, []);

  const forgotPassword = useCallback(async (email: string) => {
    try {
      await sendPasswordResetEmail(auth, email);
    } catch (err: unknown) {
      toFirebaseError(err);
    }
  }, []);

  const loginWithGoogle = useCallback(async () => {
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      const idToken = await cred.user.getIdToken();
      setToken(idToken);
      
      // Register user if not exists
      try {
        const res = await registerUser(cred.user.displayName || cred.user.email?.split("@")[0] || "user");
        setUser(res.data);
      } catch {
        // User already exists
      }
      
    } catch (err: unknown) {
      toFirebaseError(err);
    }
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    clearToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, forgotPassword, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
