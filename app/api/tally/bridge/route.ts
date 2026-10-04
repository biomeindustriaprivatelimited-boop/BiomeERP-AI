import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import {
  requests,
  askTally,
  probeBridge,
  parseLedgers,
  parseVouchers,
  parseGroups,
  parseStock,
  type TallyConn,
} from "@/lib/tallyBridge";
import { buildGroupClassifier, resolvePeriod, CATEGORY_LABEL } from "@/lib/tallyFinance";

/**
 * The full Tally pull, through the BiomeBridge TDL.
 *
 * One request gets everything: ledgers with GST identity, every voucher
 * with its line entries, the balance sheet, the P&L and stock. That is
 * what makes party-wise and GST-wise reporting possible — the old export
 * simply didn't carry those fields.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const conn: TallyConn = {
    host: (body.host || "localhost").trim(),
    port: Number(body.port) || 9000,
    company: (body.company || "").trim() || undefined,
    timeoutMs: Math.min(Number(body.timeoutMs) || 90000, 180000),
  };

  // Probe first: "Tally is down" and "the bridge isn't installed" need
  // completely different fixes, and guessing between them wastes time.
  const probe = await probeBridge(conn);
  if (!probe.reachable) {
    return NextResponse.json({ error: probe.message, probe }, { status: 502 });
  }
  if (!probe.bridgeLoaded) {
    return NextResponse.json({ error: probe.message, probe, needsBridge: true }, { status: 409 });
  }

  // Current FY till today (not to 31 March — post-dated vouchers are not
  // today's position).
  const period = resolvePeriod({ fromDate: body.fromDate, toDate: body.toDate });
  const from = period.from;
  const to = period.to;

  // Each section is fetched independently so one failure doesn't lose the
  // rest — a large voucher range timing out shouldn't cost you the ledgers.
  const errors: Record<string, string> = {};
  async function safely<T>(name: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await fn();
    } catch (err: any) {
      errors[name] = err?.name === "AbortError" ? "Timed out." : err?.message || "Failed.";
      return fallback;
    }
  }

  const ledgers = await safely("ledgers", async () => parseLedgers(await askTally(conn, requests.ledgers(conn, from, to))), [] as any[]);
  const vouchers = await safely("vouchers", async () => parseVouchers(await askTally(conn, requests.vouchers(conn, from, to))), [] as any[]);
  const balanceSheet = await safely("balanceSheet", async () => parseGroups(await askTally(conn, requests.balanceSheet(conn, from, to))), [] as any[]);
  const profitLoss = await safely("profitLoss", async () => parseGroups(await askTally(conn, requests.profitLoss(conn, from, to))), [] as any[]);
  const stock = await safely("stock", async () => parseStock(await askTally(conn, requests.stock(conn, from, to))), [] as any[]);

  const gstParties = ledgers.filter((l: any) => l.isGstRegistered);
  // Walk the group tree (balance sheet + P&L groups) so parties in
  // sub-groups of Sundry Debtors/Creditors are found, not just direct ones.
  const classifier = buildGroupClassifier(
    [...balanceSheet, ...profitLoss].map((g: any) => ({ name: g.name, parent: g.parent, reservedName: null }))
  );
  const reservedOf = (g: string | null) => CATEGORY_LABEL[classifier.classify(g).category];

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    probe,
    period,
    counts: {
      ledgers: ledgers.length,
      vouchers: vouchers.length,
      voucherEntries: vouchers.reduce((s: number, v: any) => s + v.entries.length, 0),
      balanceSheetGroups: balanceSheet.length,
      profitLossGroups: profitLoss.length,
      stockItems: stock.length,
      gstRegisteredParties: gstParties.length,
      nonGstParties: ledgers.length - gstParties.length,
    },
    ledgers,
    vouchers,
    balanceSheet,
    profitLoss,
    stock,
    /** Split out because GST reconciliation needs exactly this. */
    parties: {
      customers: ledgers.filter((l: any) => reservedOf(l.group) === "Sundry Debtors"),
      vendors: ledgers.filter((l: any) => reservedOf(l.group) === "Sundry Creditors"),
      gstRegistered: gstParties,
    },
    partialErrors: Object.keys(errors).length ? errors : null,
  });
}

/** Quick health check without pulling any data. */
export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "finance");
  if ("response" in auth) return auth.response;

  const conn: TallyConn = {
    host: req.nextUrl.searchParams.get("host") || "localhost",
    port: Number(req.nextUrl.searchParams.get("port")) || 9000,
    company: req.nextUrl.searchParams.get("company") || undefined,
  };
  const probe = await probeBridge(conn);
  return NextResponse.json(probe, { status: probe.reachable ? 200 : 502 });
}
