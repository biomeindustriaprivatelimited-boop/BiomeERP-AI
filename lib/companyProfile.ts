/**
 * Company Profile — the business guide every employee can read.
 *
 * Default content lives HERE, in code, written from facts already in the
 * app (lib/assistantKnowledge.ts, lib/sopKnowledge.ts, the Billing SOP,
 * the company page). Admin / developer can edit any section or add new
 * ones in the app; their edits are stored in the data root
 * (company/profile.json) and win over the defaults by section id. A
 * section deleted in the app is remembered as hidden, so a later release
 * does not bring it back; "Restore default" removes the override.
 *
 * Numbers that are not known to the app (turnover, capacity…) are not
 * invented here — the text stays general where the facts are not on file.
 */
import fs from "fs";
import path from "path";
import { paths, readJson, writeJsonAtomic, ensureDir } from "@/lib/dataRoot";
import { SOP_ENTRIES } from "@/lib/sopKnowledge";

export interface ProfileCategory { id: string; label: string; icon: string }

export const PROFILE_CATEGORIES: ProfileCategory[] = [
  { id: "about", label: "About the company", icon: "Building2" },
  { id: "products", label: "Products & raw material", icon: "Package" },
  { id: "plants", label: "Plants", icon: "Factory" },
  { id: "clients", label: "Clients & co-firing", icon: "Zap" },
  { id: "supply", label: "Supply chain", icon: "Truck" },
  { id: "documents", label: "Documents per supply", icon: "FileText" },
  { id: "quality", label: "Quality", icon: "FlaskConical" },
  { id: "roles", label: "Departments & roles", icon: "Users" },
  { id: "compliance", label: "Compliance", icon: "ShieldCheck" },
  { id: "glossary", label: "Glossary", icon: "BookOpen" },
  { id: "howto", label: "How-to (app)", icon: "GraduationCap" },
];

export interface ProfileSection {
  id: string;
  category: string;
  title: string;
  /**
   * Plain text with a tiny markup: a line starting "- " is a bullet,
   * "### " a sub-heading, a blank line separates paragraphs.
   */
  body: string;
  order: number;
  /** Added in the app (not a default). */
  custom?: boolean;
  /** A default the admin removed. */
  hidden?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  /** Set on the merged view: an admin edit of a default section. */
  edited?: boolean;
}

export interface Director {
  id: string;
  name: string;
  role: string;
  linkedin: string;
  /** Bundled photo under public/team (shipped with the app). */
  bundledPhoto: string;
  /** Uploaded photo file name under <data root>/company/team. */
  photoFile?: string;
  photoUpdatedAt?: string;
}

export const DEFAULT_DIRECTORS: Director[] = [
  { id: "tanesh-singh-dod", name: "Tanesh Singh Dod", role: "Executive Director", linkedin: "https://www.linkedin.com/in/tanesh-singh-dod-6a1174167/", bundledPhoto: "/team/tanesh-singh-dod.webp" },
  { id: "shubham-goel", name: "Shubham Goel", role: "Executive Director", linkedin: "https://www.linkedin.com/in/shubham-goel-a39141136/", bundledPhoto: "/team/shubham-goel.webp" },
];

/* ------------------------------------------------------------------ */
/* Default sections                                                    */
/* ------------------------------------------------------------------ */

const S = (category: string, id: string, title: string, body: string, order: number): ProfileSection => ({
  id, category, title, body: body.trim(), order,
});

const howTo: ProfileSection[] = SOP_ENTRIES.map((e, i) =>
  S("howto", `howto-${e.id}`, e.title, [
    `Who: ${e.who}`,
    `Where in the app: ${e.where === "/partners" ? "Supply → Vendor registration / Client registration" : e.where}`,
    "",
    ...e.steps.map((st) => `- ${st}`),
    ...(e.approver ? ["", `Approval: ${e.approver}`] : []),
    ...(e.notes ? ["", `Note: ${e.notes}`] : []),
  ].join("\n"), 100 + i)
);

