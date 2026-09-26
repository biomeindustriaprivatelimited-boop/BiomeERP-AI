import fs from "fs"; import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { recordAudit } from "@/lib/audit";
import { paths, ensureDir, sanitizeSegment } from "@/lib/dataRoot";
import { loadContracts, saveContracts, contractView, type Contract } from "@/lib/enterprise2";

export const runtime = "nodejs"; export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "work"); if ("response" in auth) return auth.response;
  return NextResponse.json({ contracts: loadContracts().map(contractView).sort((a, b) => (a.daysToExpiry ?? 9999) - (b.daysToExpiry ?? 9999)) });
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "work"); if ("response" in auth) return auth.response;
  const user = findById(auth.session.uid)!; const body = await req.json().catch(() => ({})); const list = loadContracts(); const now = new Date().toISOString();
  const audit = (action: string, c: Contract, detail?: string) => recordAudit({ action, userId: user.id, userName: user.name, role: user.role, targetType: "contract", targetId: c.id, targetLabel: c.title, detail });
  if (body.action === "create") {
    const c: Contract = { id: crypto.randomUUID(), title: String(body.title || "").trim(), party: String(body.party || "").trim(), partyType: ["vendor", "client", "transporter", "other"].includes(body.partyType) ? body.partyType : "other", kind: ["supply", "transport", "service", "lease", "other"].includes(body.kind) ? body.kind : "other", startDate: body.startDate || now.slice(0, 10), expiryDate: body.expiryDate || "", value: body.value ? Number(body.value) : null, renewalStatus: "not_started", obligations: (Array.isArray(body.obligations) ? body.obligations : []).map((o: any) => ({ id: crypto.randomUUID(), text: String(o.text || ""), dueOn: o.dueOn || "", amount: o.amount ? Number(o.amount) : null, done: false, doneAt: null })).filter((o: any) => o.text), attachment: null, notes: String(body.notes || ""), createdBy: user.name, createdAt: now, updatedAt: now };
    if (!c.title || !c.party) return NextResponse.json({ error: "Title and party are required." }, { status: 400 });
    list.unshift(c); saveContracts(list); audit("contract.create", c); return NextResponse.json({ contract: contractView(c) });
  }
  const c = list.find((x) => x.id === body.id); if (!c) return NextResponse.json({ error: "Contract not found." }, { status: 404 });
  if (body.action === "obligation") { const o = c.obligations.find((x) => x.id === body.obligationId); if (o) { o.done = !o.done; o.doneAt = o.done ? now : null; } audit("contract.obligation", c, `${o?.text} → ${o?.done ? "done" : "pending"}`); }
  else if (body.action === "add-obligation") { c.obligations.push({ id: crypto.randomUUID(), text: String(body.text || ""), dueOn: body.dueOn || "", amount: body.amount ? Number(body.amount) : null, done: false, doneAt: null }); audit("contract.obligation.add", c, String(body.text || "")); }
  else if (body.action === "renewal") { c.renewalStatus = ["not_started", "in_progress", "renewed", "will_not_renew"].includes(body.status) ? body.status : c.renewalStatus; if (body.newExpiry && c.renewalStatus === "renewed") c.expiryDate = String(body.newExpiry); audit("contract.renewal", c, c.renewalStatus); }
  else if (body.action === "attach" && body.fileBase64) { const dir = path.join(paths.root, "contracts", c.id); ensureDir(dir); const name = sanitizeSegment(String(body.fileName || "contract.pdf")); fs.writeFileSync(path.join(dir, name), Buffer.from(String(body.fileBase64), "base64")); c.attachment = { name, file: path.join("contracts", c.id, name) }; audit("contract.attach", c, name); }
  else return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  c.updatedAt = now; saveContracts(list); return NextResponse.json({ contract: contractView(c) });
}
