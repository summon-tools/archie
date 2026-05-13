import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "fluent-ffmpeg", "node-edge-tts", "ws", "node-pty"],
  experimental: {
    proxyClientMaxBodySize: "25mb",
  },
  env: {
    APP_VERSION: pkg.version,
  },
};

export default nextConfig;