export const DEFAULT_SECTIONS: ProfileSection[] = [
  // ---------------- About ----------------
  S("about", "about-company", "Who we are", `
Biome Industria Private Limited is an impact-focused biomass energy company. It turns agricultural waste — crop residue that would otherwise be burnt in the fields — into solid biofuel (pellets and briquettes) that industries and coal-based power plants burn in place of, or together with, coal.

The company promotes economically feasible green fuels across Indian industry. Today the business is densified biomass; over time it aims to grow into CBG, Ethanol, Bio-MDF, Bio-Char and Bio-Bitumen.

### Registered identity
- Company: Biome Industria Private Limited
- GSTIN: 06AAJCB1927H1ZS (Haryana) · PAN: AAJCB1927H
- Website: biomeindustria.com · Email: biomeindustria@gmail.com
- Tagline: "Think Biomass, Think Biome."
`, 1),
  S("about", "about-purpose", "Our purpose", `
- Decarbonising energy — a replacement for fossil fuels, reducing deforestation and mining-related damage.
- Waste repurposing — agricultural residue that would otherwise be burnt (a leading cause of air pollution in North India) becomes renewable energy.
- Empowering farmers — employment and skill development; farmers get a paying outlet for stubble instead of burning it.
- Fuelling India — domestic biomass fuel reduces dependence on imported energy (Make in India).
`, 2),
  S("about", "about-vision", "2030 vision", `
- Utilise 1 million tonnes of biomass annually.
- Diversify from solid biofuels into liquid and gaseous biofuels (CBG, Ethanol) and other biomass products.
- Upskill the rural workforce — support village-level entrepreneurs who repurpose agro-waste themselves.
- Contribute to India's Net Zero goal by offsetting 1 million tonnes of CO2.
`, 3),
  S("about", "about-business-model", "How the business works", `
The company earns in two ways:

- Manufacturing — biomass is bought from farmers and vendors, processed into pellets / briquettes at our own plants, and sold to clients.
- Trading — pellets are bought from other manufacturers (trading vendors) and supplied directly to our clients under our purchase orders; the material may go straight from the vendor to the client.

The app keeps the two apart: the coordinator runs the trading register, each plant manager runs their own plant's manufacturing register.
`, 4),

  // ---------------- Products ----------------
  S("products", "products-range", "What we sell", `
Solid biofuels made from agricultural waste — a carbon-neutral alternative to coal or wood — in two forms:

- Pellets — 6 mm to 25 mm diameter (the form power plants co-fire).
- Briquettes — 70 mm to 90 mm diameter (larger blocks, typically for boilers).

Heat output (GCV) ranges roughly 2800–4000 kcal/kg depending on the feedstock and what the client's boiler needs. Exact specifications follow each client's purchase order.
`, 1),
  S("products", "products-raw", "Raw material (feedstock)", `
Agricultural residues bought from farmers, aggregators and vendors, including (not limited to):

- Paddy straw (parali)
- Mustard husk
- Soyabean husk
- Chana (gram) husk
- Groundnut shells
- Bagasse

Raw material arrives at the plant by truck, is weighed on the weighbridge and entered in the plant's biomass purchase sheet (Plant → Biomass entry), with deductions for moisture or dirt where agreed with the vendor.
`, 2),

  // ---------------- Plants ----------------
  S("plants", "plants-units", "Manufacturing units", `
### Unit 1 — Rewari / Mayan (Haryana)
Rewari Road, Khaleta, Mayan Village, Rewari District, Haryana — 123103.
Dispatch location used on documents for several North-India clients (for example APCPL and NTPC Mouda).

### Unit 2 — Gangakhed (Maharashtra)
Plot A-15, Gangakhed MIDC, Gangakhed, Parbhani District, Maharashtra — 431415.
Dispatch location for NTPC Solapur — always "Biome Gangakhed Plant", for manufacturing and trading sales alike.
`, 1),
  S("plants", "plants-work", "What happens at a plant", `
- Biomass in: trucks of raw material are weighed and entered in the biomass purchase sheet.
- Processing: the biomass is dried, ground and pressed into pellets / briquettes.
- Trucks out: every dispatch is weighed and entered in the transport sheet (dispatch weight, freight, driver), which is matched with the coordination register.
- Stores: spare parts and consumables are received against an invoice / parchi, issued to machines, and re-ordered when low.
- People: attendance, leave, imprest (petty cash) and employee records are kept per plant.

Each plant manager sees only their own site's data in the app.
`, 2),

  // ---------------- Clients ----------------
  S("clients", "clients-list", "Our clients", `
Mainly coal-based thermal power plants that co-fire biomass pellets:

- APCPL — Aravali Power Company Private Limited (Jharli / Jhajjar, Haryana)
- HTPS
- NTPC Mouda
- NTPC Tanda
- NTPC Solapur
- NTPC Vindhyanchal
- NTPC Dadri
- Jhajjar Power Limited (JPL)
- Nabha Power Limited (NPL)

Each client issues purchase orders (PO) with the quantity, rate, quality specification and validity. Every supply is billed against a PO, and each client insists on its own set of documents — see Client registration in the app for the current list per client.
`, 1),
  S("clients", "clients-cofiring", "What is co-firing?", `
Co-firing means burning biomass pellets together with coal in a power plant's boiler. A part of the coal is replaced by biomass, so the plant produces the same electricity with less fossil fuel and lower emissions — and the farm residue that is used would otherwise have been burnt in the open.

A Government of India policy asks coal-based thermal power plants to co-fire a share of biomass. That is why NTPC stations and other power companies buy pellets through tenders and purchase orders, and why quality (GCV, moisture, ash) and paperwork are checked closely on every truck.
`, 2),
  S("clients", "clients-papers", "Client-specific rules (from the Billing SOP)", `
- JPL — Tax Invoice, E-Way Bill and E-Invoice. If the vendor's E-Way Bill dispatches from Haryana use the same; otherwise use Rewari Plant, Haryana as dispatch location.
- NPL — Delivery Challan and E-Way Bill; vendor name and dispatch location must match the vendor's E-Way Bill; DSC on the Delivery Challan.
- NTPC Tanda / Vindhyanchal — Delivery Challan, E-Way Bill and Consignment Tag; DSC on the Delivery Challan.
- NTPC Solapur — Delivery Challan, E-Way Bill, Consignment Tag; dispatch location always "Biome Gangakhed Plant".
- NTPC Mouda — Delivery Challan, E-Way Bill, Weight Slip and Fast Tag documentation; dispatch location "Biome Rewari Plant"; driver mobile and licence number on the challan.
- APCPL — Delivery Challan, E-Way Bill, Consignment Tag; dispatch location "Rewari Plant"; DSC on all dispatch documents.

The full procedure for each client is in Finance → Billing SOP.
`, 3),

  // ---------------- Supply chain ----------------
  S("supply", "supply-flow", "From vendor to invoice", `
### 1. Vendor procurement
Raw material or finished pellets are bought from registered vendors (Vendor registration — GST, PAN, bank, KYC). Vendor POs fix rate and quantity.

### 2. Plant
Manufacturing: biomass is received, weighed and processed at Rewari / Mayan or Gangakhed. Trading: the vendor loads the material and it may go directly to the client.

### 3. Dispatch
A truck is loaded against a client PO. Our Delivery Challan / Tax Invoice and E-Way Bill are generated (mostly through Tally), with vehicle number and weight taken from the plant weight slip or the vendor's documents.

### 4. Weighment
The truck is weighed at dispatch (gross / tare / net) and again by the client on arrival. Differences between the two weights are tracked as shortage.

### 5. Client acceptance
The client unloads, weighs and samples the material; its lab reports GCV, moisture and ash. The client's receiving / weighment slip confirms the accepted quantity.

### 6. Invoice and payment
The supply is billed against the PO with the full document set. Deductions (quality, shortage, penalties as per PO terms) are reconciled when payment arrives.

The coordinator tracks every trip in Supply → Coordination; supply documents arrive on WhatsApp and are filed automatically into Month → Client → Date → Reference folders.
`, 1),
  S("supply", "supply-reference", "The supply reference", `
Every supply set is identified by a reference of the form BDC/<our no>/<vendor or plant>/<their no>. The WhatsApp agent reads it from the documents and files all papers of one truck together. Vendor papers are held until OUR invoice / challan arrives and claims the set; client receivings are matched by vehicle and client.
`, 2),

  // ---------------- Documents ----------------
  S("documents", "documents-per-supply", "Key documents with every supply", `
- Tax invoice — our GST invoice to the client (or the vendor's invoice to us). Carries GSTIN, HSN, quantity, rate and tax.
- Delivery challan — document that moves the goods when the client bills on a challan basis; many NTPC clients require it with a DSC.
- E-way bill — GST portal document required to move goods by road; dispatch location must follow the client's rule.
- E-invoice — the IRN-stamped invoice from the GST e-invoice system, where the client asks for it (e.g. JPL).
- Weighment slip / weight slip — weighbridge record of gross, tare and net weight, at dispatch and at the client's gate.
- LR / bilty — the transporter's lorry receipt for the consignment.
- Consignment tag — client-specific tag with vehicle number, challan number and weight (NTPC Tanda, Solapur, Vindhyanchal, APCPL).
- Lab / GCV report — the client's (or third-party) test result for GCV, moisture and ash of the delivered material.
- COA — certificate of analysis from the supplier stating the quality of the lot.
- Fast Tag documentation — vehicle movement record required by NTPC Mouda.

Which of these each client needs (and which need a DSC) is set per client in Client registration → Document requirements.
`, 1),
  S("documents", "documents-dsc", "Digital Signature Certificate (DSC)", `
Several clients accept a document only if it carries the company's Digital Signature Certificate. Attach the DSC before sharing the document in the sales group — a document without it is treated as not received.
`, 2),

  // ---------------- Quality ----------------
  S("quality", "quality-params", "Quality parameters", `
- GCV (Gross Calorific Value) — heat released by burning 1 kg of fuel, in kcal/kg. The most important number; our products range roughly 2800–4000 kcal/kg.
- Moisture — water content (%). Wet material has lower usable heat and can be rejected.
- Ash — the non-burning residue (%). High ash means less energy and more boiler wear.
- Fines — broken pieces / dust in a pellet lot; some clients measure and penalise it.

The limits for each parameter are written in the client's purchase order. When a lot falls outside them, the client may deduct from the price or apply penalties / LD (liquidated damages) as per PO terms, so lab reports are filed with every supply.
`, 1),

  // ---------------- Roles ----------------
  S("roles", "roles-departments", "Departments", `
- Management — the directors; approve policy, pricing and large decisions.
- Accounts — GST, TDS, Tally bookkeeping, payments, reconciliations, payroll, PF / ESI, imprest approval, vendor / client activation.
- Coordination (trading) — runs supply trips, chases documents and weights, keeps the trading vendor and client register.
- Plants — plant managers at Rewari / Mayan and Gangakhed: biomass entry, dispatch, stock, attendance and the plant's own vendors / clients.
- Procurement — spare parts and stores for every plant.
`, 1),
  S("roles", "roles-app", "Roles in this app", `
- Developer — full access; server, feature switches and access grants.
- Admin — everything except developer-only switches; can edit this Company Profile.
- Accounts — finance, Tally, payroll, approvals, registrations (all), client document requirements.
- Coordinator — coordination, WhatsApp documents, trading vendor / client registration; client document requirements are view-only.
- Plant manager — own plant's books, stock, staff and manufacturing registrations.
- Procurement — stock and spare-part vendors.

What each person can open is decided by permissions (Admin → Users & Access), so a new role works the same way.
`, 2),

  // ---------------- Compliance ----------------
  S("compliance", "compliance-gst", "GST", `
- Every sale is invoiced with GST; goods move on an E-Way Bill, and an E-Invoice (IRN) is generated where required.
- Input tax credit on purchases is matched with GSTR-2A / 2B before claiming; sales are reported in GSTR-1 and tax paid through GSTR-3B.
- The app's GST Compliance module compares the returns with the books to show which ITC is at risk.
`, 1),
  S("compliance", "compliance-tds", "TDS", `
Tax is deducted at source on payments such as contractor, freight and professional charges as the Income-tax rules require, deposited on time and reported in quarterly returns. Clients may also deduct TDS from our invoices — this shows up as a difference when payments are reconciled.
`, 2),
  S("compliance", "compliance-epf", "EPF and ESI", `
- EPF (Provident Fund) — employer and employee contributions are deducted through payroll and deposited monthly with the ECR.
- ESI — employee state insurance contributions for eligible employees, deducted through payroll.
- Payroll in the app calculates both from the attendance-linked salary sheet.
`, 3),
  S("compliance", "compliance-kyc", "Vendor and client KYC", `
No vendor is paid and no client is supplied on an unverified registration: GST certificate, PAN, cancelled cheque (vendors) and agreements are kept on file in the registration, expiry dates are tracked, and only accounts / admin mark a registration Active.
`, 4),

  // ---------------- Glossary ----------------
  S("glossary", "glossary-terms", "Terms you will hear", `
- PO — purchase order: the client's (or our) order with quantity, rate, quality and validity.
- BDC — prefix of our supply reference number (BDC/<our no>/<vendor or plant>/<their no>).
- GCV — gross calorific value, kcal/kg.
- MT — metric tonne (1,000 kg), the unit of quantity.
- Gross / Tare / Net — truck weight loaded / empty / material only.
- Shortage — difference between our dispatch weight and the client's received weight.
- LD — liquidated damages: penalty in the PO for late or short supply.
- LR / Bilty — the transporter's lorry receipt.
- E-Way Bill — GST document for moving goods by road.
- IRN — invoice reference number of an e-invoice.
- DSC — digital signature certificate.
- COA — certificate of analysis.
- ITC — input tax credit under GST.
- TDS — tax deducted at source.
- EPF / ESI — provident fund / employee state insurance.
- Imprest — petty-cash float given to an employee, settled with bills.
- Co-firing — burning biomass together with coal in a power-plant boiler.
- Parali — paddy straw (stubble).
- Trading — supplying pellets bought from another manufacturer; Manufacturing — supplying from our own plants.
- Bill T. number — a number taken from the vendor's documents for JPL billing (see Billing SOP).
- Fast Tag — electronic toll / vehicle movement record used by NTPC Mouda.
`, 1),

  // ---------------- How-to ----------------
  S("howto", "howto-client-registration", "Register a client and set its document requirements", `
Who: Coordinator (trading clients) · Plant manager (own plant's clients) · Accounts / Admin (all)
Where in the app: Supply → Client registration

- Press "Register a client". Fill Basic (name, code, short name, aliases), Tax & Bank (GSTIN, PAN) and Contacts.
- Attach KYC papers (GST certificate, PAN, PO / agreement) and press Register.
- Accounts / Admin / Developer: open "Edit requirement documents" and tick every document the client wants with a supply (and DSC where needed). Coordinators can view this list but not change it.
- Check everything, then Submit & freeze. Accounts / Admin mark it Active.
`, 99),
  ...howTo,
];

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface ProfileFile {
  sections: ProfileSection[];
  directors?: Partial<Director>[];
  updatedAt?: string;
}

