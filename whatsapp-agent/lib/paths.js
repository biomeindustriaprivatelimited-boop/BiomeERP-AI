/**
 * Biome Platform — WhatsApp Agent / paths
 * -------------------------------------------------------------------
 * Single source of truth for WHERE everything lives on disk.
 *
 * The Next.js app (lib/dataRoot.ts) resolves the SAME folders using the
 * same rules, so both processes always agree. If you change anything
 * here, change it there too.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

/**
 * Root folder for everything this platform stores on disk.
 *   - override with the BIOME_DATA_ROOT environment variable
 *   - otherwise:  <home>/Documents/Biome Platform
 * On Windows that resolves to  C:\Users\<you>\Documents\Biome Platform
 */
function dataRoot() {
  const override = (process.env.BIOME_DATA_ROOT || "").trim();
  if (override) return path.resolve(override);
  // A folder chosen in Settings, shared with the Next process through a
  // marker file since the two can't see each other's memory.
  try {
    const marker = path.join(os.homedir(), ".biome-data-root");
    if (fs.existsSync(marker)) {
      const chosen = fs.readFileSync(marker, "utf8").trim();
      if (chosen) return path.resolve(chosen);
    }
  } catch {
    // Fall through to the default rather than refusing to start.
  }
  return path.join(os.homedir(), "Documents", "Biome Platform");
}

const PATHS = {
  get root() {
    return dataRoot();
  },
  /** Baileys multi-file auth state. SENSITIVE — this is the WhatsApp
   *  login itself. Anyone with these files can read the linked account. */
  get waAuth() {
    return path.join(dataRoot(), "whatsapp", "auth");
  },
  /** Where downloaded + filed documents end up. */
  get inbox() {
    return path.join(dataRoot(), "whatsapp", "inbox");
  },
  /** Append-only ledger of every received document. */
  get dbDir() {
    return path.join(dataRoot(), "whatsapp", "db");
  },
  get documentsLog() {
    return path.join(dataRoot(), "whatsapp", "db", "documents.jsonl");
  },
  /** Vendor master + client master. Written by the Next app, read here. */
  get configDir() {
    return path.join(dataRoot(), "config");
  },
  get vendorsFile() {
    return path.join(dataRoot(), "config", "vendors.json");
  },
  get clientsFile() {
    return path.join(dataRoot(), "config", "clients.json");
  },
  get settingsFile() {
    return path.join(dataRoot(), "config", "whatsapp-settings.json");
  },
  /** Vendor KYC document storage: kyc/<VENDORCODE>/<file> */
  get kycDir() {
    return path.join(dataRoot(), "kyc");
  },
  /** Handshake file: the Next app reads this to learn the agent's
   *  port + one-time token so it can talk to it. */
  get runtimeFile() {
    return path.join(dataRoot(), "runtime", "whatsapp-agent.json");
  },
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create every folder the agent needs, once, at startup. */
function ensureAllDirs() {
  [
    PATHS.root,
    PATHS.waAuth,
    PATHS.inbox,
    PATHS.dbDir,
    PATHS.configDir,
    PATHS.kycDir,
    path.dirname(PATHS.runtimeFile),
  ].forEach(ensureDir);
}

module.exports = { PATHS, dataRoot, ensureDir, ensureAllDirs };
