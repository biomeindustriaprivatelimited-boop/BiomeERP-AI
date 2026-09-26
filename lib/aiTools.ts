/**
 * Biome AI OS — Tool Registry
 * -------------------------------------------------------------------
 * The layer that lets an AI actually DO things in this app rather than
 * just talk about them.
 *
 * Every tool here wraps a capability that already exists and already
 * works — Tally balances, the WhatsApp document store, the vendor and
 * client registries, GST reconciliation. Nothing is reimplemented. The
 * orchestrator picks a tool, this file runs it, and the result goes back
 * to the model as ground truth.
 *
 * THREE RULES, AND THEY MATTER
 *
 * 1. Tools return REAL data or an honest failure. A tool never guesses,
 *    never fabricates a plausible number, and never silently returns an
 *    empty result when something went wrong. A model given a made-up
 *    figure will state it with total confidence.
 *
 * 2. Every tool declares whether it WRITES. Read tools run freely; write
 *    tools are gated behind explicit user confirmation, because an AI
 *    that can delete a vendor on a misread instruction is a liability.
 *
 * 3. Tools are typed and self-describing. The schema below is what the
 *    model sees, so the description IS the interface — vague wording
 *    here produces wrong tool calls downstream.
 */

import { paths, readJson } from "./dataRoot";
import { agentJson, AgentUnavailableError } from "./whatsappAgent";
import type { Vendor, Client, WhatsappDocument, SupplySet } from "./whatsapp";
import {
  buildLedgerMastersRequestXml,
  parseLedgerMastersXml,
  buildVoucherFetchRequestXml,
  parseVoucherExportXml,
} from "./tally";

export type ToolAccess = "read" | "write";

export interface ToolDefinition {
  name: string;
  description: string;
  access: ToolAccess;
  /** JSON Schema for the arguments, as the model will see it. */
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
  run: (args: any, ctx: ToolContext) => Promise<ToolResult>;
}

export interface ToolContext {
  /** Tally connection, supplied by the caller from stored settings. */
  tally?: { host: string; port: number; company?: string };
  /** Write tools refuse unless this is true. */
  allowWrites?: boolean;
}

