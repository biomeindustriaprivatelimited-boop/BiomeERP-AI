/**
 * Runs once when the server process starts.
 *
 * Starts the automatic backup timer (daily / weekly / monthly, set in
 * Settings → Backup). Only on the Node runtime — the Edge middleware has
 * no file system — and only on the machine that actually runs the server,
 * which is the one holding the data. Client PCs run no server at all.
 *
 * The `if` form (not an early return) matters: NEXT_RUNTIME is replaced at
 * build time, so the Edge bundle drops the import entirely.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackupScheduler } = await import("./lib/backupEngine");
    startBackupScheduler();
  }
}
