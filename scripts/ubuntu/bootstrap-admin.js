#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PROJECT_DIR = process.env.PROJECT_DIR || path.resolve(__dirname, "../..");
const FRONTEND_DIR = path.join(PROJECT_DIR, "frontend");
const Database = require(path.join(FRONTEND_DIR, "node_modules", "better-sqlite3"));
const bcrypt = require(path.join(FRONTEND_DIR, "node_modules", "bcryptjs"));

const AUTOMATION_USERNAME = "__archie_automation__";
const AVATAR_COLORS = [
  "#E53E3E", "#DD6B20", "#D69E2E", "#38A169", "#319795",
  "#3182CE", "#5A67D8", "#805AD5", "#D53F8C", "#B83280",
];

function resolveHome(input) {
  if (!input) return input;
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function getDbPath() {
  const configured = process.env.DATABASE_PATH;
  if (configured) return configured;
  return path.join(PROJECT_DIR, "data", "dashboard.db");
}

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'member',
      email TEXT DEFAULT NULL,
      color TEXT DEFAULT NULL,
      deleted_at TEXT DEFAULT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);

    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
}

function humanUserCount(db) {
  return (
    db.prepare("SELECT COUNT(*) as cnt FROM users WHERE username != ?").get(AUTOMATION_USERNAME)
  ).cnt;
}

function randomAvatarColor() {
  return AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)];
}

function runCmd(args) {
  execFileSync(args[0], args.slice(1), {
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf-8",
  });
}

function setGitConfig(name, email) {
  if (name) runCmd(["git", "config", "--global", "user.name", name]);
  if (email) runCmd(["git", "config", "--global", "user.email", email]);
}

function ensureSshKey() {
  const sshDir = path.join(os.homedir(), ".ssh");
  const keyPath = path.join(sshDir, "id_ed25519");
  const pubPath = `${keyPath}.pub`;

  fs.mkdirSync(sshDir, { recursive: true, mode: 0o700 });

  if (!fs.existsSync(keyPath)) {
    runCmd([
      "ssh-keygen", "-t", "ed25519",
      "-C", "archie@dashboard-server",
      "-f", keyPath,
      "-N", "",
    ]);
  }

  try {
    const knownHosts = path.join(sshDir, "known_hosts");
    const scan = execFileSync("ssh-keyscan", ["github.com"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf-8",
    });
    if (scan.trim()) {
      const existing = fs.existsSync(knownHosts)
        ? fs.readFileSync(knownHosts, "utf-8")
        : "";
      if (!existing.includes("github.com")) {
        fs.appendFileSync(knownHosts, scan);
      }
    }
  } catch {
    // best effort
  }

  return fs.existsSync(pubPath) ? fs.readFileSync(pubPath, "utf-8").trim() : "";
}

function createAdmin(db) {
  const name = (process.env.ADMIN_NAME || "").trim();
  const email = (process.env.ADMIN_EMAIL || "").trim();
  const password = process.env.ADMIN_PASSWORD || "";
  const projectsDir = resolveHome(process.env.PROJECTS_DIR || path.join(os.homedir(), "Projects"));
  const gitName = (process.env.GIT_NAME || name).trim();
  const gitEmail = (process.env.GIT_EMAIL || email).trim();
  const generateSshKey = (process.env.GENERATE_SSH_KEY || "false") === "true";

  if (!name) throw new Error("ADMIN_NAME is required");
  if (!email) throw new Error("ADMIN_EMAIL is required");
  if (password.length < 6) throw new Error("ADMIN_PASSWORD must be at least 6 characters");
  if (!projectsDir || !path.isAbsolute(projectsDir)) throw new Error("PROJECTS_DIR must be an absolute path");

  fs.mkdirSync(projectsDir, { recursive: true });

  const passwordHash = bcrypt.hashSync(password, 10);
  const color = randomAvatarColor();

  const tx = db.transaction(() => {
    db.prepare(
      "INSERT INTO users (username, name, email, password_hash, role, color) VALUES (?, ?, ?, ?, 'admin', ?)"
    ).run(name, name, email, passwordHash, color);

    db.prepare(
      "INSERT OR REPLACE INTO system_settings (key, value_json) VALUES (?, ?)"
    ).run("projects_dir", JSON.stringify(projectsDir));
  });

  tx();

  setGitConfig(gitName, gitEmail);

  if (generateSshKey) {
    ensureSshKey();
  }
}

function main() {
  const command = process.argv[2];
  if (!command || (command !== "status" && command !== "create")) {
    console.error("Usage: bootstrap-admin.js <status|create>");
    process.exit(1);
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  ensureSchema(db);

  const count = humanUserCount(db);
  if (command === "status") {
    process.stdout.write(count === 0 ? "needs_setup\n" : "ready\n");
    return;
  }

  if (count > 0) {
    process.stdout.write("already_initialized\n");
    return;
  }

  createAdmin(db);
  process.stdout.write("created\n");
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
