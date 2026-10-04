/**
 * Biome Platform — module report catalogue (server only)
 * -------------------------------------------------------------------
 * One report per business module, each with the ways it makes sense to
 * cut it: by category, by person, by place, by plant, by user, by vendor,
 * by client, by vehicle, by machine, by month… Only the cuts that apply
 * to that module are offered.
 *
 * Every dataset is loaded THROUGH THE SAME ACCESS RULES the module itself
 * uses: a plant manager's transport report is their plant only, an imprest
 * report shows only the entries that person could already open, the
 * trading coordination report needs `coordination`. A report is never a
 * side door into data the person cannot see on the module's own screen.
 *
 * The screen (app/report-builder) turns the result into a summary with
 * sub-totals, a detail table, a branded PDF and a formatted Excel file.
 */

import path from "path";
import { paths, readJson } from "@/lib/dataRoot";
import type { Permission, Role } from "@/lib/permissions";
import { loadEntries as loadImprestEntries, loadPeople as loadImprestPeople, STATUS_LABELS as IMPREST_STATUS } from "@/lib/imprest";
import {
  loadBudgets as loadImprestBudgets, makeLookup as budgetLookup, visibleBudgets, windowsBetween, usageIn,
  BUDGET_SCOPES, BUDGET_PERIODS,
} from "@/lib/imprestBudget";
import { loadEmployees } from "@/lib/payroll";
import { loadTrips, shortageFor, derivedStatus, TRIP_STATUS } from "@/lib/coordination";
import { loadPartners, gapsFor, PARTNER_KINDS, SUPPLY_CATEGORIES } from "@/lib/partners";
import { loadStock, stockRows, computeBalances, balanceOf, MOVEMENT_LABEL } from "@/lib/stock";
import { loadPlants } from "@/lib/plants";
import { slugForCode } from "@/lib/plantRegistry";
import { loadLeave } from "@/lib/leave";
import { computeAll as computePos } from "@/lib/po";
import { matchAll, tripPlant } from "@/lib/plantMatch";

export type ColType = "text" | "number" | "money" | "kg" | "date" | "pct";

export interface ColumnDef {
  key: string;
  label: string;
  type: ColType;
  /** Summed in group sub-totals and the grand total. */
  sum?: boolean;
  width?: number;
}

export interface ReportContext {
  userId: string;
  userName: string;
  role: Role;
  perms: Permission[];
  plant: string | null;
}

export interface DatasetDef {
  id: string;
  module: string;
  label: string;
  description: string;
  /** Any ONE of these opens the report. */
  perms: Permission[];
  dateField: string | null;
  /**
   * For rows that span a period (budgets): the end-date field. The date
   * range then keeps every row whose period OVERLAPS it, so a yearly
   * budget still shows when "This month" is picked.
   */
  dateEndField?: string;
  columns: ColumnDef[];
  /** The cuts that apply: row keys, with the label shown as "by …". */
  dimensions: { key: string; label: string }[];
  load: (ctx: ReportContext) => Record<string, any>[];
}

const has = (ctx: ReportContext, p: Permission) => ctx.perms.includes(p);
const plantLabel = (code: string) => loadPlants().find((p) => p.code === code)?.label || code || "—";


/** A field role sees its own plant; everybody else every plant. */
function plantsFor(ctx: ReportContext, wide: Permission[] = ["finance", "users", "stock.manage"]): string[] {
  const all = loadPlants().filter((p) => p.active).map((p) => p.code);
  if (ctx.role === "plant_manager" && ctx.plant && !wide.some((w) => has(ctx, w))) return [ctx.plant];
  return all;
}

/**
 * Plant sheets follow lib/plantScope.ts exactly: finance roles see every
 * plant, a field role its session plant, and anyone else (a coordinator)
 * none — the plant's book is not the coordination team's to read.
 */
function sheetPlants(ctx: ReportContext): string[] {
  if (has(ctx, "finance")) return loadPlants().filter((p) => p.active).map((p) => p.code);
  return ctx.plant ? [ctx.plant] : [];
}

function plantSheet(kind: "biomass" | "transport", code: string): any[] {
  const slug = slugForCode(code);
  if (!slug) return [];
  const f = readJson<{ rows?: any[] }>(path.join(paths.configDir, "plants", `${slug}-${kind}.json`), {});
  return Array.isArray(f.rows) ? f.rows : [];
}

const n = (v: any) => { const x = Number(String(v ?? "").replace(/[^\d.\-]/g, "")); return Number.isFinite(x) ? x : 0; };
const statusLabel = (id: string) => TRIP_STATUS.find((s) => s.id === id)?.label || id;

/* ------------------------------------------------------------------ */
/* The catalogue                                                        */
/* ------------------------------------------------------------------ */

