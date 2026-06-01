import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { allowedOrigins: ["*"] },
  },

  // ── Images ─────────────────────────────────────────────────────────────
  // Allow Next.js <Image> to load from any HTTPS source (Vercel, CDN, etc.)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },

  // ── Security & CORS headers ─────────────────────────────────────────────
  // API routes accept POST from the ESP32 (x-api-key) or authenticated
  // browser sessions (NextAuth cookie). Public GET of the SSE stream is
  // allowed for any authenticated session.
  async headers() {
    return [
      {
        // Apply to all API routes
        source: "/api/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options",        value: "DENY" },
          { key: "Referrer-Policy",        value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
