"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/providers/auth-provider";
import { getAllUsers, updateUserPrivilege, deleteUser } from "@/lib/api/user";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import type { User } from "@/types/user";

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const { toast } = useToast();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggleTarget, setToggleTarget] = useState<User | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const fetchUsers = async () => {
    try {
      const res = await getAllUsers();
      setUsers(res.data);
    } catch {
      toast("Failed to load users", "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleToggle = async () => {
    if (!toggleTarget) return;
    setToggling(true);
    try {
      const newRole = toggleTarget.role === "admin" ? "user" : "admin";
      await updateUserPrivilege(toggleTarget.id, newRole);
      setUsers((prev) =>
        prev.map((u) => (u.id === toggleTarget.id ? { ...u, role: newRole } : u)),
      );
      toast(`Updated ${toggleTarget.username} to ${newRole}`, "success");
      setToggleTarget(null);
    } catch {
      toast("Failed to update role", "error");
    } finally {
      setToggling(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteUser(deleteTarget.id);
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      toast(`Deleted user ${deleteTarget.username}`, "success");
      setDeleteTarget(null);
    } catch (err) {
      if (err instanceof Error) {
        toast(err.message || "Failed to delete user", "error");
      } else {
        toast("Failed to delete user", "error");
      }
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><div className="h-8 w-8 animate-spin rounded-full border-4 border-gray-200 border-t-[#5568EE]" /></div>;
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">User Management</h1>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-4 py-3 text-left font-medium text-gray-600">Username</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Role</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium">{u.username}</td>
                <td className="px-4 py-3 text-gray-600">{u.email}</td>
                <td className="px-4 py-3">
                  <span className={u.role === "admin" ? "text-[#5568EE] font-medium" : "text-gray-600"}>
                    {u.role === "admin" ? "Admin" : "User"}
                  </span>
                </td>
                <td className="px-4 py-3 flex gap-4">
                  {u.id === currentUser?.id ? (
                    <span className="text-xs text-gray-400">Current user</span>
                  ) : (
                    <>
                      <button
                        onClick={() => setToggleTarget(u)}
                        className="text-sm text-[#5568EE] hover:underline cursor-pointer"
                      >
                        [Toggle Role]
                      </button>
                      <button
                        onClick={() => setDeleteTarget(u)}
                        className="text-sm text-red-600 hover:underline cursor-pointer"
                      >
                        [Delete]
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={!!toggleTarget} onClose={() => setToggleTarget(null)}>
        <div className="text-center space-y-4">
          <h2 className="text-lg font-semibold">Confirm Role Change</h2>
          <p className="text-gray-600">
            {toggleTarget?.role === "admin" ? "Demote" : "Promote"} &quot;{toggleTarget?.username}&quot; to{" "}
            {toggleTarget?.role === "admin" ? "User" : "Admin"}?
          </p>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={() => setToggleTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleToggle} disabled={toggling}>
              {toggling ? "Updating..." : "Confirm"}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <div className="text-center space-y-4">
        <h2 className="text-lg font-semibold text-red-600">Confirm User Deletion</h2>
          <p className="text-gray-600">
            Are you sure you want to permanently delete user &quot;{deleteTarget?.username}&quot;?
          </p>
          <p className="text-sm text-gray-500">This action cannot be undone.</p>
          <div className="flex justify-center gap-3 pt-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button onClick={handleDelete} disabled={deleting} className="bg-red-600 hover:bg-red-700">
              {deleting ? "Deleting..." : "Delete User"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
