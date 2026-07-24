import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const devOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1", ...devOrigins],
  async headers() {
    return securityHeaders;
  },
};

export default nextConfig;
