import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/users/:path*", destination: `${process.env.NEXT_PUBLIC_USER_SERVICE_URL || "http://localhost:3001"}/users/:path*` },
      { source: "/api/auth/:path*", destination: `${process.env.NEXT_PUBLIC_USER_SERVICE_URL || "http://localhost:3001"}/auth/:path*` },
      // Question service routes - most specific first
      { source: "/api/topics", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/topics` },
      { source: "/api/questions/stats", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/questions/stats` },
      { source: "/api/questions/fetch", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/fetch` },
      { source: "/api/questions/delete", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/delete` },
      { source: "/api/questions/create", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/create` },
      { source: "/api/questions/update/:id", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/update/:id` },
      { source: "/api/questions/:id", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/questions/:id` },
      { source: "/api/questions", destination: `${process.env.NEXT_PUBLIC_QUESTION_SERVICE_URL || "http://localhost:8000"}/questions` },
      // AI service
      { source: "/api/ai/:path*", destination: `${process.env.NEXT_PUBLIC_AI_SERVICE_URL || "http://localhost:5050"}/api/ai/:path*` },
    ];
  },
};

export default nextConfig;
