#!/usr/bin/env node
/**
 * Biome Platform — account doctor
 * -------------------------------------------------------------------
 * Standalone on purpose: plain Node, no imports from the app, no npm
 * packages. When sign-in fails the app itself is the thing under
 * suspicion, so a tool that needs the app to work would be useless.
 *
 *   node tools/biome-admin.js              -> report only, changes nothing
 *   node tools/biome-admin.js --reset      -> reset admin to biome-admin
 *   node tools/biome-admin.js --reset=mypassword123
 *   node tools/biome-admin.js --developer  -> create/reset the developer account
 *   node tools/biome-admin.js --developer=mypassword123
 *
 * The developer account can ONLY be made here, from the machine that holds
 * the data folder. There is no screen for it, and no admin can create one:
 * an admin who could would simply grant themselves back everything the
 * developer role exists to hold.
 *
 * It resolves the data folder exactly the way lib/dataRoot.ts does. If
 * those two ever disagree, this report is how you find out.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

function dataRoot() {
  const override = (process.env.BIOME_DATA_ROOT || "").trim();
  if (override) return { root: path.resolve(override), from: "BIOME_DATA_ROOT env variable" };
  try {
    const marker = path.join(os.homedir(), ".biome-data-root");
    if (fs.existsSync(marker)) {
      const chosen = fs.readFileSync(marker, "utf8").trim();
      if (chosen) return { root: path.resolve(chosen), from: `marker file ${marker}` };
    }
  } catch (err) {
    console.log(`  ! Couldn't read the marker file: ${err.message}`);
  }
  return { root: path.join(os.homedir(), "Documents", "Biome Platform"), from: "default location" };
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function line() {
  console.log("-".repeat(64));
}

const resolved = dataRoot();
const configDir = path.join(resolved.root, "config");
const usersFile = path.join(configDir, "users.json");

console.log("");
line();
console.log("  BIOME ACCOUNT DOCTOR");
line();
console.log(`  Data folder : ${resolved.root}`);
console.log(`  Decided by  : ${resolved.from}`);
console.log(`  Users file  : ${usersFile}`);
console.log("");

// --- Can we even get to the folder? ---
const rootExists = fs.existsSync(resolved.root);
console.log(`  Data folder exists : ${rootExists ? "yes" : "NO"}`);

let writable = false;
try {
  fs.mkdirSync(configDir, { recursive: true });
  const probe = path.join(configDir, ".write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
  writable = true;
} catch (err) {
  console.log(`  Folder writable    : NO  -> ${err.message}`);
}
if (writable) console.log("  Folder writable    : yes");

// --- What is in the users file? ---
let users = [];
let fileState = "missing";
if (fs.existsSync(usersFile)) {
  try {
    const parsed = JSON.parse(fs.readFileSync(usersFile, "utf8"));
    users = Array.isArray(parsed.users) ? parsed.users : [];
    fileState = users.length > 0 ? "readable" : "readable but empty";
  } catch (err) {
    // This is the failure that looks like a wrong password: the app's
    // readJson() swallows a parse error and hands back an empty list, so
    // every username comes back "not found".
    fileState = `CORRUPT — ${err.message}`;
  }
}
console.log(`  Users file         : ${fileState}`);
console.log("");

if (users.length > 0) {
  console.log("  Accounts found:");
  for (const u of users) {
    const flags = [];
    if (!u.active) flags.push("DISABLED");
    if (u.mustChangePassword) flags.push("password not set yet");
    if (!u.salt || !u.hash) flags.push("NO PASSWORD STORED");
    console.log(
      `    - ${String(u.username).padEnd(16)} ${String(u.role || "?").padEnd(15)}` +
        `${u.plants && u.plants.length ? u.plants.join(",") : "-"}` +
        `${flags.length ? "   [" + flags.join(", ") + "]" : ""}`
    );
  }
} else {
  console.log("  Accounts found: none");
  console.log("  (The app creates 'admin' by itself the first time someone");
  console.log("   tries to sign in, so 'none' here means that never happened.)");
}
console.log("");

// --- Reset, if asked ---
const devArg = process.argv.find((a) => a.startsWith("--developer"));
const resetArg = process.argv.find((a) => a.startsWith("--reset")) || devArg;
const makingDeveloper = Boolean(devArg);
if (!resetArg) {
  line();
  console.log("  Nothing was changed.");
  console.log("  To fix the admin account, run:");
  console.log("      node tools/biome-admin.js --reset");
  line();
  console.log("");
  process.exit(0);
}

if (!writable) {
  console.log("  Can't reset: the data folder is not writable (see above).");
  process.exit(1);
}

const password = resetArg.includes("=") ? resetArg.split("=").slice(1).join("=") : "biome-admin";
if (password.length < 8) {
  console.log(`  That password is too short (${password.length} characters, need 8).`);
  process.exit(1);
}

const salt = crypto.randomBytes(16).toString("hex");
const hash = hashPassword(password, salt);
const now = new Date().toISOString();

// Back the old file up before touching it — if there were real accounts
// in there, losing them would be far worse than a failed sign-in.
if (fs.existsSync(usersFile)) {
  const backup = `${usersFile}.backup-${Date.now()}`;
  fs.copyFileSync(usersFile, backup);
  console.log(`  Old file backed up to:\n    ${backup}`);
}

const accountName = makingDeveloper ? "developer" : "admin";
const accountRole = makingDeveloper ? "developer" : "admin";
const accountLabel = makingDeveloper ? "Developer" : "Administrator";

const existing = users.find((u) => String(u.username).toLowerCase() === accountName);
let nextUsers;
if (existing) {
  nextUsers = users.map((u) =>
    String(u.username).toLowerCase() === accountName
      ? { ...u, salt, hash, role: accountRole, active: true, mustChangePassword: true, updatedAt: now }
      : u
  );
  console.log(`  Existing '${accountName}' account: password reset, re-enabled.`);
} else {
  nextUsers = [
    ...users,
    {
      id: crypto.randomUUID(),
      username: accountName,
      name: accountLabel,
      role: accountRole,
      plants: [],
      active: true,
      mustChangePassword: true,
      salt,
      hash,
      createdAt: now,
      updatedAt: now,
    },
  ];
  console.log(`  No '${accountName}' account existed. Created one.`);
}

const tmp = `${usersFile}.tmp`;
fs.writeFileSync(tmp, JSON.stringify({ users: nextUsers, updatedAt: now }, null, 2), "utf8");
fs.renameSync(tmp, usersFile);

// Read it back. Writing without checking is how a silent failure hides.
const check = JSON.parse(fs.readFileSync(usersFile, "utf8"));
const saved = check.users.find((u) => u.username === "admin");
const verified = saved && hashPassword(password, saved.salt) === saved.hash;

console.log("");
line();
if (verified) {
  console.log("  DONE — sign in with:");
  console.log(`      Username : admin`);
  console.log(`      Password : ${password}`);
  console.log("");
  console.log("  The app will ask you to choose a new password straight away.");
} else {
  console.log("  The file was written but did not verify. Send this output over.");
}
line();
console.log("");
