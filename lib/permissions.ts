/**
 * Biome Platform — roles and permissions
 * -------------------------------------------------------------------
 * Deliberately free of `fs`, `crypto` and anything Node-specific, because
 * the same table has to be readable in three places: the Edge middleware
 * that guards routes, the API handlers that guard data, and the client
 * components that decide what to draw. One table, three readers — if the
 * matrix lived in more than one file it would drift, and a drifted
 * permission matrix is a security hole that looks like a UI bug.
 */

/**
 * Roles, most powerful first.
 *
 * `developer` sits above admin and is not an ordinary role: it is the
 * account that decides what everyone else may do, and it does not appear
 * in the user list for anybody but itself.
 */
export type Role = "developer" | "admin" | "accounts" | "coordinator" | "plant_manager" | "procurement";

export const ROLES: { id: Role; label: string; description: string }[] = [
  { id: "developer", label: "Developer", description: "Everything, plus access control and feature switches" },
  { id: "admin", label: "Admin", description: "Day-to-day everything — access control sits with the developer" },
  { id: "accounts", label: "Accounts", description: "Finance, Tally, approvals — no app settings" },
  { id: "coordinator", label: "Coordinator", description: "All coordination, own imprest, WhatsApp documents — no plant sheets" },
  { id: "plant_manager", label: "Plant Manager", description: "Own plant: biomass, transport, plant imprest, spare-parts stock — no coordination" },
  { id: "procurement", label: "Procurement", description: "Plant stock & spare parts for every plant, spare-part vendors, stock reports" },
];

/**
 * Permission keys are module-level on purpose. Finer-grained keys sound
 * safer but end up half-applied; a small, honest list that is actually
 * enforced everywhere beats a long one that is enforced in places.
 */
export type Permission =
  | "finance" // finance dashboard, ledgers, payments, GST, reconciliation
  | "tally" // anything that reads the Tally company
  | "documents"
  | "whatsapp"
  | "ocr"
  | "assistant"
  | "operations" // view plants and transport
  | "operations.entry" // create/edit plant and transport entries
  // The plant's own books: biomass sheet, transport sheet, weight-slip
  // checks. Its own key so a coordinator (who holds "operations" for PO
  // Control) never reads a plant sheet, and a plant manager never needs
  // "operations" and so never reaches coordination or PO data.
  | "plant"
  // Supply coordination — its own key rather than riding on "operations".
  // A plant manager needs plant and transport entry but must NOT see the
  // coordination register, and the two were sharing one permission.
  | "coordination"
  // Plant ↔ coordination reconciliation: both sides' figures for every
  // mismatch, the 3-day red flags, and sending the teams a notice.
  // Accounts / admin / developer — never a plant manager or a coordinator.
  | "reco"
  | "vendors"
  | "customers"
  // Commercial registration — agreements, rates, bank details. Its own key
  // because a coordinator holds "vendors" and must NOT hold this: a signed
  // rate card is not something the person chasing weight slips reads.
  | "partners"
  | "imprest.entry"    // file my own imprest
  | "imprest.view"     // see my own float
  | "imprest.approve"  // accept or reject entries put in front of you
  | "imprest.viewAll"  // read every holder's full ledger — admin only
  | "imprest.viewPlant" // read every holder's ledger at MY plant — plant manager
  | "imprest.manage"   // add and edit imprest holders
  | "payroll"          // salary sheets, slips, PF/ESIC
  | "payroll.approve"  // lock a month and mark it paid
  | "employee.view"    // see the employee master
  | "employee.add"     // put a new person on the rolls
  | "employee.docs"    // upload supporting documents for a person
  | "employee.edit"    // change an existing record — admin only
  | "employee.freeze"  // freeze or remove a person — admin only
  | "attendance.entry"
  | "attendance.approve"
  | "reports"
  // Plant stock — spare parts, consumables, machines. `stock` receives,
  // issues to machines and reads balances (a plant manager: own plant
  // only). `stock.manage` also adjusts, cancels, edits the item and
  // machine masters and works across every plant.
  | "stock"
  | "stock.manage"
  | "support"         // raise a ticket; approvers also answer them
  | "work"            // the Work Engine: planner, autopilot, decisions
  | "command"         // the Command Center — management's whole-business view
  | "support.manage"  // see and answer everyone's tickets
  | "release.read"    // be told a new version exists
  | "release.publish" // announce one
  | "company"
  | "settings"
  | "users"
  // Developer-only. Deliberately separate from "users": an admin still
  // adds people and resets passwords, but deciding what a person may DO
  // is not something that should be one mis-click away.
  | "access.grant"    // change a role, or a person's individual permissions
  | "feature.switch"  // freeze or switch off a module
  | "announce"        // send a notice by email and in-app
  | "developer";      // the developer's own screens and hidden activity