export function companyDir(): string {
  return path.join(paths.root, "company");
}
function file(): string {
  return path.join(companyDir(), "profile.json");
}
export function teamPhotoDir(): string {
  return path.join(companyDir(), "team");
}

function loadFile(): ProfileFile {
  const f = readJson<ProfileFile>(file(), { sections: [] });
  return { ...f, sections: Array.isArray(f.sections) ? f.sections : [], directors: Array.isArray(f.directors) ? f.directors : [] };
}
function saveFile(f: ProfileFile) {
  ensureDir(companyDir());
  writeJsonAtomic(file(), { ...f, updatedAt: new Date().toISOString() });
}

/** Defaults overlaid with the stored edits; hidden ones dropped. */
export function loadSections(): ProfileSection[] {
  const stored = loadFile().sections;
  const byId = new Map(stored.map((s) => [s.id, s]));
  const out: ProfileSection[] = [];
  for (const d of DEFAULT_SECTIONS) {
    const o = byId.get(d.id);
    if (o?.hidden) continue;
    out.push(o ? { ...d, ...o, custom: false, edited: true } : d);
  }
  for (const s of stored) {
    if (!DEFAULT_SECTIONS.some((d) => d.id === s.id) && !s.hidden) out.push({ ...s, custom: true });
  }
  return out.sort((a, b) => a.order - b.order);
}

