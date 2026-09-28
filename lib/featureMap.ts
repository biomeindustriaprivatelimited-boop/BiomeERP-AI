/**
 * Biome AI OS — the feature map. ONE place that says what the app is.
 *
 * Category → feature → sub-feature. Everything reads from here:
 *   - the sidebar (categories only — no more wall of links)
 *   - the category hubs (/hub/<category>) with premium cards
 *   - the FeatureShell on every page (breadcrumb + sub-feature tabs)
 *   - the dashboard's "Open the OS" grid
 *
 * `perm` is the permission that opens it; developer-only work lives in
 * the Developer category, which nobody else sees. Icons are lucide
 * names resolved in components/hub/icons.tsx.
 */

export interface FeatureNode {
  id: string;
  label: string;
  href: string;
  icon: string;
  /** One line: what it does — shown on hub cards. */
  what: string;
  perm?: string;
  children?: FeatureNode[];
  /** Hash sections inside a single page (Settings). */
  sections?: { id: string; label: string }[];
  tone?: string;
}

export interface FeatureCategory {
  id: string;
  label: string;
  tagline: string;
  icon: string;
  tone: string; // tailwind gradient classes for the hub card
  features: FeatureNode[];
}

export const FEATURE_MAP: FeatureCategory[] = [
  {
    id: "documents", label: "Documents", tagline: "Every paper that arrives — read, filed, findable.", icon: "FileText", tone: "from-emerald-500/25 to-lime-400/10",
    features: [
      { id: "whatsapp", label: "WhatsApp Documents", href: "/whatsapp", icon: "MessageSquareText", perm: "whatsapp", what: "Supply documents from the sales group, read and filed into Month → Client → Date → Reference by themselves.", children: [
        { id: "review-queue", label: "Review Queue", href: "/review-queue", icon: "ListChecks", perm: "documents", what: "Documents the agent was not sure about — approve, correct (teaches it), or discard." },
        { id: "test-document", label: "Test a document", href: "/test-document", icon: "FlaskConical", perm: "documents", what: "Drop any file and see exactly what the agent reads and where it would file it. Nothing is saved." },
      ] },
      { id: "library", label: "Document Library", href: "/documents", icon: "FolderOpen", perm: "documents", what: "Everything the system has read — invoices, challans, slips — searchable by what is written inside.", children: [
        { id: "company-documents", label: "Company Documents", href: "/company-documents", icon: "Building2", perm: "company", what: "Biome's own certificates, licences and returns, with expiry." },
        { id: "vault", label: "Vault search", href: "/vault", icon: "FolderSearch", perm: "developer", what: "One search across KYC, contracts, evidence, forms and PO attachments." },
      ] },
      { id: "ocr", label: "OCR Scanner", href: "/ocr", icon: "ScanLine", perm: "ocr", what: "Read any image or PDF into text and fields, offline, and export it.", children: [
        { id: "sheets", label: "Smart Sheets", href: "/ocr/sheets", icon: "Table2", perm: "ocr", what: "A batch of same-shaped documents → one clean Excel with flagged cells." },
      ] },
    ],
  },
  {
    id: "supply", label: "Supply", tagline: "Trucks, weights, purchase orders — the physical business.", icon: "Truck", tone: "from-orange-500/25 to-amber-400/10",
    features: [
      { id: "coordination", label: "Coordination", href: "/coordination", icon: "Truck", perm: "coordination", what: "Every supply trip from dispatch to receiving, with weights, shortages and PO links." },
      { id: "mismatches", label: "Plant ↔ Coordination mismatches", href: "/mismatches", icon: "Flag", perm: "reco", what: "Vehicle / weight differences between plant dispatch and the coordination register; red flag after 3 days unfixed; notify the team by app, email or WhatsApp." },
      { id: "po", label: "PO Control", href: "/po", icon: "Package", perm: "operations", what: "Vendor and client purchase orders with balances computed live from linked supplies; exhaustion alerts and accounts email." },
      { id: "operations", label: "Operations Board", href: "/operations", icon: "Map", perm: "developer", what: "Every load in motion and what is late." },
    ],
  },
  {
    id: "plant", label: "Plant", tagline: "Everything that happens at the plant — biomass in, trucks out, spare parts and stores.", icon: "Factory", tone: "from-green-600/25 to-lime-400/10",
    features: [
      { id: "plants", label: "Biomass entry", href: "/plants", icon: "Factory", perm: "plant", what: "Biomass purchase sheet per plant — weights, deductions, amount, weighbridge slip checked against the entry." },
      { id: "transport", label: "Transport entry", href: "/transport", icon: "Truck", perm: "plant", what: "Every vehicle out of the plant — dispatch/receiving weight, freight, driver; matched against coordination." },
      { id: "stock", label: "Stock · spare parts & stores", href: "/stock", icon: "Package", perm: "stock", what: "Purchases with invoice/parchi upload, stock on hand, parts issued to each machine, re-order alerts — Tally-style stock." },
      { id: "plant-vendors", label: "Plant vendors & clients", href: "/partners", icon: "Handshake", perm: "partners", what: "Register manufacturing-side vendors (biomass, spare parts, services) and clients with KYC." },
    ],
  },
  {
    id: "partners", label: "Partners", tagline: "Who you buy from and who you supply.", icon: "Handshake", tone: "from-lime-500/25 to-emerald-400/10",
    features: [
      { id: "vendors", label: "Vendor & Client Registration", href: "/partners", icon: "Handshake", perm: "partners", what: "One register with KYC upload and Submit & freeze. Coordinators: trading. Plant managers: manufacturing (own plant). Accounts/admin/developer: all + unlock." },
      { id: "followups", label: "Follow-ups (email / WhatsApp)", href: "/followups", icon: "Inbox", perm: "partners", what: "Pending tax invoices, credit notes, supply documents, KYC papers, PO end/extend — ask the vendor or client by email or WhatsApp in one click." },
      { id: "clients", label: "Clients", href: "/clients", icon: "Users", perm: "customers", what: "The power plants you supply and the papers each one insists on." },
      { id: "contracts", label: "Contracts", href: "/contracts", icon: "FileSignature", perm: "developer", what: "Agreements, renewal dates, obligations and commitments." },
    ],
  },
  {
    id: "finance", label: "Finance", tagline: "Cash, Tally, GST — money in and out.", icon: "Wallet", tone: "from-teal-500/25 to-cyan-400/10",
    features: [
      { id: "imprest", label: "Imprest", href: "/imprest", icon: "Wallet", perm: "imprest.view", what: "Petty-cash floats: file from the phone, approve at the desk, budgets that warn." },
      { id: "ledgers", label: "Ledgers", href: "/ledgers", icon: "BookOpen", perm: "finance", what: "Live Tally ledgers and vouchers." },
      { id: "reconciliation", label: "Reconciliation", href: "/reconciliation", icon: "BarChart3", perm: "finance", what: "Two ledgers in, matched and mismatched out — even without invoice numbers." },
      { id: "payments", label: "Payments", href: "/payments", icon: "Wallet", perm: "finance", what: "Vendor dues, paid and pending." },
      { id: "gst", label: "GST Compliance", href: "/gst-compliance", icon: "ShieldCheck", perm: "finance", what: "GSTR-1/2A/2B vs books — which ITC is at risk." },
      { id: "billing-sop", label: "Billing SOP", href: "/billing-sop", icon: "BookOpen", perm: "finance", what: "How a supply must be papered for each client.", children: [
        { id: "delivery-challan", label: "Delivery Challan", href: "/delivery-challan", icon: "FileText", perm: "finance", what: "Print-ready challans in the company format." },
      ] },
    ],
  },
  {
    id: "people", label: "People", tagline: "Staff and labour — attendance to payslip.", icon: "Users", tone: "from-sky-500/25 to-blue-400/10",
    features: [
      { id: "employees", label: "Employees", href: "/employees", icon: "Users", perm: "employee.view", what: "The employee master with KYC files." },
      { id: "attendance", label: "Attendance", href: "/attendance", icon: "CalendarDays", perm: "attendance.entry", what: "Month grid with a mark picker; holiday and shutdown notices." },
      { id: "leave", label: "Leave", href: "/leave", icon: "CalendarDays", perm: "attendance.entry", what: "Apply, approve, and see it land on the attendance grid." },
      { id: "payroll", label: "Payroll & Salary", href: "/payroll", icon: "Wallet", perm: "payroll", what: "Runs, payslips (download or email), PF/ESIC." },
      { id: "organisation", label: "Organisation", href: "/organisation", icon: "Building2", perm: "payroll", what: "Departments, designations, locations." },
    ],
  },
  {
    id: "reports", label: "Reports", tagline: "What the numbers say, live from Tally and the app.", icon: "BarChart3", tone: "from-violet-500/25 to-fuchsia-400/10",
    features: [
      { id: "reports", label: "Tally Reports", href: "/reports", icon: "BarChart3", perm: "tally", what: "Canned live-from-Tally reports with Excel export." },
      { id: "analytics", label: "Analytics", href: "/analytics", icon: "Activity", perm: "tally", what: "Trends by month and by party for the current FY." },
      { id: "report-builder", label: "Report Builder", href: "/report-builder", icon: "BarChart3", perm: "reports", what: "Imprest, coordination, transport, biomass, stock, vendors… by category, person, place, plant or user — PDF and Excel." },
    ],
  },
  {
    id: "command", label: "Command Center", tagline: "What needs attention today — decided, not searched.", icon: "Radar", tone: "from-lime-400/25 to-yellow-300/10",
    features: [
      { id: "command", label: "Command Center", href: "/command", icon: "Radar", perm: "work", what: "Problem → context → impact → action, from every module; health index, briefing, risks." },
      { id: "decisions", label: "Decision Room", href: "/decisions", icon: "Gavel", perm: "developer", what: "Only what needs a human: approve, reject, send back." },
      { id: "work", label: "Work planner", href: "/work", icon: "Sparkles", perm: "developer", what: "Auto-detected tasks with why and next action; autopilot; automations." },
      { id: "insights", label: "Insights", href: "/insights", icon: "Activity", perm: "developer", what: "Health score, anomalies, predictions, cash flow, performance." },
      { id: "calendar", label: "Calendar", href: "/calendar", icon: "CalendarDays", perm: "developer", what: "Due dates, leave, holidays, month-end on one grid." },
    ],
  },
  {
    id: "admin", label: "Admin", tagline: "The company, its people's access, and the machine.", icon: "Settings", tone: "from-slate-500/25 to-zinc-400/10",
    features: [
      { id: "settings", label: "Settings", href: "/settings", icon: "Settings", perm: "settings", what: "Appearance, fonts, mail, backup, Drive, server & sync, PO policy, memory.", sections: [
        { id: "appearance", label: "Appearance & font" }, { id: "automation", label: "Automation" }, { id: "mail", label: "Mail" }, { id: "storage", label: "Save location" }, { id: "override", label: "Override" }, { id: "backup", label: "Backup" }, { id: "drive", label: "Google Drive" }, { id: "memory", label: "Business memory" }, { id: "server", label: "Server & Sync" },
      ] },
      { id: "users", label: "Users & Access", href: "/users", icon: "Users", perm: "users", what: "Accounts, roles, and what each permission opens." },
      { id: "company", label: "Company Profile", href: "/company", icon: "Building2", perm: "company", what: "Legal identity printed on every generated document." },
      { id: "audit", label: "Audit Log", href: "/audit", icon: "ShieldCheck", perm: "users", what: "Every action by every person, permanently." },
      { id: "cloud", label: "Cloud & Backup", href: "/cloud", icon: "Cloud", perm: "settings", what: "Company Drive space; backups." },
      { id: "support", label: "Help & Support", href: "/support", icon: "LifeBuoy", perm: "support", what: "Guides and tickets." },
    ],
  },
  {
    id: "developer", label: "Developer", tagline: "Super access. Labs. The console.", icon: "Wrench", tone: "from-violet-600/25 to-purple-400/10",
    features: [
      { id: "developer", label: "Developer Console", href: "/developer", icon: "Wrench", perm: "developer", what: "Access control, feature switches, server & sync, internals." },
      { id: "inbox", label: "Inbox · AI", href: "/inbox", icon: "Inbox", perm: "developer", what: "Company mailbox sorted by what it needs from you." },
      { id: "issues", label: "Labs: Issues · Camera", href: "/issues", icon: "Camera", perm: "developer", what: "Photo → category → actions → task." },
      { id: "meetings", label: "Labs: Meetings", href: "/meetings", icon: "Mic", perm: "developer", what: "Record or paste → decisions and action items → tasks." },
      { id: "forms", label: "Labs: Forms", href: "/forms", icon: "ClipboardList", perm: "developer", what: "No-code forms with photo, signature, location." },
      { id: "communications", label: "Labs: Communications", href: "/communications", icon: "MessageSquare", perm: "developer", what: "One timeline per party across channels." },
      { id: "twin", label: "Labs: Digital Twin", href: "/twin", icon: "Network", perm: "developer", what: "The business as a live relationship graph." },
      { id: "onboarding", label: "Labs: Onboarding", href: "/onboarding", icon: "GraduationCap", perm: "developer", what: "Role tracks: learn, practise, do." },
    ],
  },
];

/** Flat list of every node with its category and parent. */
export function flatFeatures() {
  const out: { node: FeatureNode; category: FeatureCategory; parent: FeatureNode | null }[] = [];
  for (const c of FEATURE_MAP) for (const f of c.features) { out.push({ node: f, category: c, parent: null }); for (const k of f.children || []) out.push({ node: k, category: c, parent: f }); }
  return out;
}

/** Which registry entry a pathname belongs to (longest href prefix wins). */
export function locate(pathname: string) {
  const all = flatFeatures().filter((x) => pathname === x.node.href || pathname.startsWith(x.node.href + "/") || (x.node.href !== "/" && pathname.startsWith(x.node.href + "?")));
  return all.sort((a, b) => b.node.href.length - a.node.href.length)[0] || null;
}