const ALL: Permission[] = [
  "finance",
  "tally",
  "documents",
  "whatsapp",
  "ocr",
  "assistant",
  "operations",
  "operations.entry",
  "plant",
  "coordination",
  "reco",
  "vendors",
  "customers",
  "partners",
  "imprest.entry",
  "imprest.view",
  "imprest.approve",
  "imprest.viewAll",
  "imprest.viewPlant",
  "imprest.manage",
  "payroll",
  "payroll.approve",
  "employee.view",
  "employee.add",
  "employee.docs",
  "employee.edit",
  "employee.freeze",
  "attendance.entry",
  "attendance.approve",
  "reports",
  "stock",
  "stock.manage",
  "work",
  "command",
  "support",
  "support.manage",
  "release.read",
  "release.publish",
  "company",
  "settings",
  "users",
  "access.grant",
  "feature.switch",
  "announce",
  "developer",
];

/** Every permission key, for validating a stored per-user override. */
export const ALL_PERMISSIONS: Permission[] = ALL;

/**
 * Powers an admin no longer holds.
 *
 * The business asked for a few things to be taken out of the admin's
 * hands so a slip cannot break the app for everyone. Kept short on
 * purpose: an admin who cannot do their job will simply ask for the
 * developer account, and then none of this means anything.
 */
export const DEVELOPER_ONLY: Permission[] = ["access.grant", "feature.switch", "announce", "developer"];

export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  developer: ALL,
  // Everything except the four keys above.
  admin: ALL.filter((p) => !["access.grant", "feature.switch", "announce", "developer"].includes(p)),

  // Everything the business runs on, minus the two things that change how
  // the app itself behaves: app settings and user accounts.
  accounts: [
    "finance",
    "tally",
    "documents",
    "whatsapp",
    "ocr",
    "assistant",
    "operations",
    "plant",
    "coordination",
    "reco",
    "vendors",
    "customers",
    "partners",
    "imprest.entry",
    "imprest.view",
    "imprest.approve",
    "imprest.manage",
    "payroll",
    "payroll.approve",
    "employee.view",
    "employee.add",
    "employee.docs",
    "attendance.entry",
    "attendance.approve",
    "reports",
    // No plant stock: spare parts are the plant manager's and procurement's.
    // The developer can still grant it to one accounts person if needed.
    "support",
    "work",
    "command",
    // No "support.manage": only the admin and the developer escalate,
    // process or close Help & Support cases (owner's rule). Accounts raise
    // and follow up like everyone else; the developer can grant it per person.
    "release.read",
    "company",
  ],

  // Supply coordination on both the vendor and the client side. No money,
  // no Tally — a coordinator never needs a ledger to chase a weight slip.
  coordinator: [
    "imprest.entry",
    "imprest.view",
    "documents",
    "whatsapp",
    "ocr",
    "operations",
    "coordination",
    "vendors",
    "customers",
    // Trading vendors ONLY. The /api/partners route filters everything to
    // category === "trading" for this role, so holding the key does not
    // open the plant-side register — raw-material vendors and transporters
    // stay the plant manager's, exactly as the business asked.
    "partners",
    "reports",
    "attendance.entry",
    "support",
    "work",
    "command",
    "release.read",
  ],

  // Field role. No `tally` and no `whatsapp` — this is the access rule the
  // business asked for, and it is enforced here rather than by hiding a
  // link, so a hand-typed URL fails the same way a click would.
  plant_manager: [
    "documents",
    // Plant books only — biomass, transport, slip checks. No "operations",
    // so no PO Control and nothing from coordination.
    "plant",
    "operations.entry",
    "partners",
    "imprest.entry",
    "imprest.view",
    // Every imprest holder at the plant they are signed in for.
    "imprest.viewPlant",
    "attendance.entry",
    "employee.view",
    "employee.add",
    "employee.docs",
    // Receive spare parts, issue them to a machine, see own plant's stock.
    "stock",
    // Own plant's operational reports (plant sheets, stock, imprest).
    "reports",
    "support",
    "work",
    // No "command": the Command Center is management's view of the whole
    // business. The owner took it away from plant managers and
    // procurement (menu, page and API). The developer can still grant it
    // to one person from the access screen.
    "release.read",
  ],

  // Spare parts and stores for every plant. Registers the vendors it buys
  // from (manufacturing side), runs the stock, reads stock reports. No
  // money, no Tally, no coordination.
  procurement: [
    "stock",
    "stock.manage",
    "partners",
    "documents",
    "reports",
    "imprest.entry",
    "imprest.view",
    "attendance.entry",
    "support",
    "work",
    // No "command" — no Command Center for procurement (see plant_manager).
    "release.read",
  ],
};

