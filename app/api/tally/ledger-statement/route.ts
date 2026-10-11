import { NextRequest, NextResponse } from "next/server";
import { requirePermission, findById } from "@/lib/authServer";
import { effectivePermissions } from "@/lib/access";
import { respondWithProgress } from "@/lib/tallyStream";
import { tallyErrorBody } from "@/lib/tallyFinance";
import { fetchLedgerStatement, listLedgerNames } from "@/lib/tallyLedgerActivity";
import { loadPartners, partnersVisibleTo, type Partner } from "@/lib/partners";

/**
 * Ledger statement — Tally's "Ledger Vouchers" for ANY ledger (vendor,
 * client, bank, expense …) for the chosen period: opening balance, every
 * voucher with its contra ledger and running balance, closing balance
 * checked against Tally's own (lib/tallyLedgerActivity.ts).
 *
 * Body: the usual Tally connection fields + company, fromDate, toDate,
 * fresh, stream, and
 *   ledger: "<exact ledger name>"   -> the statement
 *   list: true                     -> every ledger name with its group
 *                                     (for the picker)
 *
 * Finance permission (plus `tally` from the /api/tally prefix). The party
 * block is enriched from the partner registry only for someone who may
 * see that registration (partners permission + the same plant / trading
 * visibility rules as the register itself).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const norm = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** The registration that matches a Tally ledger name, read defensively —
 *  fields added later (responsible person) may be missing on old records. */
function partnerFor(name: string, role: string, plant: string | null): Record<string, any> | null {
  let all: Partner[] = [];
  try {
    all = loadPartners();
  } catch {
    return null;
  }
  const want = norm(name);
  const hit = partnersVisibleTo(all, role, plant).find(
    (p) => norm(p.name) === want || norm(p.legalName) === want || (p.code && norm(p.code) === want)
  );
  if (!hit) return null;
  const any = hit as any;
  // Optional fields (added by the partner-responsibility work): a user id
  // and/or a plain name, a backup, and a team. Any may be missing.
  const nameOf = (id: unknown, fallback: unknown) => {
    const n = typeof fallback === "string" ? fallback.trim() : "";
    if (n) return n;
    if (typeof id === "string" && id) {
      const u = findById(id);
      return u ? u.name || u.username : "";
    }
    return "";
  };
  const teamLabel = typeof any.team === "string" && any.team ? any.team.charAt(0).toUpperCase() + any.team.slice(1) : "";
  const main =
    nameOf(any.responsibleUserId, any.responsibleName) ||
    [any.responsiblePerson, any.responsible?.name].map((v) => (typeof v === "string" ? v.trim() : "")).find(Boolean) ||
    "";
  const backup = nameOf(any.backupUserId, any.backupName);
  const responsible = main
    ? `${main}${teamLabel ? ` (${teamLabel})` : ""}${backup ? ` · backup: ${backup}` : ""}`
    : null;
  return {
    id: hit.id,
    kind: hit.kind,
    code: hit.code || null,
    name: hit.name,
    legalName: hit.legalName || null,
    gstin: hit.gstin || null,
    pan: hit.pan || null,
    contactPerson: hit.contactPerson || null,
    phone: hit.phone || null,
    email: hit.email || null,
    address: [hit.addressLine, hit.city, hit.state, hit.pincode].filter((x) => String(x || "").trim()).join(", ") || null,
    state: hit.state || null,
    responsiblePerson: responsible,
  };
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: Record<string, any>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const opts = {
    mode: body.mode,
    host: body.host,
    port: Number(body.port) || 9000,
    agentUrl: body.agentUrl,
    agentApiKey: body.agentApiKey,
    timeoutMs: Math.min(Number(body.timeoutMs) || 45000, 120000),
    company: String(body.company ?? body.companyName ?? "").trim() || undefined,
    fromDate: body.fromDate,
    toDate: body.toDate,
    fresh: body.fresh === true,
  };

  if (body.list === true) {
    try {
      const r = await listLedgerNames(opts);
      return NextResponse.json({ ok: true, ...r, count: r.ledgers.length });
    } catch (err) {
      const { status, body: errBody } = tallyErrorBody(err);
      return NextResponse.json(errBody, { status });
    }
  }

  const ledger = String(body.ledger ?? "").trim();
  if (!ledger) return NextResponse.json({ error: "Pick a ledger first.", code: "bad-request" }, { status: 400 });

  return respondWithProgress(body.stream === true, async (progress) => {
    try {
      const st = await fetchLedgerStatement({ ...opts, ledger, onProgress: progress });
      const user = findById(auth.session.uid);
      const canSeeRegister = user ? effectivePermissions(user.role, user.access).includes("partners") : false;
      const partner = canSeeRegister && user ? partnerFor(st.ledger.name, user.role, auth.session.plant) : null;
      return { status: 200, body: { ok: true, ...st, partner } };
    } catch (err) {
      const { status, body: errBody } = tallyErrorBody(err);
      return { status, body: errBody };
    }
  });
}
