import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone para que la imagen de Docker sea chica, igual que insights-web.
  output: "standalone",
};

export default nextConfig;
