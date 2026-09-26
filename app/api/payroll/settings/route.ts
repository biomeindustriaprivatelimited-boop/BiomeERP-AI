import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/authServer";
import { loadSettings, saveSettings, DEFAULT_SETTINGS, PayrollSettings } from "@/lib/payroll";
import { PLANTS } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requirePermission(req, "payroll");
  if ("response" in auth) return auth.response;
  return NextResponse.json({ settings: loadSettings(), defaults: DEFAULT_SETTINGS, plants: PLANTS });
}

/**
 * Statutory rates change by notification, so they are stored rather than
 * compiled in. Editing them is restricted to payroll.approve: a rate is not
 * a preference, and a wrong one is wrong for everybody at once.
 */
export async function PUT(req: NextRequest) {
  const auth = await requirePermission(req, "payroll.approve");
  if ("response" in auth) return auth.response;

  const body = await req.json().catch(() => null);
  if (!body?.settings) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });

  const current = loadSettings();
  const incoming = body.settings as Partial<PayrollSettings>;

  const pct = (v: unknown, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) return fallback;
    return n;
  };
  const money = (v: unknown, fallback: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return fallback;
    return n;
  };

  const next: PayrollSettings = {
    pf: {
      enabled: Boolean(incoming.pf?.enabled ?? current.pf.enabled),
      employeeRate: pct(incoming.pf?.employeeRate, current.pf.employeeRate),
      employerRate: pct(incoming.pf?.employerRate, current.pf.employerRate),
      pensionRate: pct(incoming.pf?.pensionRate, current.pf.pensionRate),
      wageCeiling: money(incoming.pf?.wageCeiling, current.pf.wageCeiling),
      applyCeiling: Boolean(incoming.pf?.applyCeiling ?? current.pf.applyCeiling),
      adminChargeRate: pct(incoming.pf?.adminChargeRate, current.pf.adminChargeRate),
      edliRate: pct(incoming.pf?.edliRate, current.pf.edliRate),
    },
    esic: {
      enabled: Boolean(incoming.esic?.enabled ?? current.esic.enabled),
      employeeRate: pct(incoming.esic?.employeeRate, current.esic.employeeRate),
      employerRate: pct(incoming.esic?.employerRate, current.esic.employerRate),
      grossCeiling: money(incoming.esic?.grossCeiling, current.esic.grossCeiling),
    },
    professionalTax: current.professionalTax,
    dayBasis: (["calendar", "fixed26", "fixed30"] as const).includes(incoming.dayBasis as any)
      ? (incoming.dayBasis as PayrollSettings["dayBasis"])
      : current.dayBasis,
    overtime: {
      enabled: Boolean(incoming.overtime?.enabled ?? current.overtime.enabled),
      multiplier: Math.min(5, Math.max(1, Number(incoming.overtime?.multiplier) || current.overtime.multiplier)),
      hoursPerDay: Math.min(16, Math.max(1, Number(incoming.overtime?.hoursPerDay) || current.overtime.hoursPerDay)),
    },
  };

  // The pension share comes out of the employer's 12%, so it cannot exceed
  // it — that would make the EPF line negative.
  if (next.pf.pensionRate > next.pf.employerRate) {
    return NextResponse.json(
      { error: "The pension share can't be larger than the employer's PF share." },
      { status: 400 }
    );
  }

  if (incoming.professionalTax && typeof incoming.professionalTax === "object") {
    const cleaned: PayrollSettings["professionalTax"] = { ...current.professionalTax };
    for (const plant of PLANTS.map((p) => p.code)) {
      const raw = (incoming.professionalTax as any)[plant];
      if (!raw) continue;
      cleaned[plant] = {
        enabled: Boolean(raw.enabled),
        slabs: Array.isArray(raw.slabs)
          ? raw.slabs
              .map((s: any) => ({
                upTo: Number(s?.upTo) > 0 ? Number(s.upTo) : Number.MAX_SAFE_INTEGER,
                amount: Math.max(0, Number(s?.amount) || 0),
              }))
              .slice(0, 10)
              .sort((a: any, b: any) => a.upTo - b.upTo)
          : [],
      };
    }
    next.professionalTax = cleaned;
  }

  saveSettings(next);
  return NextResponse.json({ settings: next });
}