export interface ToolResult {
  ok: boolean;
  /** Whatever the tool found. Shown to the model verbatim. */
  data?: any;
  /** Why it failed, in words a person could act on. */
  error?: string;
  /** Where the data came from, so answers can be attributed. */
  source?: string;
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

async function askTally(ctx: ToolContext, xml: string, timeoutMs = 30000): Promise<string> {
  const host = ctx.tally?.host || "localhost";
  const port = ctx.tally?.port || 9000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${host}:${port}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml;charset=utf-8" },
      body: xml,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Tally replied with HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function tallyUnreachable(ctx: ToolContext): ToolResult {
  const host = ctx.tally?.host || "localhost";
  const port = ctx.tally?.port || 9000;
  return {
    ok: false,
    error:
      `Tally isn't reachable at ${host}:${port}. It needs to be open with the company loaded, ` +
      `and Gateway of Tally → F1 → Advanced Configuration → Client/Server set to "Both".`,
  };
}

/** Indian financial year containing today. */
function currentFY(): { from: string; to: string } {
  const now = new Date();
  const y = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return { from: `${y}0401`, to: `${y + 1}0331` };
}

const norm = (s: string) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ---------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------

export const TOOLS: ToolDefinition[] = [
  // ============ Tally ============
  {
    name: "get_financial_summary",
    description:
      "Current financial position from Tally: cash in hand, bank balance, total receivables (money customers owe us), total payables (money we owe vendors), sales and purchases for the financial year. Use this for any question about overall financial health, cash position, or how much money is owed either way.",
    access: "read",
    parameters: { type: "object", properties: {} },
    async run(_args, ctx) {
      try {
        const xml = await askTally(ctx, buildLedgerMastersRequestXml());
        const ledgers = parseLedgerMastersXml(xml);
        if (!ledgers.length) {
          return { ok: false, error: "Tally responded but returned no ledgers. Check the right company is loaded." };
        }

        const inGroup = (g: string | null, keys: string[]) =>
          keys.some((k) => (g || "").toLowerCase().includes(k));
        // Magnitudes only — Tally's sign convention differs between
        // installations, so the meaning comes from the account type.
        const total = (keys: string[]) =>
          ledgers.filter((l) => inGroup(l.group, keys)).reduce((s, l) => s + Math.abs(l.closingBalance), 0);
        const count = (keys: string[]) => ledgers.filter((l) => inGroup(l.group, keys)).length;

        return {
          ok: true,
          source: "Tally ledger masters",
          data: {
            cashInHand: total(["cash-in-hand", "cash in hand"]),
            bankBalance: total(["bank account", "bank od", "bank occ"]),
            receivables: total(["sundry debtor"]),
            payables: total(["sundry creditor"]),
            customerCount: count(["sundry debtor"]),
            vendorCount: count(["sundry creditor"]),
            ledgerCount: ledgers.length,
            currency: "INR",
            note: "Balances are closing balances from Tally ledger masters.",
          },
        };
      } catch {
        return tallyUnreachable(ctx);
      }
    },
  },

  {
    name: "find_party_balance",
    description:
      "Look up how much a specific customer or vendor owes us, or we owe them, by name. Use whenever a question names a party — e.g. 'how much does Jhajjar Power owe us', 'what is our balance with MH Industries'. Matches partial names.",
    access: "read",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "Full or partial party name as it appears in Tally." },
      },
      required: ["name"],
    },
    async run(args, ctx) {
      const query = norm(args?.name);
      if (!query) return { ok: false, error: "A party name is required." };
      try {
        const xml = await askTally(ctx, buildLedgerMastersRequestXml());
        const ledgers = parseLedgerMastersXml(xml);
        const matches = ledgers
          .filter((l) => norm(l.name).includes(query) || query.includes(norm(l.name)))
          .map((l) => ({
            name: l.name,
            group: l.group,
            closingBalance: Math.abs(l.closingBalance),
            openingBalance: Math.abs(l.openingBalance),
          }))
          .sort((a, b) => b.closingBalance - a.closingBalance)
          .slice(0, 20);

        if (!matches.length) {
          return {
            ok: true,
            source: "Tally ledger masters",
            data: { matches: [], note: `No ledger in Tally matches "${args.name}".` },
          };
        }
        return { ok: true, source: "Tally ledger masters", data: { matches, currency: "INR" } };
      } catch {
        return tallyUnreachable(ctx);
      }
    },
  },

  {
    name: "get_transactions",
    description:
      "Fetch transactions (vouchers) from Tally for the current financial year — sales, purchases, receipts, payments. Use for questions about what happened over a period, monthly totals, or activity with a specific party. Returns up to 500 vouchers.",
    access: "read",
    parameters: {
      type: "object",
      properties: {
        party: { type: "string", description: "Optional: only vouchers involving this party." },
        voucherType: {
          type: "string",
          description: "Optional filter: Sales, Purchase, Receipt, Payment, Journal.",
        },
      },
    },
    async run(args, ctx) {
      const fy = currentFY();
      try {
        const xml = await askTally(
          ctx,
          buildVoucherFetchRequestXml(fy.from, fy.to, ctx.tally?.company || undefined),
          45000
        );
        let vouchers = parseVoucherExportXml(xml);

        if (args?.party) {
          const p = norm(args.party);
          vouchers = vouchers.filter((v) => norm(v.party || "").includes(p));
        }
        if (args?.voucherType) {
          const t = norm(args.voucherType);
          vouchers = vouchers.filter((v) => norm(v.voucherType || "").includes(t));
        }

        const byType: Record<string, { count: number; value: number }> = {};
        for (const v of vouchers) {
          const t = v.voucherType || "Unknown";
          if (!byType[t]) byType[t] = { count: 0, value: 0 };
          byType[t].count += 1;
          byType[t].value += Math.abs(v.amount ?? 0);
        }

        return {
          ok: true,
          source: `Tally vouchers, ${fy.from} to ${fy.to}`,
          data: {
            totalCount: vouchers.length,
            byVoucherType: byType,
            transactions: vouchers.slice(0, 500),
          },
        };
      } catch {
        return tallyUnreachable(ctx);
      }
    },
  },

  // ============ Supply documents ============
  {
    name: "get_supply_sets",
    description:
      "The consignments tracked from WhatsApp documents, grouped by coordination reference (like BDC/786/MHI/44). Each shows the client, vendor, vehicle, which documents have arrived and which are still missing for that client. Use for questions about supplies, missing paperwork, or what's pending for a client.",
    access: "read",
    parameters: {
      type: "object",
      properties: {
        onlyIncomplete: {
          type: "boolean",
          description: "If true, return only supplies still missing documents.",
        },
        client: { type: "string", description: "Optional: filter to one client." },
      },
    },
    async run(args) {
      try {
        const json = await agentJson<{ sets: SupplySet[]; unmatched: WhatsappDocument[] }>("/sets");
        let sets = json.sets ?? [];
        if (args?.onlyIncomplete) sets = sets.filter((s) => !s.complete);
        if (args?.client) {
          const c = norm(args.client);
          sets = sets.filter((s) => norm(s.clientName || "").includes(c));
        }
        return {
          ok: true,
          source: "WhatsApp document agent",
          data: {
            count: sets.length,
            unmatchedDocuments: json.unmatched?.length ?? 0,
            sets: sets.slice(0, 50).map((s) => ({
              reference: s.reference,
              client: s.clientCanonicalName ?? s.clientName,
              vendor: s.vendorName ?? s.vendorCode,
              vehicle: s.vehicleNo,
              documentsReceived: s.documents.length,
              complete: s.complete,
              stillMissing: s.missing?.map((m) => m.label) ?? [],
              dscMissing: s.dscMissing?.map((m) => m.label) ?? [],
              lastSeen: s.lastSeen,
            })),
          },
        };
      } catch (err) {
        if (err instanceof AgentUnavailableError) return { ok: false, error: err.message };
        return { ok: false, error: (err as Error).message };
      }
    },
  },

  {
    name: "search_documents",
    description:
      "Search documents received on WhatsApp by any text on them — invoice number, vendor, vehicle number, client, or a coordination reference. Use to find a specific document or check whether one has arrived.",
    access: "read",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to search for." },
      },
      required: ["query"],
    },
    async run(args) {
      const q = String(args?.query || "").toLowerCase().trim();
      if (!q) return { ok: false, error: "A search term is required." };
      try {
        const json = await agentJson<{ documents: WhatsappDocument[] }>("/documents?limit=1000");
        const hits = (json.documents ?? [])
          .filter((d) =>
            [
              d.originalName,
              d.reference?.canonical,
              d.extracted?.clientName,
              d.extracted?.vendorName,
              d.extracted?.vehicleNo,
              d.extracted?.biomeDocNo,
              d.extracted?.vendorDocNo,
              d.extracted?.transcription,
            ]
              .filter(Boolean)
              .some((v) => String(v).toLowerCase().includes(q))
          )
          .slice(0, 30)
          .map((d) => ({
            fileName: d.originalName,
            documentType: d.extracted?.documentType ?? "unclassified",
            reference: d.reference?.canonical ?? null,
            client: d.extracted?.clientName ?? null,
            vendor: d.extracted?.vendorName ?? null,
            vehicle: d.extracted?.vehicleNo ?? null,
            amount: d.extracted?.totalAmount ?? null,
            receivedAt: d.receivedAt,
            status: d.bucket,
            savedAt: d.relativePath ?? null,
          }));
        return { ok: true, source: "WhatsApp document store", data: { count: hits.length, documents: hits } };
      } catch (err) {
        if (err instanceof AgentUnavailableError) return { ok: false, error: err.message };
        return { ok: false, error: (err as Error).message };
      }
    },
  },

  // ============ Registries ============
  {
    name: "list_vendors",
    description:
      "The vendor master: codes used in coordination references, names, GSTIN, contact details, and which KYC documents are on file. Use for questions about vendors, vendor codes, or missing vendor paperwork.",
    access: "read",
    parameters: {
      type: "object",
      properties: {
        search: { type: "string", description: "Optional: filter by code, name or GSTIN." },
        missingKyc: { type: "boolean", description: "If true, only vendors with no KYC documents." },
      },
    },
    async run(args) {
      const data = readJson<{ vendors: Vendor[] }>(paths.vendorsFile, { vendors: [] });
      let vendors = data.vendors ?? [];
      if (args?.search) {
        const q = norm(args.search);
        vendors = vendors.filter((v) =>
          [v.code, v.name, v.gstin, v.city].filter(Boolean).some((f) => norm(String(f)).includes(q))
        );
      }
      if (args?.missingKyc) vendors = vendors.filter((v) => !(v.kyc?.length));
      return {
        ok: true,
        source: "Vendor registry",
        data: {
          count: vendors.length,
          vendors: vendors.slice(0, 100).map((v) => ({
            code: v.code,
            name: v.name,
            gstin: v.gstin || null,
            supplyType: v.supplyType || null,
            city: v.city || null,
            phone: v.phone || null,
            kycDocumentCount: v.kyc?.length ?? 0,
          })),
        },
      };
    },
  },

  {
    name: "list_clients",
    description:
      "The client master: each power plant we supply and the exact documents it requires before a supply counts as complete, including which need a Digital Signature Certificate. Use for questions about what a client needs.",
    access: "read",
    parameters: {
      type: "object",
      properties: { search: { type: "string", description: "Optional: filter by client name." } },
    },
    async run(args) {
      const data = readJson<{ clients: Client[] }>(paths.clientsFile, { clients: [] });
      let clients = data.clients ?? [];
      if (args?.search) {
        const q = norm(args.search);
        clients = clients.filter((c) =>
          [c.name, c.shortName, ...(c.aliases ?? [])].filter(Boolean).some((a) => norm(String(a)).includes(q))
        );
      }
      return {
        ok: true,
        source: "Client registry (seeded from the Coordinators' SOP)",
        data: {
          count: clients.length,
          clients: clients.map((c) => ({
            name: c.name,
            shortName: c.shortName,
            requiredDocuments: c.requires,
            documentsNeedingDsc: c.dscOn,
            notes: c.notes,
          })),
        },
      };
    },
  },

  {
    name: "get_agent_status",
    description:
      "Health of the WhatsApp document agent: whether it's linked, how many documents have been filed, how many still need review, and whether an AI reader is configured. Use when asked why something isn't working, or for a system status check.",
    access: "read",
    parameters: { type: "object", properties: {} },
    async run() {
      try {
        const status = await agentJson<any>("/status");
        return {
          ok: true,
          source: "WhatsApp agent",
          data: {
            connection: status.status,
            linkedAccount: status.me?.name ?? null,
            aiReaderConfigured: status.hasAiKey,
            documentsFiled: status.stats?.filed ?? 0,
            needsReview: status.stats?.needsReview ?? 0,
            supplySets: status.stats?.totalSets ?? 0,
            completeSets: status.stats?.completeSets ?? 0,
            savingTo: status.inbox,
            lastError: status.lastError ?? null,
          },
        };
      } catch (err) {
        if (err instanceof AgentUnavailableError) return { ok: false, error: err.message };
        return { ok: false, error: (err as Error).message };
      }
    },
  },
  // ============ Business OS: work, insights, knowledge ============
  {
    name: "get_work_planner",
    description:
      "Today's work from the AI planner: counts of critical/urgent/follow-up tasks, overdue items, and the top open tasks with why they matter and the next action. Use for 'what should I do today', 'what is pending', 'kya urgent hai', 'which approvals are waiting'.",
    access: "read",
    parameters: { type: "object", properties: { limit: { type: "number", description: "How many tasks to return (default 10)" } } },
    async run(args) {
      try {
        const { loadWork, planner, decisions } = await import("@/lib/work");
        const w = loadWork();
        const p = planner(w.tasks);
        const limit = Math.min(25, Number(args?.limit) || 10);
        return {
          ok: true, source: "work-engine",
          data: {
            counts: p.counts,
            tasks: p.tasks.slice(0, limit).map((t) => ({ title: t.title, priority: t.priority, module: t.module, dueOn: t.dueOn, why: t.why, nextAction: t.nextAction, amount: t.amount })),
            decisions: decisions(w.tasks).slice(0, 8).map((d) => ({ title: d.task.title, risk: d.risk, recommendation: d.recommendation })),
          },
        };
      } catch (err) { return { ok: false, error: (err as Error).message }; }
    },
  },
  {
    name: "get_business_insights",
    description:
      "Computed business intelligence: health score by area, anomalies (duplicate expenses, abnormal weight loss, double trips), predictions (cash need next 15 days, late-receiving clients, risky vendors), expense changes by category, client/vendor performance scores, root-cause findings. Use for 'how is the business doing', 'any duplicates', 'which vendor is risky', 'cash requirement', 'most profitable / worst client', 'weight loss trend'.",
    access: "read",
    parameters: { type: "object", properties: { section: { type: "string", description: "One of: health, anomalies, predictions, expenses, performance, rootcause, all" } } },
    async run(args) {
      try {
        const intel = await import("@/lib/intelligence");
        const section = String(args?.section || "all");
        const pick: Record<string, () => any> = {
          health: () => intel.healthScore(),
          anomalies: () => intel.anomalies().slice(0, 15),
          predictions: () => intel.predictions(),
          expenses: () => intel.expenseControl(),
          performance: () => intel.performanceScores().slice(0, 15),
          rootcause: () => intel.rootCauses(),
        };
        if (pick[section]) return { ok: true, source: "intelligence", data: pick[section]() };
        const snap = intel.insightsSnapshot();
        return { ok: true, source: "intelligence", data: { health: snap.health, anomalies: snap.anomalies.slice(0, 8), predictions: snap.predictions, expenses: snap.expenses.slice(0, 6), performance: snap.performance.slice(0, 8), rootCauses: snap.rootCauses } };
      } catch (err) { return { ok: false, error: (err as Error).message }; }
    },
  },
  {
    name: "get_po_status",
    description:
      "Purchase order quantity intelligence: every vendor PO and client PO / work order with total, consumed (computed from linked supplies), remaining, utilisation %, status (active / low_balance / exhausted / expired), predicted exhaustion days (an estimate) and expiry. Use for 'which PO is finishing soon', 'how much is left in vendor X's PO', 'which POs are exhausted', 'POs expiring with unused quantity', 'less than 10% remaining'.",
    access: "read",
    parameters: { type: "object", properties: { party: { type: "string", description: "Vendor or client name/code to filter (optional)" }, type: { type: "string", description: "vendor or client (optional)" } } },
    async run(args) {
      try {
        const { computeAll } = await import("@/lib/po");
        const party = String(args?.party || "").toLowerCase(); const type = String(args?.type || "");
        const pos = computeAll().pos.filter((p) => (!party || p.partyName.toLowerCase().includes(party) || p.partyKey.toLowerCase() === party) && (!type || p.type === type));
        return { ok: true, source: "po-control", data: pos.map((p) => ({ type: p.type, party: p.partyName, poNumber: p.poNumber, totalMt: p.unit === "MT" ? p.totalQuantity : p.totalQuantity / 1000, consumedMt: Math.round(p.consumedKg / 100) / 10, remainingMt: Math.round(p.remainingKg / 100) / 10, utilisationPct: p.utilisationPct, status: p.effectiveStatus, predictedExhaustionDays: p.predictedExhaustionDays, predictionConfidence: p.predictionConfidence, expiryDate: p.expiryDate || null, daysToExpiry: p.daysToExpiry, alerts: p.alerts.map((a) => a.title) })) };
      } catch (err) { return { ok: false, error: (err as Error).message }; }
    },
  },
  {
    name: "get_business_memory",
    description:
      "Controlled long-term business memory: past decisions, repeated issue patterns, preferences and investigation notes the company chose to keep (reviewable in Settings → Business memory). Use before recommending on something that may have been decided before, or when asked 'what did we decide about…', 'has this happened before'.",
    access: "read",
    parameters: { type: "object", properties: { query: { type: "string", description: "Keyword to filter (optional)" }, role: { type: "string", description: "Requesting role (optional)" } } },
    async run(args) {
      const { recallFor } = await import("@/lib/enterprise2");
      return { ok: true, source: "business-memory", data: recallFor(String(args?.role || "admin"), args?.query ? String(args.query) : undefined).map((m) => ({ kind: m.kind, text: m.text, source: m.source, on: m.createdAt.slice(0, 10) })) };
    },
  },
  {
    name: "get_sop_guide",
    description:
      "Step-by-step company procedures (SOPs) and how-to answers for employees: vendor/transporter registration, imprest filing and approval, leave application, attendance marking, WhatsApp document filing and supply references, payroll & payslips, month-end closing, holiday notices, backups. Use for 'how do I…', 'what is the process for…', 'who approves…', 'where do I find…', 'kaise karu'.",
    access: "read",
    parameters: { type: "object", properties: { topic: { type: "string", description: "What the person wants to do, in their words" } } },
    async run(args) {
      const { sopGuide } = await import("@/lib/sopKnowledge");
      return { ok: true, source: "sop", data: sopGuide(String(args?.topic || "")) };
    },
  },
];

/** Look a tool up by name. */
export function getTool(name: string): ToolDefinition | undefined {
  return TOOLS.find((t) => t.name === name);
}

/** The schema the model sees. Descriptions are the interface — keep them precise. */
export function toolSchemas() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }));
}

/**
 * Run a tool by name.
 *
 * Write tools are refused unless the caller has explicitly allowed them,
 * so a misread instruction can never mutate data on its own.
 */
export async function runTool(name: string, args: any, ctx: ToolContext): Promise<ToolResult> {
  const tool = getTool(name);
  if (!tool) return { ok: false, error: `There is no tool called "${name}".` };
  if (tool.access === "write" && !ctx.allowWrites) {
    return { ok: false, error: `"${name}" changes data and needs explicit confirmation first.` };
  }
  try {
    return await tool.run(args ?? {}, ctx);
  } catch (err) {
    return { ok: false, error: `${name} failed: ${(err as Error).message}` };
  }
}