export function permissionsFor(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] || [];
}

export function hasPermission(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return permissionsFor(role).includes(permission);
}

/**
 * Route → permission. Longest prefix wins, so `/api/tally/full` matches
 * the `/api/tally` entry without needing a line of its own.
 *
 * A route that is absent from this table is treated as "signed in is
 * enough". New sensitive routes MUST be added here; the default is
 * deliberately not "deny all" only because the login and health routes
 * have to stay reachable, and those are listed as public below.
 */
export const ROUTE_PERMISSIONS: { prefix: string; permission: Permission }[] = [
  // --- APIs ---
  { prefix: "/api/tally", permission: "tally" },
  { prefix: "/api/whatsapp/", permission: "whatsapp" },
  { prefix: "/api/whatsapp-settings", permission: "settings" },
  { prefix: "/api/dashboard", permission: "finance" },
  { prefix: "/api/ledger-agent", permission: "finance" },
  { prefix: "/api/reconcile-ai", permission: "finance" },
  { prefix: "/api/delivery-challan", permission: "finance" },
  { prefix: "/api/assistant", permission: "assistant" },
  { prefix: "/api/extract-document", permission: "ocr" },
  { prefix: "/api/test-document", permission: "ocr" },
  { prefix: "/api/vendors", permission: "vendors" },
  { prefix: "/api/clients", permission: "customers" },
  { prefix: "/api/company-documents", permission: "company" },
  { prefix: "/api/coordination", permission: "coordination" },
  { prefix: "/api/plant-data", permission: "plant" },
  { prefix: "/api/partners", permission: "partners" },
  { prefix: "/api/mismatches", permission: "reco" },
  { prefix: "/api/followups", permission: "partners" },
  { prefix: "/api/work", permission: "work" },
  { prefix: "/api/workflows", permission: "work" },
  { prefix: "/api/insights", permission: "developer" },
  { prefix: "/api/issues", permission: "developer" },
  { prefix: "/api/meetings", permission: "developer" },
  { prefix: "/api/forms", permission: "developer" },
  { prefix: "/api/timeline", permission: "developer" },
  { prefix: "/api/ops-map", permission: "developer" },
  { prefix: "/api/inbox", permission: "settings" },
  { prefix: "/api/po", permission: "operations" },
  { prefix: "/api/command", permission: "command" },
  { prefix: "/api/entity", permission: "work" },
  { prefix: "/api/contracts", permission: "developer" },
  { prefix: "/api/memory", permission: "settings" },
  { prefix: "/api/onboarding", permission: "developer" },
  { prefix: "/api/vault", permission: "developer" },
  { prefix: "/api/reports-builder", permission: "reports" },
  { prefix: "/api/twin", permission: "developer" },
  { prefix: "/api/backup", permission: "settings" },
  { prefix: "/api/plants-master", permission: "plant" },
  { prefix: "/api/stock", permission: "stock" },
  // Each side is checked inside the route (plant / coordination / full).
  { prefix: "/api/plant-match", permission: "support" },
  { prefix: "/api/plant-verify", permission: "plant" },
  { prefix: "/api/plant-upload", permission: "plant" },
  { prefix: "/api/plant-sheet", permission: "plant" },
  { prefix: "/api/users", permission: "users" },
  // Admin-only, same key as user management: the power to edit a frozen
  // record belongs with the power to change who can log in.
  { prefix: "/api/override", permission: "users" },
  { prefix: "/api/access", permission: "access.grant" },
  { prefix: "/api/features", permission: "feature.switch" },
  { prefix: "/api/announcements", permission: "announce" },
  { prefix: "/api/developer", permission: "developer" },
  { prefix: "/api/imprest/people", permission: "imprest.manage" },
  { prefix: "/api/imprest/decision", permission: "imprest.approve" },
  { prefix: "/api/support", permission: "support" },
  { prefix: "/api/release/files", permission: "release.read" },
  { prefix: "/api/release", permission: "release.read" },
  { prefix: "/api/imprest", permission: "imprest.view" },
  { prefix: "/api/payroll/employees", permission: "employee.view" },
  { prefix: "/api/payroll/documents", permission: "employee.view" },
  { prefix: "/api/payroll", permission: "payroll" },
  { prefix: "/api/cloud/status", permission: "support" },
  { prefix: "/api/cloud", permission: "settings" },
  { prefix: "/api/audit", permission: "users" },
  { prefix: "/api/letters", permission: "employee.view" },
  { prefix: "/api/attendance/chase", permission: "attendance.approve" },
  // Holiday / shutdown announcements are developer + admin only (the same
  // key /api/holidays already uses for add/edit/delete). Without this line
  // the longer /api/attendance prefix let anyone with attendance.entry —
  // a plant manager — mail a holiday notice to everyone.
  { prefix: "/api/attendance/holiday-email", permission: "users" },
  { prefix: "/api/attendance", permission: "attendance.entry" },
  { prefix: "/api/leave", permission: "attendance.entry" },
  { prefix: "/api/holidays", permission: "attendance.entry" },
  { prefix: "/api/mail", permission: "settings" },
  { prefix: "/api/ai-status", permission: "settings" },

  // --- Pages ---
  { prefix: "/reconciliation", permission: "finance" },
  { prefix: "/ledgers", permission: "finance" },
  { prefix: "/payments", permission: "finance" },
  { prefix: "/gst-compliance", permission: "finance" },
  { prefix: "/billing-sop", permission: "finance" },
  { prefix: "/delivery-challan", permission: "finance" },
  { prefix: "/whatsapp", permission: "whatsapp" },
  { prefix: "/documents", permission: "documents" },
  { prefix: "/review-queue", permission: "documents" },
  { prefix: "/ocr", permission: "ocr" },
  { prefix: "/assistant", permission: "assistant" },
  { prefix: "/plants", permission: "plant" },
  { prefix: "/transport", permission: "plant" },
  { prefix: "/coordination", permission: "coordination" },
  { prefix: "/developer", permission: "developer" },
  { prefix: "/partners", permission: "partners" },
  { prefix: "/mismatches", permission: "reco" },
  { prefix: "/followups", permission: "partners" },
  { prefix: "/work", permission: "developer" },
  { prefix: "/insights", permission: "developer" },
  { prefix: "/calendar", permission: "developer" },
  { prefix: "/issues", permission: "developer" },
  { prefix: "/meetings", permission: "developer" },
  { prefix: "/forms", permission: "developer" },
  { prefix: "/communications", permission: "developer" },
  { prefix: "/operations", permission: "developer" },
  { prefix: "/inbox", permission: "settings" },
  { prefix: "/po", permission: "operations" },
  { prefix: "/stock", permission: "stock" },
  { prefix: "/command", permission: "command" },
  { prefix: "/decisions", permission: "developer" },
  { prefix: "/entity", permission: "work" },
  { prefix: "/contracts", permission: "developer" },
  { prefix: "/onboarding", permission: "developer" },
  { prefix: "/vault", permission: "developer" },
  { prefix: "/report-builder", permission: "reports" },
  { prefix: "/twin", permission: "developer" },
  { prefix: "/vendors", permission: "vendors" },
  { prefix: "/customers", permission: "customers" },
  // Live-from-Tally screens: useless (every call 403s) without `tally`.
  { prefix: "/analytics", permission: "tally" },
  { prefix: "/reports", permission: "tally" },
  { prefix: "/company-documents", permission: "company" },
  { prefix: "/company", permission: "company" },
  { prefix: "/imprest", permission: "imprest.view" },
  // The phone version of the same module — same key, same rules.
  { prefix: "/m/imprest", permission: "imprest.view" },
  { prefix: "/support", permission: "support" },
  { prefix: "/payroll", permission: "payroll" },
  { prefix: "/attendance", permission: "attendance.entry" },
  { prefix: "/leave", permission: "attendance.entry" },
  { prefix: "/employees", permission: "employee.view" },
  { prefix: "/cloud", permission: "settings" },
  { prefix: "/audit", permission: "users" },
  { prefix: "/organisation", permission: "payroll" },
  { prefix: "/clients", permission: "customers" },
  { prefix: "/settings", permission: "settings" },
  { prefix: "/users", permission: "users" },
];