export const DATASETS: DatasetDef[] = [
  /* ---------------- Imprest ---------------- */
  {
    id: "imprest", module: "Imprest", label: "Imprest — expenses & advances",
    description: "Every imprest entry you can see: spend by category, by holder, by plant, by who filed it, by status.",
    perms: ["imprest.view", "imprest.entry"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "holder", label: "Holder", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "kindLabel", label: "Type", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "description", label: "Description", type: "text", width: 50 },
      { key: "reference", label: "Bill / ref", type: "text" },
      { key: "mode", label: "Mode", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "filedBy", label: "Filed by", type: "text" },
      { key: "expense", label: "Expense ₹", type: "money", sum: true },
      { key: "advance", label: "Advance ₹", type: "money", sum: true },
    ],
    dimensions: [
      { key: "category", label: "Category" }, { key: "holder", label: "Person (holder)" }, { key: "plantName", label: "Plant" },
      { key: "filedBy", label: "User (filed by)" }, { key: "status", label: "Status" }, { key: "kindLabel", label: "Type" }, { key: "mode", label: "Payment mode" },
    ],
    load: (ctx) => {
      const people = loadImprestPeople();
      const me = people.find((p) => p.userId === ctx.userId);
      let entries = loadImprestEntries();
      if (!has(ctx, "imprest.viewAll")) {
        const own = (e: any) => me && e.personId === me.id;
        entries = has(ctx, "imprest.approve")
          ? entries.filter((e) => own(e) || e.status === "submitted" || e.decidedBy === ctx.userId)
          : has(ctx, "imprest.viewPlant") && ctx.plant
          ? entries.filter((e) => own(e) || e.plant === ctx.plant)
          : entries.filter(own);
      }
      return entries.map((e) => {
        const p = people.find((x) => x.id === e.personId);
        return {
          date: e.date, holder: p?.name || "—", plant: e.plant || p?.plant || "", plantName: plantLabel(e.plant || p?.plant || ""),
          kindLabel: e.kind === "advance" ? "Advance" : e.kind === "return" ? "Cash returned" : "Expense",
          category: e.category || (e.kind === "advance" ? "Advance" : e.kind === "return" ? "Cash returned" : "—"),
          description: e.description, reference: e.reference, mode: e.mode, status: IMPREST_STATUS[e.status] || e.status, filedBy: e.createdByName,
          expense: e.kind === "expense" ? e.amount : 0, advance: e.kind === "advance" ? e.amount : 0,
        };
      });
    },
  },

  /* ---------------- Imprest budgets ---------------- */
  {
    id: "imprest_budget", module: "Imprest", label: "Imprest — budget vs actual",
    description: "Every imprest budget, period by period: allocation, approved spend, claims waiting, over-budget entries held for admin, what is left and % used. Cut by employee, plant, expense head, scope or period.",
    perms: ["imprest.view"], dateField: "periodStart", dateEndField: "periodEnd",
    columns: [
      { key: "periodStart", label: "Period from", type: "date" },
      { key: "periodEnd", label: "Period to", type: "date" },
      { key: "periodLabel", label: "Period", type: "text" },
      { key: "budget", label: "Budget", type: "text", width: 34 },
      { key: "scopeLabel", label: "Budget on", type: "text" },
      { key: "periodType", label: "Frequency", type: "text" },
      { key: "holder", label: "Employee", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "category", label: "Expense head", type: "text" },
      { key: "limitType", label: "Limit", type: "text" },
      { key: "allocated", label: "Budget ₹", type: "money", sum: true },
      { key: "spent", label: "Approved ₹", type: "money", sum: true },
      { key: "committed", label: "Waiting ₹", type: "money", sum: true },
      { key: "actual", label: "Actual (approved + waiting) ₹", type: "money", sum: true },
      { key: "held", label: "Held over budget ₹", type: "money", sum: true },
      { key: "remaining", label: "Remaining ₹", type: "money", sum: true },
      { key: "overBy", label: "Over by ₹", type: "money", sum: true },
      { key: "usedPct", label: "Used %", type: "pct" },
      { key: "state", label: "Status", type: "text" },
    ],
    dimensions: [
      { key: "holder", label: "Employee" }, { key: "plantName", label: "Plant" }, { key: "category", label: "Expense head" },
      { key: "budget", label: "Budget" }, { key: "scopeLabel", label: "Budget on" }, { key: "periodLabel", label: "Period" },
      { key: "periodType", label: "Frequency" }, { key: "state", label: "Status" }, { key: "limitType", label: "Limit" },
    ],
    load: (ctx) => {
      const people = loadImprestPeople();
      const lookup = budgetLookup(people, loadEmployees());
      const me = people.find((p) => p.userId === ctx.userId);
      const budgets = visibleBudgets(loadImprestBudgets(), {
        all: has(ctx, "imprest.viewAll") || has(ctx, "imprest.approve") || ctx.role === "admin" || ctx.role === "developer",
        personId: me?.id ?? null,
        plantView: has(ctx, "imprest.viewPlant") && ctx.plant ? ctx.plant : null,
        sessionPlant: ctx.plant,
        lookup,
      });
      const entries = loadImprestEntries();
      const today = new Date().toISOString().slice(0, 10);
      // Two financial years back is enough history and keeps monthly
      // budgets from producing hundreds of empty rows.
      const earliest = `${Number(today.slice(0, 4)) - 2}-04-01`;
      const rows: Record<string, any>[] = [];
      for (const b of budgets) {
        // From when it first applied: its custom start, its "runs from"
        // month, or else the month it was created.
        const from = b.period === "custom" ? b.startDate : b.fromMonth ? `${b.fromMonth}-01` : `${b.createdAt.slice(0, 7)}-01`;
        for (const w of windowsBetween(b, from < earliest ? earliest : from, today)) {
          const u = usageIn(b, w, entries, lookup);
          const holderName = b.match.personId ? people.find((p) => p.id === b.match.personId)?.name || "—" : b.match.designation ? `All ${b.match.designation}` : b.match.department ? `${b.match.department} dept.` : "All";
          rows.push({
            periodStart: w.start, periodEnd: w.end, periodLabel: w.label,
            budget: b.label,
            scopeLabel: BUDGET_SCOPES.find((x) => x.id === b.scope)?.label || b.scope,
            periodType: BUDGET_PERIODS.find((x) => x.id === b.period)?.label || b.period,
            holder: holderName,
            plant: b.match.plant || (b.match.personId ? lookup(b.match.personId)?.plant || "" : ""),
            plantName: b.match.plant ? plantLabel(b.match.plant) : b.match.personId ? plantLabel(lookup(b.match.personId)?.plant || "") : "All plants",
            category: b.match.category || "All heads",
            limitType: b.enforce ? "Hard (needs admin)" : "Warn only",
            allocated: b.amount, spent: u.spent, committed: u.committed, actual: u.spent + u.committed,
            held: u.held, remaining: Math.max(0, u.remaining), overBy: u.remaining < 0 ? -u.remaining : 0,
            usedPct: b.amount > 0 ? Math.round(((u.spent + u.committed) / b.amount) * 1000) / 10 : 0,
            state: u.state === "over" ? "Over budget" : u.state === "tight" ? "90%+ used" : u.state === "watch" ? "75%+ used" : "Within budget",
            ...(b.active ? {} : { state: "Switched off" }),
          });
        }
      }
      return rows;
    },
  },

  {
    id: "imprest_budget_holds", module: "Imprest", label: "Imprest — over-budget approvals",
    description: "Every expense that crossed a hard budget and was held for the admin: which budget, by how much, and whether it was passed or refused.",
    perms: ["imprest.view"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "holder", label: "Employee", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "category", label: "Expense head", type: "text" },
      { key: "description", label: "Description", type: "text", width: 40 },
      { key: "budgets", label: "Budget crossed", type: "text", width: 40 },
      { key: "decision", label: "Decision", type: "text" },
      { key: "decidedBy", label: "Decided by", type: "text" },
      { key: "decidedOn", label: "Decided on", type: "date" },
      { key: "note", label: "Note", type: "text", width: 30 },
      { key: "currentStatus", label: "Entry status now", type: "text" },
      { key: "amount", label: "Amount ₹", type: "money", sum: true },
      { key: "overBy", label: "Over by ₹", type: "money", sum: true },
    ],
    dimensions: [
      { key: "holder", label: "Employee" }, { key: "plantName", label: "Plant" }, { key: "category", label: "Expense head" },
      { key: "budgets", label: "Budget crossed" }, { key: "decision", label: "Decision" }, { key: "decidedBy", label: "Decided by" },
    ],
    load: (ctx) => {
      const people = loadImprestPeople();
      const me = people.find((p) => p.userId === ctx.userId);
      const wide = has(ctx, "imprest.viewAll") || has(ctx, "imprest.approve") || ctx.role === "admin" || ctx.role === "developer";
      const plantView = has(ctx, "imprest.viewPlant") && ctx.plant ? ctx.plant : null;
      return loadImprestEntries()
        .filter((e) => e.budgetHold)
        .filter((e) => wide || (me && e.personId === me.id) || (plantView && e.plant === plantView))
        .map((e) => {
          const h = e.budgetHold!;
          const p = people.find((x) => x.id === e.personId);
          return {
            date: e.date, holder: p?.name || "—", plant: e.plant || "", plantName: plantLabel(e.plant || p?.plant || ""),
            category: e.category || "—", description: e.description,
            budgets: h.breaches.map((b) => `${b.label} (${b.periodLabel})`).join("; ") || "—",
            decision: h.decision === "approved" ? "Passed by admin" : h.decision === "rejected" ? "Refused by admin" : "Waiting for admin",
            decidedBy: h.decidedByName || "—", decidedOn: h.decidedAt ? h.decidedAt.slice(0, 10) : "",
            note: h.note || "", currentStatus: IMPREST_STATUS[e.status] || e.status,
            amount: e.amount, overBy: h.overBy,
          };
        });
    },
  },

  /* ---------------- Coordination: trading ---------------- */
  {
    id: "coordination_trading", module: "Coordination", label: "Coordination — trading supplies",
    description: "Trading trips vendor → client with dispatched, received and shortage weights; by client, vendor, place, vehicle, status, user.",
    perms: ["coordination"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "serial", label: "#", type: "number" },
      { key: "ourDocNo", label: "Our doc", type: "text" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "client", label: "Client", type: "text" },
      { key: "place", label: "Location", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "dispatchedKg", label: "Dispatched kg", type: "kg", sum: true },
      { key: "receivedKg", label: "Received kg", type: "kg", sum: true },
      { key: "shortKg", label: "Short kg", type: "kg", sum: true },
      { key: "excessKg", label: "Beyond allowance kg", type: "kg", sum: true },
      { key: "invoiceAmount", label: "Invoice ₹", type: "money", sum: true },
      { key: "user", label: "Entered by", type: "text" },
    ],
    dimensions: [
      { key: "client", label: "Client" }, { key: "vendor", label: "Vendor" }, { key: "place", label: "Place (location)" },
      { key: "vehicle", label: "Vehicle" }, { key: "status", label: "Status" }, { key: "user", label: "User (entered by)" }, { key: "docType", label: "Document type" },
    ],
    load: () => loadTrips().filter((t) => t.business === "trading").map((t) => tripRow(t)),
  },

  /* ---------------- Coordination: manufacturing ---------------- */
  {
    id: "coordination_mfg", module: "Coordination", label: "Coordination — manufacturing supplies",
    description: "Supplies from our plants to clients, with the plant-dispatch match verdict; by plant, client, place, vehicle, status, user.",
    perms: ["coordination", "finance"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "serial", label: "#", type: "number" },
      { key: "ourDocNo", label: "Our doc", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "client", label: "Client", type: "text" },
      { key: "place", label: "Location", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "plantMatch", label: "Plant match", type: "text" },
      { key: "dispatchedKg", label: "Dispatched kg", type: "kg", sum: true },
      { key: "receivedKg", label: "Received kg", type: "kg", sum: true },
      { key: "shortKg", label: "Short kg", type: "kg", sum: true },
      { key: "invoiceAmount", label: "Invoice ₹", type: "money", sum: true },
      { key: "user", label: "Entered by", type: "text" },
    ],
    dimensions: [
      { key: "plantName", label: "Plant" }, { key: "client", label: "Client" }, { key: "place", label: "Place (location)" },
      { key: "vehicle", label: "Vehicle" }, { key: "status", label: "Status" }, { key: "plantMatch", label: "Plant match" }, { key: "user", label: "User (entered by)" },
    ],
    load: () => {
      const verdict = new Map<string, string>();
      for (const p of matchAll(loadPlants().map((x) => x.code))) if (p.tripId) verdict.set(p.tripId, p.status);
      const label: Record<string, string> = { matched: "Matched", weight_differs: "Weight differs", unmatched: "Not in plant sheet" };
      return loadTrips().filter((t) => t.business === "manufacturing").map((t) => {
        const code = tripPlant(t) || "";
        return { ...tripRow(t), plant: code, plantName: code ? plantLabel(code) : "Unknown plant", plantMatch: label[verdict.get(t.id) || "unmatched"] };
      });
    },
  },

  /* ---------------- Transport (plant sheet) ---------------- */
  {
    id: "transport", module: "Transport", label: "Transport — plant dispatch sheet",
    description: "Every vehicle out of the plant: weights, freight, driver, transporter; by plant, transporter, party, place, vehicle, driver, purpose.",
    perms: ["plant"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "party", label: "Party", type: "text" },
      { key: "place", label: "To", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "driver", label: "Driver", type: "text" },
      { key: "transporterCode", label: "Transporter code", type: "text" },
      { key: "transporter", label: "Transporter", type: "text" },
      { key: "purpose", label: "Purpose", type: "text" },
      { key: "weight", label: "Dispatch wt", type: "number", sum: true },
      { key: "rWeight", label: "Receiving wt", type: "number", sum: true },
      { key: "actualWeight", label: "Freight wt", type: "number", sum: true },
      { key: "amount", label: "Freight ₹", type: "money", sum: true },
    ],
    dimensions: [
      { key: "plantName", label: "Plant" }, { key: "transporter", label: "Transporter" }, { key: "party", label: "Party" },
      { key: "place", label: "Place (to)" }, { key: "vehicle", label: "Vehicle" }, { key: "driver", label: "Person (driver)" }, { key: "purpose", label: "Trip purpose" },
    ],
    load: (ctx) => sheetPlants(ctx).flatMap((code) => plantSheet("transport", code).map((r) => {
      const a = n(r.weight), b = n(r.rWeight);
      const w = !a ? b : !b ? a : Math.min(a, b);
      return {
        date: String(r.date || "").slice(0, 10), plant: code, plantName: plantLabel(code), party: r.partyName || "", place: r.to || "",
        vehicle: String(r.vehicleNo || "").toUpperCase(), driver: r.driver || "", transporterCode: String(r.transporterCode || "").toUpperCase(), transporter: r.transporter || "", purpose: r.tripPurpose || "Supply",
        weight: a, rWeight: b, actualWeight: w, amount: n(r.rate) * w - n(r.daala),
      };
    })),
  },

  /* ---------------- Biomass purchase (plant sheet) ---------------- */
  {
    id: "biomass", module: "Biomass", label: "Biomass — purchase at plant",
    description: "Biomass bought at each plant: net and payable weight and value; by plant, vendor/farmer, village, material.",
    perms: ["plant"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "slip", label: "Slip no", type: "text" },
      { key: "vehicle", label: "Vehicle", type: "text" },
      { key: "vendorCode", label: "Vendor code", type: "text" },
      { key: "vendor", label: "Vendor / farmer", type: "text" },
      { key: "place", label: "Village", type: "text" },
      { key: "material", label: "Material", type: "text" },
      { key: "netWeight", label: "Net wt", type: "number", sum: true },
      { key: "payableWeight", label: "Payable wt", type: "number", sum: true },
      { key: "amount", label: "Amount ₹", type: "money", sum: true },
    ],
    dimensions: [
      { key: "plantName", label: "Plant" }, { key: "vendor", label: "Vendor / farmer (person)" }, { key: "place", label: "Place (village)" },
      { key: "material", label: "Category (material)" }, { key: "vehicle", label: "Vehicle" },
    ],
    load: (ctx) => sheetPlants(ctx).flatMap((code) => plantSheet("biomass", code).map((r) => {
      const net = n(r.grossWeight) - n(r.tareWeight);
      let payable: number, amount: number;
      if (code === "GKD") {
        payable = net - n(r.anyDeduction);
        amount = n(r.finalWeight) * n(r.rate) - n(r.weighbridgeCharge);
      } else {
        const dust = n(r.dustPct) > n(r.dustAllowance) ? (net * (n(r.dustPct) - n(r.dustAllowance))) / 100 : 0;
        const moist = n(r.moisturePct) > n(r.moistureAllowance) ? (net * (n(r.moisturePct) - n(r.moistureAllowance))) / 100 : 0;
        payable = net - dust - moist;
        amount = payable * n(r.rate) - n(r.weighbridgeCharges);
      }
      return {
        date: String(r.date || "").slice(0, 10), plant: code, plantName: plantLabel(code), slip: r.weightSlipNo || "",
        vehicle: String(r.vehicleNo || "").toUpperCase(), vendorCode: r.vendorCode || "", vendor: r.name || r.vendorName || "",
        place: r.village || "", material: r.materialType || "", netWeight: net, payableWeight: Math.round(payable * 100) / 100, amount: Math.round(amount),
      };
    })),
  },

  /* ---------------- Stock ---------------- */
  {
    id: "stock_onhand", module: "Stock", label: "Stock — on hand & value",
    description: "Current stock of spare parts and stores per plant with value and re-order status; by plant, category, status.",
    perms: ["stock"], dateField: null,
    columns: [
      { key: "plantName", label: "Plant", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "item", label: "Part", type: "text" },
      { key: "partNo", label: "Part no", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "unit", label: "Unit", type: "text" },
      { key: "qty", label: "On hand", type: "number", sum: true },
      { key: "minLevel", label: "Re-order", type: "number" },
      { key: "avgRate", label: "Avg rate ₹", type: "money" },
      { key: "value", label: "Value ₹", type: "money", sum: true },
      { key: "status", label: "Status", type: "text" },
    ],
    dimensions: [{ key: "plantName", label: "Plant" }, { key: "category", label: "Category" }, { key: "status", label: "Status" }],
    load: (ctx) => {
      const s = loadStock();
      return stockRows(s, plantsFor(ctx)).map((r) => ({
        plant: r.plant, plantName: plantLabel(r.plant), code: r.code, item: r.name, partNo: r.partNo, category: r.category, unit: r.unit,
        qty: r.qty, minLevel: r.minLevel, avgRate: r.avgRate, value: r.value, status: r.status === "ok" ? "OK" : r.status === "low" ? "Low — reorder" : "Out",
      }));
    },
  },
  {
    id: "stock_moves", module: "Stock", label: "Stock — receipts & issues (which part, which machine)",
    description: "Every GRN, issue, return, adjustment and transfer; by plant, movement, part, category, vendor, machine, person, user.",
    perms: ["stock"], dateField: "date",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "no", label: "Doc no", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "movement", label: "Movement", type: "text" },
      { key: "item", label: "Part", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "invoiceNo", label: "Invoice", type: "text" },
      { key: "machine", label: "Machine", type: "text" },
      { key: "person", label: "Issued to", type: "text" },
      { key: "qtyIn", label: "Qty in", type: "number", sum: true },
      { key: "qtyOut", label: "Qty out", type: "number", sum: true },
      { key: "valueIn", label: "Value in ₹", type: "money", sum: true },
      { key: "valueOut", label: "Value out ₹", type: "money", sum: true },
      { key: "user", label: "Entered by", type: "text" },
    ],
    dimensions: [
      { key: "plantName", label: "Plant" }, { key: "movement", label: "Movement type" }, { key: "item", label: "Part" }, { key: "category", label: "Category" },
      { key: "vendor", label: "Vendor" }, { key: "machine", label: "Machine" }, { key: "person", label: "Person (issued to)" }, { key: "user", label: "User (entered by)" },
    ],
    load: (ctx) => {
      const s = loadStock();
      const plants = plantsFor(ctx);
      const items = new Map(s.items.map((i) => [i.id, i]));
      const machines = new Map(s.machines.map((m) => [m.id, m]));
      const bal = computeBalances(s.movements);
      return s.movements.filter((m) => !m.cancelled && plants.includes(m.plant)).map((m) => {
        const it = items.get(m.itemId);
        const out = ["issue", "adjust_out", "transfer_out"].includes(m.type);
        const rate = m.rate || balanceOf(bal, m.itemId, m.plant).avgRate;
        return {
          date: m.date, no: m.no, plant: m.plant, plantName: plantLabel(m.plant), movement: MOVEMENT_LABEL[m.type],
          item: it ? `${it.name}${it.partNo ? ` (${it.partNo})` : ""}` : "?", category: it?.category || "", vendor: m.vendorName || "",
          invoiceNo: m.invoiceNo || m.challanNo || "", machine: machines.get(m.machineId)?.name || (m.type === "issue" ? "General use" : ""),
          person: m.issuedTo || "", qtyIn: out ? 0 : m.qty, qtyOut: out ? m.qty : 0,
          valueIn: out ? 0 : Math.round(m.qty * rate), valueOut: out ? Math.round(m.qty * rate) : 0, user: m.createdByName,
        };
      });
    },
  },

  /* ---------------- Vendor & client registry ---------------- */
  {
    id: "registry", module: "Vendors & clients", label: "Vendor & client registration",
    description: "Registered vendors, clients and transporters with KYC completeness and freeze state; by type, business side, status, city, state, plant, user.",
    perms: ["partners"], dateField: "registered",
    columns: [
      { key: "registered", label: "Registered", type: "date" },
      { key: "name", label: "Name", type: "text" },
      { key: "code", label: "Code", type: "text" },
      { key: "kind", label: "Type", type: "text" },
      { key: "side", label: "Business side", type: "text" },
      { key: "handles", label: "Handled for", type: "text" },
      { key: "gstin", label: "GSTIN", type: "text" },
      { key: "place", label: "City", type: "text" },
      { key: "state", label: "State", type: "text" },
      { key: "plants", label: "Plants", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "freeze", label: "Submitted", type: "text" },
      { key: "docs", label: "Docs", type: "number", sum: true },
      { key: "missing", label: "Missing", type: "text" },
      { key: "user", label: "Registered by", type: "text" },
    ],
    dimensions: [
      { key: "kind", label: "Type" }, { key: "side", label: "Business side" }, { key: "status", label: "Status" }, { key: "freeze", label: "Submitted / frozen" },
      { key: "place", label: "Place (city)" }, { key: "state", label: "State" }, { key: "plants", label: "Plant" }, { key: "user", label: "User (registered by)" },
    ],
    load: (ctx) => {
      let list = loadPartners();
      if (ctx.role === "coordinator") list = list.filter((p) => p.category === "trading");
      else if (ctx.role === "procurement") list = list.filter((p) => p.category !== "trading");
      else if (ctx.role === "plant_manager") list = list.filter((p) => p.category !== "trading" && (!ctx.plant || !p.plants.length || p.plants.includes(ctx.plant)));
      return list.map((p) => {
        const g = gapsFor(p);
        return {
          registered: p.createdAt.slice(0, 10), name: p.name, code: p.code,
          kind: PARTNER_KINDS.find((k) => k.id === p.kind)?.label || p.kind,
          side: p.category === "trading" ? "Trading" : "Manufacturing",
          handles: p.supplies.map((x) => SUPPLY_CATEGORIES.find((c) => c.id === x)?.label || x).join(", "),
          gstin: p.gstin, place: p.city || "—", state: p.state || "—", plants: p.plants.length ? p.plants.join(", ") : "All",
          status: p.status, freeze: p.lockState === "submitted" ? "Submitted & frozen" : "Not submitted",
          docs: p.documents.length, missing: [...g.missing.map((m) => m.label), ...g.missingFields].join(", "), user: p.registeredByName,
        };
      });
    },
  },

  /* ---------------- Purchase orders ---------------- */
  {
    id: "po", module: "PO Control", label: "Purchase orders — consumption",
    description: "Vendor and client POs with quantity consumed from linked supplies and balance; by party, type, status, material.",
    perms: ["operations"], dateField: "poDate",
    columns: [
      { key: "poDate", label: "PO date", type: "date" },
      { key: "poNumber", label: "PO no", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "party", label: "Party", type: "text" },
      { key: "material", label: "Material", type: "text" },
      { key: "totalKg", label: "PO qty kg", type: "kg", sum: true },
      { key: "consumedKg", label: "Consumed kg", type: "kg", sum: true },
      { key: "remainingKg", label: "Balance kg", type: "kg", sum: true },
      { key: "utilisation", label: "Used %", type: "pct" },
      { key: "expiry", label: "Expiry", type: "date" },
      { key: "status", label: "Status", type: "text" },
    ],
    dimensions: [{ key: "party", label: "Party" }, { key: "type", label: "Type" }, { key: "status", label: "Status" }, { key: "material", label: "Category (material)" }],
    load: (ctx) => {
      if (ctx.role === "plant_manager") return [];
      return computePos().pos.map((p) => ({
        poDate: p.poDate, poNumber: p.poNumber, type: p.type === "vendor" ? "Vendor PO" : "Client PO", party: p.partyName, material: p.material,
        totalKg: p.unit === "MT" ? p.totalQuantity * 1000 : p.totalQuantity, consumedKg: p.consumedKg, remainingKg: p.remainingKg,
        utilisation: p.utilisationPct, expiry: p.expiryDate, status: p.effectiveStatus,
      }));
    },
  },

  /* ---------------- Leave ---------------- */
  {
    id: "leave", module: "People", label: "Leave requests",
    description: "Leave taken and pending; by person, leave type, plant, status.",
    perms: ["attendance.entry"], dateField: "from",
    columns: [
      { key: "from", label: "From", type: "date" },
      { key: "to", label: "To", type: "date" },
      { key: "person", label: "Employee", type: "text" },
      { key: "plantName", label: "Plant", type: "text" },
      { key: "type", label: "Type", type: "text" },
      { key: "days", label: "Days", type: "number", sum: true },
      { key: "status", label: "Status", type: "text" },
      { key: "reason", label: "Reason", type: "text" },
      { key: "decidedBy", label: "Decided by", type: "text" },
    ],
    dimensions: [{ key: "person", label: "Person" }, { key: "type", label: "Category (leave type)" }, { key: "plantName", label: "Plant" }, { key: "status", label: "Status" }, { key: "decidedBy", label: "User (decided by)" }],
    load: (ctx) => {
      let list = loadLeave();
      if (!has(ctx, "attendance.approve") && !has(ctx, "users")) {
        list = ctx.role === "plant_manager" && ctx.plant ? list.filter((l) => l.plant === ctx.plant) : list.filter((l) => l.raisedBy === ctx.userId);
      }
      return list.map((l) => ({
        from: l.fromDate, to: l.toDate, person: l.employeeName, plant: l.plant, plantName: plantLabel(l.plant), type: l.type, days: l.days,
        status: l.status, reason: l.reason, decidedBy: l.decidedByName || "",
      }));
    },
  },
];

