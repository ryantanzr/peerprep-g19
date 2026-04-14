"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { updateUser, deleteUser } from "@/lib/api/user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api/client";

export default function ProfilePage() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  // Sync form fields when user data loads (useState initial value only runs once)
  useEffect(() => {
    if (user) {
      setUsername(user.username || "");
      setEmail(user.email || "");
    }
  }, [user]);

  if (!user) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const data: Record<string, string> = {};
      data.username = username;
      data.email = email;

      if (password) data.password = password;

      if (Object.keys(data).length === 0) {
        setError("No changes to save");
        setSaving(false);
        return;
      }
      await updateUser(user.id, data);
      toast("Profile updated", "success");
      setPassword("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (deleteConfirm !== "DELETE") return;
    setDeleting(true);
    try {
      await deleteUser(user.id);
      logout();
      router.push("/login");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to delete account");
      setDeleting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">My Profile</h1>

      <form onSubmit={handleSave} className="space-y-4">
        <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <div>
          <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="relative">
          <Input
            label="New Password"
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
        <Button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </form>

      {error && (
        <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      <div className="mt-10 border-t border-gray-200 pt-6">
        <h2 className="text-lg font-semibold text-red-600 mb-3">Danger Zone</h2>
        <p className="text-sm text-gray-600 mb-2">
          To delete your account, type &quot;DELETE&quot; below:
        </p>
        <div className="flex gap-3">
          <input
            type="text"
            value={deleteConfirm}
            onChange={(e) => setDeleteConfirm(e.target.value)}
            className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
            placeholder='Type "DELETE"'
          />
          <Button
            variant="danger"
            disabled={deleteConfirm !== "DELETE" || deleting}
            onClick={handleDelete}
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
        </div>
        <p className="mt-2 text-xs text-gray-400">A confirmation email will be sent to you.</p>
      </div>
    </div>
  );
}
