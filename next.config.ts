import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: ['192.168.10.165', '192.168.10.134', '192.168.10.100'],
};

export default nextConfig;