function tripRow(t: ReturnType<typeof loadTrips>[number]) {
  const sh = shortageFor(t);
  return {
    date: String(t.vehicleEntryDate || t.ourDocDate || "").slice(0, 10), serial: t.serial, ourDocNo: t.ourDocNo,
    docType: t.docType === "tax_invoice" ? "Tax invoice" : "Delivery challan",
    vendor: t.supplier || "—", client: t.client || "—", place: t.location || "—", vehicle: String(t.vehicleNumber || "").toUpperCase(),
    status: statusLabel(derivedStatus(t)), dispatchedKg: sh.dispatched, receivedKg: sh.received,
    shortKg: sh.differenceKg > 0 ? sh.differenceKg : 0, excessKg: sh.excessKg, invoiceAmount: t.billing?.totalAmount || 0, user: t.createdByName,
  };
}

/* ------------------------------------------------------------------ */
/* Running a report                                                     */
/* ------------------------------------------------------------------ */

export interface RunSpec {
  dataset: string;
  from?: string;
  to?: string;
  plant?: string;
  groupBy?: string;
  thenBy?: string;
  filters?: { field: string; value: string }[];
  search?: string;
}

export interface GroupNode {
  key: string;
  count: number;
  sums: Record<string, number>;
  children?: GroupNode[];
}