/** Reachable without a session. Everything else needs one. */
export const PUBLIC_PREFIXES = [
  "/login",
  "/api/auth/login",
  "/api/auth/me",
  "/api/auth/logout",
  // Developer password recovery — answers only on the server PC itself.
  "/api/auth/recover",
  // MPIN sign-in on a device that already knows the person (lib/mpin.ts).
  "/api/auth/mpin",
  // The server heartbeat. It MUST answer before anyone signs in — the
  // login screen itself sits behind the ServerGuard, and a 401 here was
  // read as "server down", blocking the whole app on its own doorstep.
  "/api/health",
  // Plant names for the login picker — names only, nothing private.
  "/api/plants",
  // Google's OAuth redirect lands in a plain browser tab with no app
  // session; the code inside is worthless without the Client Secret.
  "/api/gdrive/callback",
  "/_next",
  "/assets",
  // Director photos on the Business Profile page. next/image's optimiser
  // fetches /team/*.webp from inside the server WITHOUT the user's
  // cookie, so a sign-in redirect here hands it the login page's HTML
  // and the photo comes back as a 400 broken image.
  "/team/",
  "/favicon",
  // The phone app. The browser fetches these BEFORE anyone signs in — a
  // redirect to /login here means the manifest is HTML, the service
  // worker never registers, and "Install" never appears.
  "/manifest.json",
  "/sw.js",
  "/icons/",
  "/offline",
  // pdf.js runtime: the OCR page loads these by URL.
  "/pdf.worker.min.mjs",
  "/pdfjs/",
  // Browser OCR engine and its Hindi/English language data.
  "/tesseract/",
  "/tessdata/",
];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