export function hiddenDefaults(): { id: string; title: string; category: string }[] {
  const stored = loadFile().sections;
  return DEFAULT_SECTIONS.filter((d) => stored.some((s) => s.id === d.id && s.hidden)).map((d) => ({ id: d.id, title: d.title, category: d.category }));
}

function clean(s: any): string {
  return String(s ?? "").replace(/\r\n/g, "\n");
}

export function upsertSection(input: any, by: string): ProfileSection {
  const f = loadFile();
  const category = PROFILE_CATEGORIES.some((c) => c.id === input?.category) ? input.category : "about";
  const title = clean(input?.title).trim().slice(0, 160);
  const body = clean(input?.body).slice(0, 20000);
  if (!title) throw new Error("Give the section a title.");
  const id = String(input?.id || "").trim() || `custom-${Date.now().toString(36)}`;
  const def = DEFAULT_SECTIONS.find((d) => d.id === id);
  const prev = f.sections.find((s) => s.id === id);
  const next: ProfileSection = {
    id, category, title, body,
    order: Number.isFinite(Number(input?.order)) ? Number(input.order) : prev?.order ?? def?.order ?? 500,
    updatedAt: new Date().toISOString(), updatedBy: by,
  };
  f.sections = [...f.sections.filter((s) => s.id !== id), next];
  saveFile(f);
  return next;
}