export function visibleDatasets(ctx: ReportContext) {
  return DATASETS.filter((d) => {
    if (!d.perms.some((p) => has(ctx, p))) return false;
    // Plant sheets: only for someone with a plant, or finance.
    if ((d.id === "transport" || d.id === "biomass") && !sheetPlants(ctx).length) return false;
    // PO consumption is an office report.
    if (d.id === "po" && ctx.role === "plant_manager") return false;
    return true;
  });
}

const monthOf = (d: string) => (d && /^\d{4}-\d{2}/.test(d) ? d.slice(0, 7) : "No date");

function valueOf(row: Record<string, any>, key: string, ds: DatasetDef): string {
  if (key === "__month" && ds.dateField) return monthOf(String(row[ds.dateField] || ""));
  const v = row[key];
  return v === undefined || v === null || v === "" ? "—" : String(v);
}

function group(rows: Record<string, any>[], key: string, ds: DatasetDef, sumKeys: string[], then?: string): GroupNode[] {
  const map = new Map<string, Record<string, any>[]>();
  for (const r of rows) {
    const k = valueOf(r, key, ds);
    const list = map.get(k) || [];
    list.push(r);
    map.set(k, list);
  }
  const nodes: GroupNode[] = [];
  for (const [k, list] of map) {
    const sums: Record<string, number> = {};
    for (const s of sumKeys) sums[s] = Math.round(list.reduce((t, r) => t + (Number(r[s]) || 0), 0) * 100) / 100;
    nodes.push({ key: k, count: list.length, sums, children: then ? group(list, then, ds, sumKeys) : undefined });
  }
  const first = sumKeys[0];
  // Months read in order; everything else biggest first.
  return key === "__month" ? nodes.sort((a, b) => a.key.localeCompare(b.key)) : nodes.sort((a, b) => (first ? b.sums[first] - a.sums[first] : 0) || b.count - a.count);
}

