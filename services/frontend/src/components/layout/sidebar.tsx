"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/providers/auth-provider";
import { cn } from "@/lib/utils";
import { LayoutDashboard, User, Settings, LogOut, Shield, BookOpen, History } from "lucide-react";

const navItems = [
  { label: "Dashboard", href: "/match", icon: LayoutDashboard },
  { label: "History", href: "/history", icon: History },
  { label: "Profile", href: "/profile", icon: User },
  { label: "Settings", href: "/settings", icon: Settings },
];

const adminItems = [
  { label: "User Mgmt", href: "/admin/users", icon: Shield },
  { label: "Questions", href: "/admin/questions", icon: BookOpen },
];

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuth();

  const handleLogout = () => {
    logout();
    router.push("/login");
  };

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-gray-200 bg-white">
      <div className="flex h-14 items-center border-b border-gray-200 px-4">
        <span className="text-lg font-bold">PeerPrep</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-blue-50 text-[#5568EE]"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              )}
            >
              <Icon size={18} />
              {item.label}
            </Link>
          );
        })}

        {user?.role === "admin" && (
          <>
            <div className="my-3 border-t border-gray-200" />
            <p className="px-3 text-xs font-semibold uppercase text-gray-400">Admin</p>
            {adminItems.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    pathname === item.href
                      ? "bg-blue-50 text-[#5568EE]"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
                  )}
                >
                  <Icon size={18} />
                  {item.label}
                </Link>
              );
            })}
          </>
        )}
      </nav>
      <div className="border-t border-gray-200 p-3">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900 cursor-pointer"
        >
          <LogOut size={18} />
          Logout
        </button>
      </div>
    </aside>
  );
}
