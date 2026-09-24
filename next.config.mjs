/** @type {import('next').NextConfig} */

// Baseline browser hardening (mirrors the Brain): no framing, no MIME sniffing,
// tight referrers, HTTPS pinned. The microphone stays allowed for voice notes.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // The chat's save action (saveConversationTurn) sends the whole thread; the
    // 1 MB default silently stopped long chats persisting. Stays under the
    // hosting platform's ~4.5 MB request-body limit.
    serverActions: { bodySizeLimit: "4mb" },
  },
  async headers() {
    return [
      { source: "/(.*)", headers: SECURITY_HEADERS },
      // The service worker must never be cached by the browser or a CDN, or an
      // old worker keeps serving after a deploy; it may control the whole origin.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
    ];
  },
};

export default nextConfig;