/** Delete a custom section; hide a default one. */
export function removeSection(id: string, by: string): void {
  const f = loadFile();
  const isDefault = DEFAULT_SECTIONS.some((d) => d.id === id);
  f.sections = f.sections.filter((s) => s.id !== id);
  if (isDefault) {
    const d = DEFAULT_SECTIONS.find((x) => x.id === id)!;
    f.sections.push({ ...d, hidden: true, updatedAt: new Date().toISOString(), updatedBy: by });
  }
  saveFile(f);
}

/** Drop any stored edit of a default section (back to the shipped text). */
export function restoreDefault(id: string): void {
  const f = loadFile();
  f.sections = f.sections.filter((s) => s.id !== id);
  saveFile(f);
}

/* ---------------- Directors ---------------- */

function bundledVersion(rel: string): string {
  try {
    const st = fs.statSync(path.join(process.cwd(), "public", rel.replace(/^\//, "")));
    return `${Math.round(st.mtimeMs)}-${st.size}`;
  } catch {
    return "20261004";
  }
}

export function loadDirectors(): (Director & { photoUrl: string; photoSource: "uploaded" | "bundled" })[] {
  const stored = loadFile().directors || [];
  return DEFAULT_DIRECTORS.map((d) => {
    const o = stored.find((x) => x.id === d.id) || {};
    const merged: Director = { ...d, ...o, id: d.id, bundledPhoto: d.bundledPhoto };
    const uploaded = merged.photoFile && fs.existsSync(path.join(teamPhotoDir(), merged.photoFile));
    return {
      ...merged,
      photoSource: uploaded ? "uploaded" : "bundled",
      // The version in the URL changes whenever the photo does, so neither
      // the browser, Electron nor any image cache can show the old one.
      photoUrl: uploaded
        ? `/api/company/photo?id=${encodeURIComponent(d.id)}&v=${encodeURIComponent(merged.photoUpdatedAt || "1")}`
        : `${d.bundledPhoto}?v=${bundledVersion(d.bundledPhoto)}`,
    };
  });
}

export function updateDirector(id: string, patch: Partial<Director>): void {
  if (!DEFAULT_DIRECTORS.some((d) => d.id === id)) throw new Error("Unknown director.");
  const f = loadFile();
  const list = f.directors || [];
  const prev = list.find((x) => x.id === id) || { id };
  const next = { ...prev, ...patch, id };
  f.directors = [...list.filter((x) => x.id !== id), next];
  saveFile(f);
}

export function directorPhotoPath(id: string): { file: string; mime: string } | null {
  const d = (loadFile().directors || []).find((x) => x.id === id);
  if (!d?.photoFile) return null;
  const full = path.join(teamPhotoDir(), path.basename(d.photoFile));
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).toLowerCase();
  const mime = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
  return { file: full, mime };
}
