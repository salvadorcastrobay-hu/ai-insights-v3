import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    // Runtime memory: Next.js por default precarga TODOS los módulos de
    // TODAS las pages al arrancar el server. En un dashboard con 10+ pages
    // eso suma 100-200MB de baseline antes de servir ni un request.
    // Disabling = primer hit a una page nueva sube ~50-150ms (después
    // queda cacheada en RAM), pero el baseline memory baja significativamente.
    // Vale para Vercel Hobby (1024MB cap).
    // https://nextjs.org/docs/app/guides/memory-usage#preloading-entries
    preloadEntriesOnStart: false,

    // Build-time: reduce peak memory durante el build de Vercel. Low-risk
    // según docs oficiales. No afecta runtime.
    webpackMemoryOptimizations: true,
  },
};

export default nextConfig;