export function runDataset(ctx: ReportContext, spec: RunSpec) {
  const ds = visibleDatasets(ctx).find((d) => d.id === spec.dataset);
  if (!ds) throw new Error("That report is not available for your login.");
  let rows = ds.load(ctx);
  if (ds.dateField) {
    const endKey = ds.dateEndField || ds.dateField;
    if (spec.from) rows = rows.filter((r) => String(r[endKey] || "") >= spec.from!);
    if (spec.to) rows = rows.filter((r) => String(r[ds.dateField!] || "") <= spec.to!);
  }
  if (spec.plant) rows = rows.filter((r) => !("plant" in r) || r.plant === spec.plant || String(r.plants || "").includes(spec.plant!));
  for (const f of spec.filters || []) {
    if (!f.field || !f.value) continue;
    rows = rows.filter((r) => valueOf(r, f.field, ds).toLowerCase() === f.value.toLowerCase());
  }
  if (spec.search) {
    const q = spec.search.toLowerCase();
    rows = rows.filter((r) => ds.columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(q)));
  }
  if (ds.dateField) rows.sort((a, b) => String(b[ds.dateField!] || "").localeCompare(String(a[ds.dateField!] || "")));

  const sumKeys = ds.columns.filter((c) => c.sum).map((c) => c.key);
  const totals: Record<string, number> = {};
  for (const s of sumKeys) totals[s] = Math.round(rows.reduce((t, r) => t + (Number(r[s]) || 0), 0) * 100) / 100;

  const dims = [...ds.dimensions, ...(ds.dateField ? [{ key: "__month", label: "Month" }] : [])];
  const validDim = (k?: string) => (k && dims.some((d) => d.key === k) ? k : undefined);
  const g1 = validDim(spec.groupBy);
  const g2 = g1 ? validDim(spec.thenBy) : undefined;
  const groups = g1 ? group(rows, g1, ds, sumKeys, g2 && g2 !== g1 ? g2 : undefined) : [];

  // Distinct values for the filter pickers.
  const values: Record<string, string[]> = {};
  const base = ds.load(ctx);
  for (const d of ds.dimensions) values[d.key] = Array.from(new Set(base.map((r) => valueOf(r, d.key, ds)))).sort().slice(0, 300);

  return {
    dataset: { id: ds.id, label: ds.label, module: ds.module, description: ds.description, dateField: ds.dateField },
    columns: ds.columns,
    dimensions: dims,
    groupBy: g1 ? dims.find((d) => d.key === g1)!.label : null,
    thenBy: g2 ? dims.find((d) => d.key === g2)!.label : null,
    rows: rows.slice(0, 5000),
    truncated: rows.length > 5000,
    count: rows.length,
    totals,
    groups,
    values,
  };
}
