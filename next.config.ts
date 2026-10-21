import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite ships WebAssembly and data files that must be loaded from node_modules at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  poweredByHeader: false,
  // The floating dev badge sits on the phone tab bar; hide it so previews show the real chrome.
  devIndicators: false,
  // A lockfile exists higher up in the user's home folder; pin the workspace root to this app.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
