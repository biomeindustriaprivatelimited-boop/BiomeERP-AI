import os from "os";
import fs from "fs";
import { NextRequest, NextResponse } from "next/server";
import { getSession, findById, requirePermission, loadUsers, saveUsers, signedOutResponse, readSessionToken, sessionAccountDisabled } from "@/lib/authServer";
import { disabledResponseFor } from "@/lib/mpin";
import { paths } from "@/lib/dataRoot";
import { loadBackups } from "@/lib/backup";
import { loadState as loadBackupState } from "@/lib/backupEngine";
import { DEVICE_COOKIE, heartbeat, loadDevices, command, forget } from "@/lib/devices";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE } from "@/lib/authToken";

/**
 * POST {action:"heartbeat"} — any signed-in screen, once a minute.
 * GET                         — developer: server identity + every device.
 * POST {action: block|unblock|signOut|reload|message|rename|forget|signOutUser}
 *                             — developer controls.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return (fwd.split(",")[0] || req.headers.get("x-real-ip") || (req as any).ip || "").trim() || "this PC";
}

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth.response;
  const port = Number(process.env.PORT || 4173);
  const lan: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) if (n.family === "IPv4" && !n.internal && !n.address.startsWith("169.254.")) lan.push(n.address);
  }
  let disk: { freeGB: number; totalGB: number } | null = null;
  try {
    const st: any = (fs as any).statfsSync ? (fs as any).statfsSync(paths.root) : null;
    if (st) disk = { freeGB: Math.round((st.bavail * st.bsize) / 1e8) / 10, totalGB: Math.round((st.blocks * st.bsize) / 1e8) / 10 };
  } catch { /* not supported */ }
  const now = Date.now();
  const devices = loadDevices().map((d) => ({ ...d, online: now - new Date(d.lastSeen).getTime() < 3 * 60_000 }));
  const backups = loadBackups().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return NextResponse.json({
    server: {
      hostname: os.hostname(), platform: `${os.type()} ${os.release()}`, lan, port,
      urls: lan.map((a) => `http://${a}:${port}`),
      dataRoot: paths.root, version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
      uptimeHours: Math.round(process.uptime() / 360) / 10, memoryMB: Math.round(process.memoryUsage().rss / 1e6),
      cpus: os.cpus().length, disk,
      lastBackup: backups[0] ? { file: backups[0].file, at: backups[0].createdAt } : null,
      backupHistory: loadBackupState().history.slice(0, 3),
    },
    devices,
    online: devices.filter((d) => d.online).length,
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));

  if (body?.action === "heartbeat") {
    const session = await getSession(req);
    if (!session) {
      const raw = await readSessionToken(req);
      if (raw && sessionAccountDisabled(raw)) return disabledResponseFor(req, raw.uid);
      // A session that has ENDED (the developer's fresh-start reset) — tell
      // the device to go back to the sign-in page.
      if (req.cookies.get(SESSION_COOKIE)?.value || req.headers.get("authorization")) {
        return NextResponse.json({ signOut: true, reason: "Your session has ended. Please sign in again." });
      }
      return signedOutResponse(req);
    }
    const user = findById(session.uid);
    const id = String(body.deviceId || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
    if (!user || user.deleted || !user.active) return NextResponse.json({ signOut: true });
    if (!id) return NextResponse.json({ ok: false });
    const d = heartbeat({
      id, userId: user.id, userName: user.name, role: user.role, ip: clientIp(req),
      userAgent: req.headers.get("user-agent") || "", version: String(body.version || ""),
      shellVersion: String(body.shellVersion || ""), shell: String(body.shell || ""), page: String(body.page || ""),
    });
    const res = NextResponse.json({
      blocked: d.blocked, blockedReason: d.blockedReason,
      signOut: Boolean(d.pending.signOut), reload: Boolean(d.pending.reload), message: d.pending.message || null,
      serverVersion: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
    });
    // The cookie lets the server refuse a blocked device on every request.
    res.cookies.set(DEVICE_COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    if (d.pending.signOut || d.pending.reload || d.pending.message) command(id, { pending: { signOut: false, reload: false, message: "" } });
    return res;
  }

  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth.response;
  const me = findById(auth.session.uid)!;
  const id = String(body.deviceId || "");
  const act = String(body.action || "");
  let done: any = null;
  if (act === "block") done = command(id, { blocked: true, blockedReason: String(body.reason || "Blocked by the administrator.").slice(0, 200), pending: { signOut: true } });
  else if (act === "unblock") done = command(id, { blocked: false, blockedReason: "" });
  else if (act === "signOut") done = command(id, { pending: { signOut: true } });
  else if (act === "reload") done = command(id, { pending: { reload: true } });
  else if (act === "message") done = command(id, { pending: { message: String(body.message || "").slice(0, 500) } });
  else if (act === "rename") done = command(id, { name: String(body.name || "").slice(0, 60) });
  else if (act === "forget") { forget(id); done = true; }
  else if (act === "reloadAll") { for (const d of loadDevices()) command(d.id, { pending: { reload: true } }); done = true; }
  else if (act === "messageAll") { for (const d of loadDevices()) command(d.id, { pending: { message: String(body.message || "").slice(0, 500) } }); done = true; }
  else if (act === "signOutUser") {
    // Every session of that person, on every device: bump their access version.
    const users = loadUsers();
    const u = users.find((x) => x.id === body.userId);
    if (!u) return NextResponse.json({ error: "User not found." }, { status: 404 });
    saveUsers(users.map((x) => (x.id === u.id ? { ...x, accessVersion: (x.accessVersion || 0) + 1 } : x)));
    done = true;
  } else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!done) return NextResponse.json({ error: "Device not found." }, { status: 404 });
  recordAudit({ action: `DEVICE_${act.toUpperCase()}`, userId: me.id, userName: me.name, role: me.role, targetType: "device", targetId: id || String(body.userId || "all"), targetLabel: id || "all devices" });
  return NextResponse.json({ ok: true });
}