/** The permission a path needs, or null if being signed in is enough. */
export function permissionForPath(pathname: string): Permission | null {
  let best: { prefix: string; permission: Permission } | null = null;
  for (const entry of ROUTE_PERMISSIONS) {
    if (pathname === entry.prefix || pathname.startsWith(entry.prefix)) {
      if (!best || entry.prefix.length > best.prefix.length) best = entry;
    }
  }
  return best ? best.permission : null;
}

/**
 * Page guard.
 *
 * `perms` is the list carried in the session token — a per-user grant or
 * revoke the developer has made. When it is absent (an older token, or a
 * caller that has only a role) the role's own list is used, so nothing
 * breaks while sessions turn over.
 */
export function canAccessPath(
  role: Role | null | undefined,
  pathname: string,
  perms?: string[] | null
): boolean {
  if (isPublicPath(pathname)) return true;
  if (!role) return false;
  const needed = permissionForPath(pathname);
  if (!needed) return true;
  if (perms && perms.length) return perms.includes(needed);
  return hasPermission(role, needed);
}

/** Plant codes. Kept here so login, entries and filters agree on spelling. */
export const PLANTS: { code: string; label: string }[] = [
  { code: "REW", label: "Mayan" },
  { code: "GKD", label: "Gangakhed" },
];

