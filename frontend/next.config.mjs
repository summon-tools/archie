import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["better-sqlite3", "fluent-ffmpeg", "node-edge-tts", "ws", "node-pty"],
  env: {
    APP_VERSION: pkg.version,
  },
};

export default nextConfig;
