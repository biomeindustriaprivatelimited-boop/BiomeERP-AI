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

function financialYear() {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

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

  const fy = financialYear();
  const from = body.fromDate || fy.from;
  const to = body.toDate || fy.to;

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

  const ledgers = await safely("ledgers", async () => parseLedgers(await askTally(conn, requests.ledgers(conn))), [] as any[]);
  const vouchers = await safely("vouchers", async () => parseVouchers(await askTally(conn, requests.vouchers(conn, from, to))), [] as any[]);
  const balanceSheet = await safely("balanceSheet", async () => parseGroups(await askTally(conn, requests.balanceSheet(conn))), [] as any[]);
  const profitLoss = await safely("profitLoss", async () => parseGroups(await askTally(conn, requests.profitLoss(conn))), [] as any[]);
  const stock = await safely("stock", async () => parseStock(await askTally(conn, requests.stock(conn))), [] as any[]);

  const gstParties = ledgers.filter((l: any) => l.isGstRegistered);
  const inGroup = (g: string | null, keys: string[]) => keys.some((k) => (g || "").toLowerCase().includes(k));

  return NextResponse.json({
    fetchedAt: new Date().toISOString(),
    probe,
    period: { from, to },
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
      customers: ledgers.filter((l: any) => inGroup(l.group, ["sundry debtor"])),
      vendors: ledgers.filter((l: any) => inGroup(l.group, ["sundry creditor"])),
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
