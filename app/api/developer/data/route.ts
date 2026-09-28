import fs from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { paths, readJson, writeJsonAtomic } from "@/lib/dataRoot";
import { recordAudit } from "@/lib/audit";
import {
  WIPE_SCOPES, WIPE_WAIT_MS, previewWipe, issueWipeToken, checkWipeToken, consumeWipeToken, performWipe,
} from "@/lib/dataWipe";
import { runBackup } from "@/lib/backupEngine";
import { loadPartners, savePartners, partnersDir } from "@/lib/partners";
import { syncMasterFromRegistration } from "@/lib/vendorSync";
import { loadTrips, saveTrips } from "@/lib/coordination";
import { loadPoFile, savePoFile } from "@/lib/po";

/**
 * Developer → Data. Test-data wipe and single-record deletes.
 * `developer` permission only (the middleware 404s everyone else).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth.response;
  const clients = readJson<{ clients: any[] }>(paths.clientsFile, { clients: [] }).clients || [];
  return NextResponse.json({
    scopes: WIPE_SCOPES.map(({ id, label, help }) => ({ id, label, help, ...previewWipe([id]) })),
    waitSeconds: WIPE_WAIT_MS / 1000,
    records: {
      partner: loadPartners().map((p) => ({ id: p.id, label: `${p.name}${p.code ? ` (${p.code})` : ""}`, sub: `${p.kind} · ${p.category === "trading" ? "trading" : "manufacturing"} · ${p.status}${p.lockState === "submitted" ? " · frozen" : ""}` })),
      client: clients.map((c: any) => ({ id: c.name, label: c.name, sub: c.shortName || "" })),
      trip: loadTrips().map((t) => ({ id: t.id, label: `#${t.serial} ${t.business} · ${t.vehicleNumber || "no vehicle"} → ${t.client || "?"}`, sub: `${t.ourDocNo || "no doc"} · ${t.vehicleEntryDate || ""}` })),
      po: loadPoFile().pos.map((p) => ({ id: p.id, label: `${p.poNumber} · ${p.partyName}`, sub: `${p.type} PO` })),
    },
  });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "developer");
  if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!;
  const body = await req.json().catch(() => ({}));
  const scopes: string[] = Array.isArray(body?.scopes) ? body.scopes.filter((s: string) => WIPE_SCOPES.some((w) => w.id === s)) : [];

  if (body?.action === "preview") {
    if (!scopes.length) return NextResponse.json({ error: "Choose what to delete." }, { status: 400 });
    return NextResponse.json({ ...previewWipe(scopes), token: issueWipeToken(user.id, scopes), waitSeconds: WIPE_WAIT_MS / 1000 });
  }

  if (body?.action === "wipe") {
    const problem = checkWipeToken(String(body.token || ""), user.id, scopes);
    if (problem) return NextResponse.json({ error: problem }, { status: 409 });
    if (body.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
    let backup: string | null = null;
    if (body.skipBackup !== true) {
      try {
        const r = await runBackup({ kind: "manual", by: user.name, note: `Before test-data wipe: ${scopes.join(", ")}` });
        backup = r.entry.file;
      } catch (e) {
        return NextResponse.json({ error: `The safety backup failed, so nothing was deleted: ${(e as Error).message}` }, { status: 500 });
      }
    }
    consumeWipeToken(String(body.token));
    const result = performWipe(scopes);
    recordAudit({
      action: "DATA_WIPED", userId: user.id, userName: user.name, role: user.role,
      targetType: "data", targetId: scopes.join(","), targetLabel: "Test-data wipe",
      detail: `${result.files} file(s) in ${result.removed.join(", ") || "nothing"}${backup ? ` · backup ${backup}` : " · NO backup"}`,
    });
    return NextResponse.json({ ...result, backup });
  }

  if (body?.action === "deleteRecord") {
    const kind = String(body.kind || "");
    const id = String(body.id || "");
    if (body.confirm !== "DELETE") return NextResponse.json({ error: "Type DELETE to confirm." }, { status: 400 });
    let label = id;
    if (kind === "partner") {
      const all = loadPartners();
      const p = all.find((x) => x.id === id);
      if (!p) return NextResponse.json({ error: "Not found." }, { status: 404 });
      label = p.name;
      savePartners(all.filter((x) => x.id !== id));
      try { fs.rmSync(path.join(partnersDir(), p.id), { recursive: true, force: true }); } catch { /* files gone */ }
      try { syncMasterFromRegistration(); } catch { /* derived */ }
    } else if (kind === "client") {
      const f = readJson<{ clients: any[] }>(paths.clientsFile, { clients: [] });
      if (!(f.clients || []).some((c: any) => c.name === id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
      writeJsonAtomic(paths.clientsFile, { ...f, clients: f.clients.filter((c: any) => c.name !== id) });
    } else if (kind === "trip") {
      const all = loadTrips();
      const t = all.find((x) => x.id === id);
      if (!t) return NextResponse.json({ error: "Not found." }, { status: 404 });
      label = `#${t.serial} ${t.vehicleNumber}`;
      saveTrips(all.filter((x) => x.id !== id));
    } else if (kind === "po") {
      const f = loadPoFile();
      const po = f.pos.find((x) => x.id === id);
      if (!po) return NextResponse.json({ error: "Not found." }, { status: 404 });
      label = po.poNumber;
      savePoFile({ ...f, pos: f.pos.filter((x) => x.id !== id) });
    } else {
      return NextResponse.json({ error: "Unknown record type." }, { status: 400 });
    }
    recordAudit({ action: "RECORD_DELETED", userId: user.id, userName: user.name, role: user.role, targetType: kind, targetId: id, targetLabel: label, detail: "Deleted by the developer" });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
