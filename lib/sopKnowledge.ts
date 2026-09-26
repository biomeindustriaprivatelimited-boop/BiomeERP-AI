/**
 * Biome AI OS — SOP knowledge (server only)
 * -------------------------------------------------------------------
 * Sections 23/24/34 of the roadmap: the SOP assistant, the knowledge
 * base and the employee bot share one source of truth — this file.
 * Every entry is a real procedure as the app implements it, so "how do
 * I…" answers match what the buttons actually do. Extend by adding an
 * entry; the assistant picks the best match by keyword overlap.
 */

export interface SopEntry {
  id: string;
  title: string;
  keywords: string[];
  who: string;
  steps: string[];
  where: string;
  approver?: string;
  notes?: string;
}

export const SOP_ENTRIES: SopEntry[] = [
  {
    id: "vendor-registration", title: "Register a biomass vendor or transporter",
    keywords: ["vendor", "transporter", "registration", "register", "kyc", "partner", "supplier", "naya vendor", "panjikaran"],
    who: "Plant manager (raw-material vendors & transporters, own plant) · Coordinator (trading vendors) · Accounts/Admin (all)",
    where: "/partners",
    steps: [
      "Open Registration → Register a company. Choose kind (vendor / transporter) and, for vendors, the category — raw material (plant) or trading (coordinator).",
      "Fill code, legal name, GSTIN (15 chars, format-checked), PAN, contact person, phone, email, plants served, material, bank + IFSC.",
      "Attach every REQUIRED KYC document (GST certificate, PAN, cancelled cheque, agreement…). Missing ones show in red on the card.",
      "Save. A plant manager's record stays editable for 7 days, then freezes — corrections after that go through accounts/admin.",
      "Accounts/Admin sets status Active once papers are complete, then presses 'Send registration email' to send the letter with all details.",
    ],
    approver: "Accounts or Admin activates; the registration email is sent manually by the person finalising it.",
    notes: "Already-registered vendors are matched by code in WhatsApp filing — use the same code as the vendor master.",
  },
  {
    id: "imprest-file", title: "File an imprest expense / return cash",
    keywords: ["imprest", "expense", "petty cash", "float", "kharcha", "bill", "cash return", "advance"],
    who: "Any employee with an imprest float",
    where: "/imprest or /m/imprest on the phone",
    steps: [
      "Open Imprest (desktop) or scan the 'Open on phone' QR to use /m/imprest.",
      "Press + / File an entry → Expense or Cash return → amount, category, what it was for, date, paid-by, bill reference.",
      "File it. It appears instantly for accounts as 'Waiting'. Attach bills from the desktop app if needed.",
      "Accounts approves or rejects with a note; your in-hand balance updates on approval.",
    ],
    approver: "Accounts (or Admin). Budgets warn the approver when crossed; they never block.",
    notes: "Floats are opened only for people on the active employee rolls — ask accounts to open one if you don't have it.",
  },
  {
    id: "leave-apply", title: "Apply for leave",
    keywords: ["leave", "chutti", "holiday", "absent", "casual", "sick", "apply leave", "leave request"],
    who: "Any employee",
    where: "/leave",
    steps: [
      "Open Leave → Apply. Pick the type, from/to dates and reason; attach a certificate where the type asks for one.",
      "Submit. The request shows as pending on the attendance grid so nobody marks you absent over it.",
      "Your plant manager / accounts approves or rejects with a note; approved leave marks itself in attendance.",
    ],
    approver: "Plant manager, Accounts or Admin.",
  },
  {
    id: "attendance-mark", title: "Mark attendance",
    keywords: ["attendance", "hazri", "present", "absent", "mark", "half day", "overtime"],
    who: "Plant managers for their site; employees for themselves",
    where: "/attendance",
    steps: [
      "Open Attendance for the month. Click a day to cycle blank → P → A → H → L → HD, or double-click / right-click for the picker.",
      "Use row quick-fills (all present / all holiday) and enter overtime hours per row.",
      "Save. Days lock after the cut-off; accounts can still correct.",
      "For a plant holiday or shutdown, press 'Announce holiday / shutdown' to email the plant's staff — sent only when you press Send.",
    ],
  },
  {
    id: "whatsapp-filing", title: "How WhatsApp documents are filed (and how to fix one)",
    keywords: ["whatsapp", "document", "filing", "supply set", "reference", "bdc", "invoice", "challan", "eway", "weight slip", "consignment", "bilty", "bill t"],
    who: "Coordinator; Accounts for review",
    where: "/whatsapp and /review-queue",
    steps: [
      "Post supply documents in the tracked sales group. The agent reads each one (header rules → filename → learned samples), finds the reference BDC/<our no>/<vendor or plant>/<their no>, and files it into Month → Client → Date → Reference.",
      "Vendor papers are held until OUR invoice/challan arrives and claims the set; receivings match by vehicle + client (FIFO, 3-day window).",
      "Low-confidence or unmatched documents wait in the Review Queue — approve, correct (which teaches the agent), or discard.",
      "To teach the agent a new format: WhatsApp Documents → 'Train the agent with real documents' → upload + label the type.",
    ],
    notes: "Gangakhed weights carry a +400–500 kg allowance; Bill T is blank by design and is identified from our tax invoice.",
  },
  {
    id: "payroll-run", title: "Run payroll and send payslips",
    keywords: ["payroll", "salary", "payslip", "pf", "esic", "wages", "tankhwah"],
    who: "Accounts / Admin",
    where: "/payroll",
    steps: [
      "Open Payroll → the month → attendance is pulled in automatically.",
      "Review the salary sheet (basic, HRA, bonus, OT, PF/ESIC, advance recovery). Fix attendance first if a row looks wrong.",
      "Approve & lock the run.",
      "Open any payslip → Download PDF or 'Email payslip'; or 'Email payslips' for the whole run (sent once; a second press cannot duplicate).",
    ],
    approver: "Accounts approves; Admin can unlock.",
  },
  {
    id: "month-end", title: "Month-end closing",
    keywords: ["month end", "closing", "month-end", "mahine ka ant", "checklist"],
    who: "Accounts / Admin",
    where: "/work?tab=monthend",
    steps: [
      "From the 25th the Work page raises the month-end task; open Work → Month-end tab.",
      "Six items verify themselves as modules clear (attendance, leave, imprest, supply sets, receivings, KYC). Four are confirmed in-module: payroll lock, GST load & match, bank reconciliation, backup.",
      "Work through Decisions until none are waiting, then take a backup (Settings → Backup / Drive).",
    ],
  },
  {
    id: "approvals-who", title: "Who approves what",
    keywords: ["approve", "approval", "who approves", "permission", "authority", "kaun approve"],
    who: "Everyone",
    where: "/work?tab=decisions",
    steps: [
      "Imprest entries and budgets: Accounts (Admin can too).",
      "Leave: Plant manager, Accounts or Admin.",
      "Vendor/transporter activation: Accounts or Admin (Coordinator manages trading vendors' records).",
      "Payroll run: Accounts approves and locks; Admin unlocks.",
      "Server & Sync, feature switches, access grants: Developer only.",
      "All pending decisions are listed with risk and a recommendation under Work → Decisions.",
    ],
  },
  {
    id: "find-report", title: "Where to find a report or document",
    keywords: ["report", "find", "where", "kahan", "export", "excel", "download", "documents", "company documents"],
    who: "Everyone (by role)",
    where: "/reports, /documents, /company-documents",
    steps: [
      "Live Tally reports and Excel exports: Reports. Trends: Analytics. Business intelligence: Insights.",
      "Any invoice/challan/slip read by the system: Documents (search by what's written inside).",
      "Company certificates/licences: Company Documents. Filed supply sets: WhatsApp Documents.",
      "Batch-extract data from a pile of papers into Excel: AI OCR Scanner → Smart Sheets.",
    ],
  },
  {
    id: "backup", title: "Take a backup / Google Drive backup",
    keywords: ["backup", "drive", "google", "restore", "data safe"],
    who: "Admin (Settings permission)",
    where: "/settings",
    steps: [
      "Settings → Backup → Back up now (local zip). Restore needs Override switched on.",
      "Settings → Google Drive sync → one-time: paste the company's own OAuth Client ID/Secret, Connect, approve in the browser. Then 'Back up to Drive now'.",
    ],
  },
];

/** Best-matching entries for a question, by keyword overlap. */
export function sopGuide(topic: string) {
  const q = topic.toLowerCase();
  const scored = SOP_ENTRIES.map((e) => {
    const hits = e.keywords.filter((k) => q.includes(k)).length + (q.includes(e.title.toLowerCase().split(" ")[0]) ? 0.5 : 0);
    return { e, hits };
  }).sort((a, b) => b.hits - a.hits);
  const best = scored.filter((s) => s.hits > 0).slice(0, 2).map((s) => s.e);
  return {
    matched: best.length > 0,
    guides: (best.length ? best : SOP_ENTRIES.slice(0, 3)).map((e) => ({ title: e.title, who: e.who, where: e.where, steps: e.steps, approver: e.approver ?? null, notes: e.notes ?? null })),
    allTopics: SOP_ENTRIES.map((e) => e.title),
  };
}
