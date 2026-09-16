import type { Config } from "@react-router/dev/config";

export default {
  // Config options...
  // Server-side render by default, to enable SPA mode set this to `false`
  ssr: true,
  // Allow form submissions from local dev origins (React Router 7.12+ CSRF protection)
  // Use host format (host:port), not full URLs
  allowedActionOrigins: ["localhost:4000", "127.0.0.1:4000", "localhost:3000", "127.0.0.1:3000"],
} satisfies Config;