/**
 * Where "/" should land for each role.
 *
 * The dashboard at "/" is the Finance Command Center: it reads Tally and
 * is meaningless to a role that cannot. Sending a plant manager there
 * would show a screen of failed requests, so each role gets a home it can
 * actually use.
 */
export function landingPathFor(role: Role | null | undefined): string {
  switch (role) {
    case "plant_manager":
      // The plant dashboard: shortcut tiles to everything the plant
      // manager may use, plus the plant's own counts. Needs no permission
      // of its own (only sign-in) and draws only tiles the person can open.
      return "/plant-home";
    case "coordinator":
      return "/documents";
    case "procurement":
      return "/stock";
    default:
      return "/";
  }
}

/**
 * Where a "Home" link should point for this person. "/" is the finance
 * dashboard; without `finance` it would only bounce through a redirect.
 */
export function homePathFor(role: Role | null | undefined, perms: string[]): string {
  return perms.includes("finance") ? "/" : landingPathFor(role);
}


/**
 * What each permission opens and why a person would need it — shown in
 * Users & Access so activating a feature is a considered decision, not a guess.
 */
export const PERMISSION_INFO: Record<string, { label: string; what: string; why: string; risk: "low" | "medium" | "high" }> = {
  "imprest.entry": { label: "Imprest — file entries", what: "File expenses, cash returns and see own float.", why: "Anyone who spends company cash in the field.", risk: "low" },
  "imprest.view": { label: "Imprest — view & approve", what: "See every holder's float, approve/reject entries, set budgets.", why: "Accounts and managers who control petty cash.", risk: "medium" },
  documents: { label: "Documents", what: "Browse, search and upload company documents; open the Review Queue.", why: "Office roles that handle paperwork.", risk: "low" },
  whatsapp: { label: "WhatsApp Documents", what: "See the WhatsApp agent, filed supply sets, connection and training.", why: "Coordinators and accounts who work from supply documents.", risk: "medium" },
  ocr: { label: "AI OCR Scanner", what: "Scan documents to text/Excel; Smart Sheets batch extraction.", why: "Anyone digitising paper.", risk: "low" },
  finance: { label: "Finance", what: "Ledgers, reconciliation, payments, GST, billing SOP, delivery challans, PO override.", why: "Accounts only — it exposes money and Tally.", risk: "high" },
  operations: { label: "Operations (PO Control)", what: "Vendor and client purchase orders and their balances.", why: "Coordinators and accounts.", risk: "medium" },
  reco: { label: "Plant ↔ coordination mismatches", what: "Both sides' figures for every vehicle/weight mismatch, the 3-day red flags, and notices to the teams.", why: "Accounts, admin, developer.", risk: "medium" },
  plant: { label: "Plant sheets", what: "Biomass sheet, transport sheet and weight-slip checks — own plant only for a plant manager.", why: "Plant managers; accounts to verify.", risk: "medium" },
  "imprest.viewPlant": { label: "Imprest — my plant", what: "Read every imprest holder's entries at the plant the person is signed in for.", why: "Plant managers.", risk: "medium" },
  coordination: { label: "Coordination", what: "Create and track supply trips, weights, receivings.", why: "Coordinators.", risk: "medium" },
  vendors: { label: "Vendors", what: "Vendor master, codes, balances.", why: "Coordinators and accounts.", risk: "medium" },
  customers: { label: "Clients", what: "Client master and document requirements.", why: "Coordinators and accounts.", risk: "medium" },
  partners: { label: "Registration", what: "Register vendors/transporters with KYC (plant managers: own site, raw material; coordinators: trading).", why: "Whoever onboards suppliers.", risk: "medium" },
  "employee.view": { label: "Employees", what: "Employee master and KYC files.", why: "HR/accounts and plant managers.", risk: "high" },
  "attendance.entry": { label: "Attendance & Leave", what: "Mark attendance and apply/decide leave. (Holiday announcements are admin/developer only.)", why: "Plant managers and accounts.", risk: "medium" },
  payroll: { label: "Payroll", what: "Salary runs, payslips, PF/ESIC, organisation lists.", why: "Accounts only.", risk: "high" },
  reports: { label: "Reports & Report Builder", what: "Module reports (imprest, coordination, transport, biomass, stock, vendors…) as PDF and Excel — only over data the person can already see.", why: "Management, accounts, and each team for its own data.", risk: "medium" },
  stock: { label: "Plant stock", what: "See spare-part stock, receive parts (GRN), issue parts to machines. Plant managers: own plant.", why: "Plant managers, stores, procurement.", risk: "medium" },
  "stock.manage": { label: "Plant stock — manage", what: "Item & machine masters, adjustments, cancellations, transfers, all plants.", why: "Procurement / stores in-charge.", risk: "medium" },
  company: { label: "Company", what: "Company profile and company documents.", why: "Admin/accounts.", risk: "medium" },
  settings: { label: "Settings", what: "Appearance, mail, backup, Drive, PO policy, SLA, memory.", why: "Admin. Changes affect everyone.", risk: "high" },
  users: { label: "Users & Audit", what: "Create users, set roles, read the audit log.", why: "Admin only.", risk: "high" },
  support: { label: "Help & Support", what: "Guides and support tickets.", why: "Everyone.", risk: "low" },
  work: { label: "Work", what: "Forms, issues, meetings, calendar, entity search, PO alerts.", why: "Everyone who runs day-to-day work.", risk: "medium" },
  command: { label: "Command Center", what: "Whole-business view: health index, briefing, risks, decisions.", why: "Management and coordinators — not plant managers or procurement.", risk: "medium" },
  "release.read": { label: "Release notes", what: "See what changed in each update.", why: "Everyone.", risk: "low" },
  announce: { label: "Announcements", what: "Post announcements to staff.", why: "Developer/admin.", risk: "medium" },
  "access.grant": { label: "Access control", what: "Activate or deactivate features for each person.", why: "Developer only.", risk: "high" },
  "feature.switch": { label: "Feature switches", what: "Freeze or switch off a module.", why: "Developer only.", risk: "high" },
  developer: { label: "Developer", what: "Developer screen, Server & Sync, developer-preview features, override edits.", why: "The developer only.", risk: "high" },
  // Friendly names for the remaining keys, so the access editor never
  // shows a bare key like "operations.entry" to the person deciding.
  tally: { label: "Tally (live data)", what: "Read the Tally company — Tally reports, analytics, live ledgers.", why: "Accounts only.", risk: "high" },
  assistant: { label: "AI Assistant", what: "The BIOME AI business assistant.", why: "Office roles.", risk: "medium" },
  "operations.entry": { label: "Plant & transport entry", what: "Create and edit plant and transport entries.", why: "Plant managers.", risk: "medium" },
  "imprest.approve": { label: "Imprest — approve", what: "Accept or reject imprest entries put in front of you.", why: "Accounts and managers.", risk: "medium" },
  "imprest.viewAll": { label: "Imprest — every holder", what: "Read every imprest holder's full ledger.", why: "Admin.", risk: "high" },
  "imprest.manage": { label: "Imprest — manage holders", what: "Add and edit imprest holders and their floats.", why: "Accounts.", risk: "medium" },
  "payroll.approve": { label: "Payroll — lock & pay", what: "Lock a salary month and mark it paid.", why: "Accounts head.", risk: "high" },
  "employee.add": { label: "Employees — add", what: "Put a new person on the rolls.", why: "HR/accounts and plant managers.", risk: "medium" },
  "employee.docs": { label: "Employees — documents", what: "Upload supporting documents for a person.", why: "HR/accounts and plant managers.", risk: "medium" },
  "employee.edit": { label: "Employees — edit", what: "Change an existing employee record.", why: "Admin.", risk: "high" },
  "employee.freeze": { label: "Employees — freeze/remove", what: "Freeze or remove a person from the rolls.", why: "Admin.", risk: "high" },
  "attendance.approve": { label: "Attendance — approve", what: "Approve attendance, correct older days, chase missing marks.", why: "Accounts.", risk: "medium" },
  "support.manage": { label: "Support — answer tickets", what: "See and answer everyone's support tickets.", why: "Admin and developer only — they escalate, process and close cases.", risk: "low" },
  "release.publish": { label: "Release notes — publish", what: "Announce a new version to everyone.", why: "Admin.", risk: "medium" },
};
