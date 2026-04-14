"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/providers/auth-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

function PasswordCheck({ label, met }: { label: string; met: boolean }) {
  return (
    <p className={`text-xs ${met ? "text-green-600" : "text-gray-400"}`}>
      {met ? "✓" : "■"} {label}
    </p>
  );
}

export function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const hasMinLength = password.length >= 8;
  const hasCase = /[a-z]/.test(password) && /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const passwordValid = hasMinLength && hasCase && hasDigit;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !email || !password) {
      setError("Please fill in all required fields");
      return;
    }
    if (!passwordValid) {
      setError("Password does not meet requirements");
      return;
    }

    setLoading(true);
    setError("");
    try {
      await register(username, email, password);
      router.push("/match");
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md space-y-6 rounded-lg bg-white p-8 shadow-sm border border-gray-200">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">Create Account</h1>
          <p className="mt-1 text-sm text-gray-500">Join PeerPrep today</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label="Username"
            placeholder="Choose a unique username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <Input
            label="Email"
            type="email"
            placeholder="your@email.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />

          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Input
                label="Password"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                onClick={() => setShowPassword(prev => !prev)}
                className="absolute right-3 bottom-2.5 text-sm text-gray-500 hover:text-gray-700 cursor-pointer"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <div className="space-y-0.5 mt-1">
              <PasswordCheck label="At least 8 characters" met={hasMinLength} />
              <PasswordCheck label="Upper & lowercase letter" met={hasCase} />
              <PasswordCheck label="At least 1 digit" met={hasDigit} />
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={loading || !passwordValid}>
            {loading ? "Creating account..." : "Create Account"}
          </Button>
        </form>

        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <p className="text-center text-sm text-gray-500">
          Already have an account?{" "}
          <Link href="/login" className="text-[#5568EE] hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
