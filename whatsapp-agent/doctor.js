#!/usr/bin/env node
/**
 * Biome WhatsApp Agent — doctor
 * -------------------------------------------------------------------
 * Run `npm run whatsapp:doctor` when the app says the agent isn't
 * running. It checks each thing that can go wrong, in the order they'd
 * bite, and prints the one that's actually broken.
 *
 * Written because "Agent not running" is a symptom, not a diagnosis, and
 * chasing it blind wastes far more time than this takes.
 */

const fs = require("fs");
const net = require("net");
const os = require("os");
const path = require("path");

const GREEN = "\x1b[32m", RED = "\x1b[31m", YELLOW = "\x1b[33m", DIM = "\x1b[2m", RESET = "\x1b[0m";
const ok = (m, d) => console.log(`${GREEN}  OK${RESET}   ${m}${d ? `\n       ${DIM}${d}${RESET}` : ""}`);
const bad = (m, fix) => console.log(`${RED}  FAIL${RESET} ${m}${fix ? `\n       ${YELLOW}→ ${fix}${RESET}` : ""}`);
const warn = (m, d) => console.log(`${YELLOW}  WARN${RESET} ${m}${d ? `\n       ${DIM}${d}${RESET}` : ""}`);

let failures = 0;
const fail = (...a) => { failures++; bad(...a); };

console.log("\n  Biome WhatsApp Agent — diagnostic\n  " + "-".repeat(44) + "\n");

// ---- 1. Node version ----
const major = Number(process.versions.node.split(".")[0]);
if (major >= 20) ok(`Node ${process.versions.node}`);
else fail(`Node ${process.versions.node} is too old`, "WhatsApp needs Node 20 or newer. Install it from nodejs.org, then run npm install again.");

// ---- 2. Packages ----
const NEEDED = ["@whiskeysockets/baileys", "pino", "qrcode"];
const missing = [];
for (const pkg of NEEDED) {
  try {
    require.resolve(pkg);
  } catch {
    missing.push(pkg);
  }
}
if (missing.length) {
  fail(`Missing packages: ${missing.join(", ")}`, "Run `npm install` in the project folder. This is the most common cause by far.");
} else {
  ok("All required packages are installed");
}

// Optional but needed for offline reading.
try {
  require.resolve("tesseract.js");
  ok("Offline OCR (tesseract.js) available");
} catch {
  warn("tesseract.js not installed — documents can't be read offline", "Run `npm install`.");
}

// ---- 3. Storage folder ----
function dataRoot() {
  const env = (process.env.BIOME_DATA_ROOT || "").trim();
  if (env) return path.resolve(env);
  try {
    const marker = path.join(os.homedir(), ".biome-data-root");
    if (fs.existsSync(marker)) {
      const chosen = fs.readFileSync(marker, "utf8").trim();
      if (chosen) return path.resolve(chosen);
    }
  } catch {}
  return path.join(os.homedir(), "Documents", "Biome Platform");
}

const root = dataRoot();
try {
  fs.mkdirSync(path.join(root, "runtime"), { recursive: true });
  const probe = path.join(root, "runtime", `.doctor-${process.pid}`);
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  ok("Storage folder is writable", root);
} catch (err) {
  fail(`Storage folder isn't writable: ${err.message}`, `Check that ${root} exists and you have permission, or change it in Settings.`);
}

// ---- 4. A previous crash note ----
const noteFile = path.join(root, "runtime", "whatsapp-agent-error.json");
if (fs.existsSync(noteFile)) {
  try {
    const note = JSON.parse(fs.readFileSync(noteFile, "utf8"));
    warn(`The agent last failed with: ${note.reason}`, note.message);
  } catch {
    warn("There's an unreadable crash note in the runtime folder");
  }
}

// ---- 5. Is one already running? ----
const handshakeFile = path.join(root, "runtime", "whatsapp-agent.json");
if (fs.existsSync(handshakeFile)) {
  try {
    const hs = JSON.parse(fs.readFileSync(handshakeFile, "utf8"));
    let alive = false;
    try {
      process.kill(hs.pid, 0); // signal 0 just tests existence
      alive = true;
    } catch {}
    if (alive) ok(`An agent is already running on port ${hs.port} (pid ${hs.pid})`);
    else warn(`Stale handshake from a dead agent (pid ${hs.pid})`, "Harmless — the next start overwrites it.");
  } catch {
    warn("The handshake file is unreadable");
  }
}

// ---- 6. Ports ----
function portFree(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(port, "127.0.0.1");
  });
}

(async () => {
  const base = Number(process.env.BIOME_WA_AGENT_PORT || 4174);
  const free = [];
  for (let p = base; p < base + 6; p++) if (await portFree(p)) free.push(p);
  if (free.length) ok(`Free ports available (first: ${free[0]})`);
  else fail(`Ports ${base}–${base + 5} are all in use`, "Close any other copy of Biome, then try again.");

  // ---- 7. Can Baileys actually load? ----
  if (!missing.length) {
    try {
      const baileys = require("@whiskeysockets/baileys");
      const makeWASocket = baileys.default || baileys.makeWASocket;
      if (typeof makeWASocket === "function") ok("WhatsApp library loads correctly");
      else fail("The WhatsApp library loaded but looks wrong", "Try `npm install @whiskeysockets/baileys@latest`.");
    } catch (err) {
      fail(`The WhatsApp library won't load: ${err.message}`, "Delete node_modules and run `npm install` again.");
    }
  }

  // ---- Verdict ----
  console.log("\n  " + "-".repeat(44));
  if (failures === 0) {
    console.log(`${GREEN}  Everything checks out.${RESET}`);
    console.log(`  Start the app with ${DIM}npm run dev${RESET}, then open WhatsApp Documents and click Link WhatsApp.\n`);
  } else {
    console.log(`${RED}  ${failures} problem(s) found — fix the FAIL lines above.${RESET}\n`);
    process.exitCode = 1;
  }
})();
