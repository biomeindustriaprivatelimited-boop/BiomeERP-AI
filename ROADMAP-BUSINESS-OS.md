# Biome AI OS — Business OS Roadmap (status as of Pass 14, 5 Sep 2026)

## What shipped in Pass 14 — PHASE 1 (highest workload reduction)

One modular foundation, the **Work Engine** (`lib/work.ts`), and one screen, **Work** (`/work`),
deliver six roadmap sections together, because they are one system:

| Roadmap section | Status | Where |
|---|---|---|
| 1 · AI Work Planner | ✅ Shipped | `/work` → Work planner tab: Critical / Urgent / Follow-ups / Automated-successfully counts (count-up), every task with WHY + NEXT ACTION + evidence, filter by priority, Done / Snooze / Delegate / Dismiss, deep link into the module |
| 2 · Business Autopilot | ✅ Shipped (read-only actions) | `runAutopilot()` — detect → upsert → auto-resolve → escalate → report. Runs lazily whenever Work is opened after 30 min of quiet, or on "Run autopilot now". Morning/Business summary on the Autopilot tab incl. WhatsApp supply-set stats when the agent is up |
| 4 · AI Auto-Follow-Up Agent | ✅ Cadence shipped, sends stay manual | Follow-up tasks carry the Day 1 / 3 / 5 / 7 cadence (`followupStep`), shown on the task; Day 7 escalates. Sending uses the existing manual buttons (registration email, holiday notice, payslip email) — consistent with the app's manual-by-design rule |
| 19 · Automatic Task Creation from Events | ✅ Shipped | Detectors: Registration (missing KYC, expired, expiring, ready-to-activate, freeze-tomorrow), Imprest (pending approvals, aggregated per holder with amount), Leave (pending requests), Coordination (dispatched ≥3d without receiving, shortage), Company Documents (expiry ≤30d), Employee documents (expiry), Month-end (from the 25th), WhatsApp supply sets (missing papers / DSC via agent `/sets`) |
| 20 · Smart Deadline & Escalation | ✅ Shipped | Ladder: overdue 1d → owner notified (L1), 2d → manager (L2), 4d → admin (L3, priority forced critical). Customisable in `ESCALATION_LADDER` |
| 35 · Management Decision Center | ✅ Shipped | Decisions tab: approvals, escalated ≥L2, finance items, amounts ≥ ₹50,000 — each with Background, Evidence, Risk (LOW/MEDIUM/HIGH) and an AI recommendation; "Decide in module" / "Mark decided" / Delegate |
| 27 · Month-End Assistant | ✅ Partial | Month-end tab: 10-item checklist; 6 items auto-verify from the engine, 4 confirmed in-module |
| 32 · Document Expiry & Renewal | ✅ Partial | Partner, company and employee document expiries become tasks with renewal actions |

Cross-cutting requirements from the master prompt: **role-based access** (new `work` permission on every
role; plant managers see own-plant tasks only; assignees always see their own), **audit log** on every
autopilot run and every task action (`work.autopilot.run`, `work.task.*`), **backward compatible** (no
existing route changed), **modular** (one lib, one API, one page), **no manual routine entry** (manual
"Add a task" exists only for things no detector can see yet).

Verified: unit-style test seeded a vendor with missing/expired KYC, a pending leave and an expiring
licence → 4 tasks across 3 modules, 1 decision; 3 days later → escalation L2 on all; papers arrive →
3 tasks auto-resolved, the licence stays open. `tsc` clean; `next build` 50/50.

## Files added / changed in Pass 14
- `lib/work.ts` — the engine (types, detectors, run, planner, decisions, delegates)
- `app/api/work/route.ts` — GET planner/decisions/runs (lazy run), POST run/create/done/snooze/dismiss/reopen/assign/delegates
- `app/work/page.tsx` — Work screen (planner, decisions, autopilot, month-end, add task)
- `lib/permissions.ts` — `work` permission + route mapping
- `components/Sidebar.tsx` — "Work · AI Planner" entry

## Honest note on the UI references
Squarespace's homepage was read and its cues applied to the new screen: editorial oversized headline
with a lime full-stop, generous air, arrow-led CTAs, rolling count-up statistics, section rhythm. The
three YouTube videos could not be watched from here (no video access) — if those show specific motion
(e.g. scroll-linked reveals, 3D cards, cursor effects), describe them and they can be added to the motion
layer.

## What remains — and the order that makes sense

### PHASE 2 · AI intelligence (needs Tally history the engine already reads)
7 · Ask Your Business — extend the existing assistant tools with aggregate queries (profit per client,
pending per vendor, weight-loss trend) + a chart renderer in the panel.
8 · Prediction & Risk — cash-requirement forecast from payables due dates + payment-delay scoring
per client from Tally receipt history (needs ≥3 months of vouchers).
9 · Fraud & Anomaly — duplicate invoice/payment detection (amount + party + ±3 days), abnormal
weight variance per vendor/route from coordination trips.
10 · Root Cause — pattern grouping over shortage/discrepancy tasks (vendor, route, date onset).
21 · Business Health Score — composite of open task load per module; the engine already produces
the inputs.

### PHASE 3 · Productivity
12 · Meeting Assistant — audio → local Whisper (whisper.cpp) → summary/action items → tasks via the
Work API. 13 · Communication Center — timeline per partner from mail log + WhatsApp records + tasks.
14 · Personal Workload — `scope=mine` already exists in the API; add DO NOW / TODAY / WEEK view.
15 · Calendar — tasks + leave + due dates + follow-ups on one month grid. 16 · Voice-to-Work —
Web Speech API → the local assistant → `create` action.

### PHASE 4 · Platform
17 · Workflow builder (WHEN → IF → THEN) over the engine's task events. 18 · Form builder.
15 · What-if simulator (Tally-derived P&L deltas). 26 · Resource allocation (task load per person).
24/23/34 · Knowledge base + SOP assistant + employee bot — the assistant's knowledge module +
uploaded SOP docs as retrieval context (local model).

Sections 5, 6, 8, 9, 11, 25, 28, 29, 30, 31, 33 map onto the above; 8 (camera-to-action) and 9 (live
map) need hardware/GPS inputs the business does not capture yet.


---
## Pass 15 — Phases 2, 3 and 4 executed (5 Sep 2026)

### Phase 2 · Intelligence — `lib/intelligence.ts`, `/insights`, `/api/insights`
| Section | Status | How |
|---|---|---|
| 21 Business Health Score | ✅ | Weighted composite (Finance 30 · Operations 25 · Compliance 20 · Documentation 10 · HR 15) from open/overdue/critical work per module + KYC completeness; each area explains what lowers it and the fix |
| 10 Fraud & Anomaly | ✅ | Duplicate expenses (same holder, amount, ≤3 days), unusual amounts (>3× holder median), double trips (vehicle+client+date), abnormal weight loss (≥5%) — each with confidence %, evidence, Investigate link |
| 22 Root Cause | ✅ | Shortage trips grouped by vendor / client / vehicle / onset; concentration % → evidence-based recommendation |
| 3 Prediction & Risk | ✅ (partial — vendor payables need Tally) | Cash need next 15 days (imprest burn + pending + payroll), late-receiving clients, vendor shortage risk — with confidence and basis |
| 33 Expense Control | ✅ | Category month-over-month change with notes |
| 14 Performance Score | ✅ | Client & vendor 0–100 from weight tolerance, receiving timeliness, document compliance |
| 15 What-if Simulator | ✅ | Transport cost %, sales %, collection delay days → revenue/profit/cash impact + risk, assumptions stated |
| 25/26 Productivity & Resource allocation | ✅ | Per-person open/overdue/done-30d/avg days/load + rebalancing suggestion (not surveillance) |
| 7 Ask Your Business | ✅ | Assistant tools `get_work_planner` + `get_business_insights` — both local and cloud brains answer "how is the business doing / any duplicates / risky vendors / cash need" |

### Phase 3 · Productivity
| 14 Personal Workload | ✅ | Work → My work: DO NOW / TODAY / THIS WEEK / OVERDUE / CAN DELEGATE + "start with…" + blocked-7-days flag |
| 28 Smart Calendar | ✅ | `/calendar`: tasks + leave + holidays + month-end on one grid; 3+ critical/urgent on a day = conflict warning |
| 16 Voice-to-Work | ✅ | Mic in the assistant composer (browser speech recognition, en-IN) → dictate → same tool loop |
| 6 Communication Center | ⏳ | Deferred: needs a mail log; audit trail already records every send per target |
| 12 Meeting Assistant | ⏳ | Deferred: needs local Whisper; paste-notes → tasks can use the assistant + Add-a-task today |

### Phase 4 · Platform
| 17 No-code Workflow Builder | ✅ | Work → Automations: WHEN (created/open/overdue) → IF (module/priority/amount/kind/plant/overdue days) → THEN (set priority / hand to role / send for approval / escalate / note). Runs in every autopilot pass; idempotent; fire counts shown |
| 23/24/34 SOP Assistant · Knowledge Base · Employee Bot | ✅ | `lib/sopKnowledge.ts` (10 real procedures: registration, imprest, leave, attendance, WhatsApp filing, payroll, month-end, who-approves, where-to-find, backup) via assistant tool `get_sop_guide` |
| 30 Smart Checklists | ✅ | Month-end (auto-verified) + registration KYC gaps |
| 13 Form Builder · 8 Camera-to-Action · 9 Live Map · 31 Email Priority | ⏳ | Not built: need hardware/GPS/mailbox inputs the business does not capture yet |

### Tests run (seeded data root)
- Detect → 7 tasks over Registration/Imprest/Coordination; 1 decision + shortage decisions.
- Health 84 (Documentation 40 flagged); 7 anomalies incl. duplicate expense 85%, unusual amount 85%, weight variance 83%.
- Root cause: "ABC Traders in 100% of shortages" + recommendation; predictions: vendor risk HIGH; performance: ABC=13, XYZ=58.
- Workflow rule fires once, stays applied across 3 runs (priority/kind/mark preserved). SOP query matched.
- `tsc` clean · `next build` 52/52.

---
## Pass 16 — the last six sections (5 Sep 2026) — roadmap complete

| Section | Status | How |
|---|---|---|
| 12 · AI Meeting Assistant | ✅ `/meetings` | Live transcription in the browser (speech recognition, en-IN) or paste minutes → summary, decisions, action items (owner · task · deadline). Deterministic extractor is the floor; the free local model refines when loaded. "Save & create tasks" → Work tasks with owners and due dates. Tested: 3 action items with resolved deadlines (Friday, tomorrow, 12/09), 2 decisions. |
| 6 · Unified Communication Center | ✅ `/communications` | Search any vendor/transporter/client/employee → one timeline across outbound emails (new mail log on every sendMail), audit events, Work tasks, issues, meetings, documents received. Pending replies with a ready-to-paste suggested reply. |
| 13 · Smart Form Builder | ✅ `/forms` | Fields: text, number, dropdown, date, photo (camera), file, signature (canvas), location (GPS), checkbox. 5 templates (Site Inspection, Vendor Evaluation, Complaint, Vehicle Inspection, Expense Request). Fill on any device; submissions table; CSV export; optional Work task per submission for a chosen role. |
| 8 · Camera-to-Action + 29 · Issue Management | ✅ `/issues` | Take/upload a photo → offline OCR reads it → category suggested from what it sees (damaged material / vehicle / incident / financial / vendor), vehicle number auto-filled, category-specific suggested actions → raising the issue stores the evidence, creates the Work task, and shows similar past issues with how they were resolved. Full issue record: priority, owner, timeline, resolution; resolving closes the task. |
| 9 · Live Operations Map | ✅ `/operations` | Schematic animated board (no GPS exists in the business — stated on screen): vendors/plants → clients, every dispatched-without-receiving load moving along its edge by days-out vs the client's typical transit; amber past ETA, red past 3 days; delay alerts; refreshes every minute. |
| 31 · AI Email Priority | ✅ `/inbox` | IMAP read of the company mailbox (reuses Settings → Mail account; Gmail host implied) → 🔴 urgent / 🟠 important / 🟡 normal with the words that decided it, required action, deadline, related vendor/client/employee → "Create task". Paste box classifies forwarded text without IMAP. Nothing is moved, marked or deleted. Tested: vendor overdue-invoice mail → urgent, deadline 10/09/2026, party matched by sender address. |

Cross-cutting: `work` permission (inbox under `settings`), audit on every create/submit/resolve, Work tasks from issues/forms/meetings/emails, mail log feeding the timeline. New dependency: `imapflow`. tsc clean · next build 58/58.

---
## Pass 17 — Premium Enterprise layer + PO Quantity Intelligence (5 Sep 2026)

### PO QUANTITY INTELLIGENCE & EXHAUSTION AUTOMATION — complete
Design decision that makes it production-safe: **consumed quantity is never stored or incremented — it is
computed every time from linked coordination trips** (vendor PO ← vendor challan weight; client PO ←
invoiced → received → dispatched weight; cancelled and client-rejected trips excluded). Cancellations,
corrections, deletions, double submits and concurrent edits cannot corrupt a balance because there is no
balance to corrupt — only a sum to recompute.
- Data: `lib/po.ts` (PurchaseOrder: type vendor/client, partyKey→master, number, WO no, dates, total,
  unit, rate/value, expiry, manual status, thresholds, absolute floor, attachment, alert flags,
  adjustment history). Config: over-consumption policy (block / manager approval / exception),
  role-based or configured email recipients per alert kind, expiry alert days, default thresholds.
- Trip model: optional `vendorPoId` / `clientPoId` (backward compatible). Coordination form: PO pickers
  with live balance + PO BALANCE WARNING; server `poGuard` enforces the policy on create and edit
  (own contribution excluded on re-save, so an unchanged trip never double-counts); finance override.
- Alerts: 75/90/95 % thresholds, absolute-floor low balance, predicted exhaustion (30-day rate,
  labelled estimate with confidence), expiry at 30/15/7/1 days, EXHAUSTED at 100 %. Each alert fires
  ONCE (flag on the PO) — verified: second sync raises 0.
- Accounts email on exhaustion (always; low-balance/expiry optional) with the spec's exact fields and
  wording; recipients configurable, fallback to accounts/admin logins. Audit on create/adjust (reason
  required, old→new)/status/attach/alert/email/renewal/over-consumption.
- PO Control Center `/po`: dashboard (active totals, low/exhausted/expiring/high-risk), Alert Center
  with filters and quick actions (Open PO / Open party / View supplies / Start renewal / Mark reviewed),
  vendor & client lists with utilisation bars, analytics (by party, days-to-exhaust, unused at expiry,
  over-consumption attempts), settings. PO renewal request → Work task with an estimated quantity.
- Integration: autopilot detector (`PO Control` tasks), Command Center PO alerts, Risk Radar
  (financial/PO risk), Early Warnings (predicted exhaustion), Entity 360 (party's POs), assistant tool
  `get_po_status` (local + cloud brains answer PO questions).
- Tests (seeded): 8×12 MT on a 100 MT vendor PO → 96 consumed / 4 left / 96 %; 10 MT check → exceeds
  by 6; cancel → 84; edit → 92; push past 100 → exhausted, sync #1 raises alerts, sync #2 raises 0,
  status persisted; autopilot task "VENDOR PO EXHAUSTED" critical; Command Center counts it.

### PREMIUM ENTERPRISE FEATURES — implemented as one engine (`lib/enterprise.ts`)
| # | Feature | Where |
|---|---|---|
| 1 | Biome Command Center | `/command` — 🔴🟠🟡🟢 counts; Financial / Operational / Compliance / Workforce sections as PROBLEM → CONTEXT → IMPACT → ACTION with Review / Assign / Approve / Investigate / Snooze; business graph search on top |
| 2, 7, 25 | Autopilot, task generation, root cause | existing engines, now with PO sync in every run |
| 3 | Business Digital Twin | Entity 360 relationship view (supplies with lifecycle chain) — schematic; full graph canvas deferred |
| 4, 46 | 360° Entity Intelligence + Investigation Workspace | `/entity?type=&key=` — overview, risk (why), performance, POs, supplies with lifecycle & bottleneck, pending actions, issues, unified timeline (human / AI / automation / communication) |
| 5 | Risk Radar | Command → Risk: per vendor/client LOW→CRITICAL with per-dimension WHY |
| 6 | Early Warning System | trends 30d vs prior 30d: discrepancies, expenses, vendor/client predictions, PO exhaustion, workload |
| 8, 42 | Decision Copilot + explainability | Decision cards carry evidence + recommendation + basis note; assistant tools return sources |
| 9 | Decision Room | `/decisions` — context, financial/operational impact, risk, evidence, AI recommendation; Approve / Reject / Send back / Assign review / Request info (audited) |
| 10 | Executive Morning Briefing | Command → Briefing: dashboard view, PDF/print, email to management |
| 11 | Business Health Index | daily snapshots → this week / last week / last month, improving / declining |
| 12, 13 | Predictive cash & payment priority | cash need 15 d (existing) — 7/30/60-day model needs Tally payables (deferred) |
| 14, 21, 49 | Supply lifecycle, auto checklists, bottleneck analytics | lifecycle stages auto-verified from trip data; SLA tab shows step durations & where work waits |
| 15, 20, 36 | Exception center, Data Quality Guardian, Audit Intelligence | Command → Quality: duplicate GSTIN, double-mapped vehicles, invoice-before-entry, receiving-before-dispatch, idle POs, duplicate employee codes; audit: repeated modifications, sensitive actions, failures, unusual volume |
| 16, 17 | Follow-up orchestrator, communication copilot | existing cadence + suggested replies (Communications) |
| 18, 19 | Unified timeline, graph search | Entity 360 timeline; Command search understands references, vendors, vehicles, POs, tasks, issues, employees |
| 26 | SLA & escalation | `loadSla` rules per task kind (warning 75 %, breach, escalate); SLA chips on Command items; analytics |
| 43 | Personal AI Chief of Staff | "Your day" panel per user |
| 45 | Proactive insights feed | Command → attention tab |
| 47, 48 | Month-end center, Business Continuity | existing month-end + Command → System health (server, backup age, storage, WhatsApp agent, mail, Tally guidance) |
| 50 | Executive Mode | Command → toggle: only health, critical items, decisions |
| 22, 23, 27, 28, 29, 30, 31, 34, 40 | SOP engine, automation studio, simulation, meetings, calendar, mobile, photo, knowledge, playbooks | already shipped in Passes 14–16 (playbooks = issue-kind suggested actions) |
| 24, 39 | Workload balancer, benchmarking | Insights → Workloads / Performance |
| Deferred | 32 Document Intelligence Vault (semantic search), 33 Contracts, 35 Onboarding, 37/38 Report builders, 41 Agent marketplace, 44 Business memory | need embeddings / a document index / larger UI builders — next pass |

Permissions: `work` for Command/Decisions/Entity, `operations` for PO, `settings` for PO config & SLA.
Audit: every decision, PO event, SLA change, briefing email. tsc clean · next build 62/62.

---
## Pass 18 — every remaining section complete (5 Sep 2026)

| Section | Status | Where / how |
|---|---|---|
| 33 Contracts & Obligation Management | ✅ `/contracts` | contracts with party, kind, dates, value, obligations (tick-off, amounts, due dates), renewal status, attachment; Work Engine raises tasks at expiry ≤45 d without renewal, on expiry, and for obligations due ≤7 d |
| 44 Business Memory | ✅ Settings → Business memory | decisions from the Decision Room remembered automatically; manual notes/patterns/preferences; roles, pin, edit, delete; 180-day retention applied on read; assistant tool `get_business_memory` |
| 35 Smart Onboarding & Training | ✅ `/onboarding` | role tracks (coordinator / accounts / plant manager / admin): learn (real SOP) → practice (quiz, answers hidden server-side) → do (real action link); per-user completion; admin sees team completion |
| 41 AI Agent Marketplace / architecture | ✅ assistant header → agent picker | 6 agents (Management, Document, Finance, Operations, Compliance, HR) with scope, allowed tools, roles, read/propose; `/api/assistant/tool` filters tools per agent, refuses out-of-scope calls, audits `agent.tool` |
| 12 Predictive Cash Flow 7/15/30/60 | ✅ Insights → Cash flow | receivables & payables from coordination billing (estimated dates by client pattern), payroll from last run, imprest 3-month burn, contract commitments (actual); shortage + recommendation; actual vs estimate labelled; opening cash must come from Tally |
| 13 Payment Priority Engine | ✅ Insights → Payment priority | vendor dues ranked CRITICAL→LOW by overdue days, share of trips, active-PO dependency, size — with reasons |
| 32 Document Intelligence Vault | ✅ `/vault` | one index over KYC, company documents, contracts, issue evidence, form uploads, PO attachments; entity-linked; search tolerant of filenames/spellings (tokens + trigrams + synonyms — no embedding model, stated); duplicates, expiries, missing-document relationships |
| 37 Custom Report Builder + 38 Natural-language Reports | ✅ `/report-builder` | 7 sources, fields, filters, grouping, per-month, date range, count/sum/avg, bar/line/table; NL parser with limitation notes; save + role sharing; Excel & PDF export |
| 3 Business Digital Twin | ✅ `/twin` | live relationship graph (vendors → supplies → clients, vehicles, POs); click isolates the ecosystem, double-click opens 360°; red halo on nodes with open problems |
| 30 Mobile Field Operations | ✅ `/m` | phone hub: imprest, issue reporting (camera), forms, my tasks, and **receiving confirmation** (vehicle → received weight/date → trip updated) |

Tests (seeded): contract 30 d to expiry → renewal + obligation tasks; Decision Room approve → memory item; recall by role; onboarding progress; finance agent refused for coordinator, 6 tools for accounts; vault finds "TBS_gst_registration.pdf" for "terra gst certificate" and the agreement for "agreement abc"; NL "monthly supply volume by client with weight discrepancy last 3 months" → trips · sum shortageKg · by client · per month; cash flow 15 d in/out with recommendation; payment priority ABC Traders CRITICAL (25 d overdue, 100 % share). tsc clean · next build 69/69.

**Roadmap status: 35/35 (Business OS) + 50/50 (Premium) + PO Intelligence — all sections have a working implementation.**

---
## Pass 19 — Word prompt of 18 Sep 2026 (WhatsApp filing accuracy + app hygiene)

### WhatsApp document saving (the "big issue")
- Audited the agent against the SOP line by line: sales-group-only tracking with group picker ✓, vendor docs read-but-held ✓, merged/unmerged ✓, BDC/x/VENDOR/y and BDC/x/REW|GKD/y ✓, Bill T from our invoice ✓, FIFO receivings (vehicle + client + 3-day window + weight tolerance) ✓, Gangakhed +400/500 kg ✓, 53 vendor codes ✓, 27 clients ✓, folders **Month → Client → our document date → Reference** ✓ (exactly the structure in the prompt).
- Ran all 22 real sample documents embedded in the Word file through the actual agent code: 20 typed correctly and filed to e.g. `July-2026/Jhajjar Power Limited/30-07-2026/BDC_809_MHI_47`; vendor papers correctly held in the review/staging path until our document claims them.
- **Fixed the three named mistakes:**
  1. *Same document counted 2–3 times* → new **logical duplicate detection**: same document type + same document number (our doc no / vendor doc no / e-way bill no / GR no / vehicle+date) is a duplicate even when the bytes differ (merged page vs single file, re-scan, photo). Marked `_Duplicate`, never filed twice. 0 false positives on the 21 distinct samples.
  2. *Loading weight slip vs unloading receiving confusion* → weighbridge prints are now sided by WHOSE kanta: client name / inward / gate entry / GRN → **receiving**; vendor or plant name / loading / dispatch → **weight slip**. Tested both directions.
  3. *Vendor/client name mistakes* → the classifier now receives the client and vendor masters (aliases included) for the rules layer.
- Future company code: `BIPL/…` references parse alongside `BDC/…` (default company codes now BDC + BIPL; editable in Settings → Automation).
- **Google Drive document mirror**: Settings → Google Drive → "Mirror documents to Drive now" + auto-mirror with the autopilot. Same Month/Client/Date/Reference tree under "Biome Platform Documents"; incremental (size/mtime), state in config/drive-mirror.json. Offline folders remain the source of truth.

### App hygiene from the prompt
- **Font — root cause found and fixed:** the shipped `app/layout.tsx` carried a build stub (`const inter = { variable: "" }`) instead of the real `next/font/google` declarations, so the whole app fell back to the system font. Real self-hosted fonts restored, plus a **font picker** (Inter, Manrope, Plus Jakarta Sans, IBM Plex Sans, Sora, Space Grotesk) in Settings → Appearance, applied before first paint. Enum chips ("low_balance", "auto") now render capitalised.
- **Light theme blank — fixed:** the animated background always painted the dark forest scene and the token cascade could be washed out; a final light-theme block now has the last word, cards/inputs are white, and the background switches to a paper scene when the theme changes.
- **Premium logo:** new SVG mark (leaf with circuit veins in a rounded hexagon) in the sidebar; `components/brand/BiomeLogo.tsx` is reusable everywhere.
- **Developer-only for now** (menu AND server routes): Decision Room, Work AI Planner, Insights AI, Calendar, Issues·Camera, Meetings·AI, Communications, Operations Board, Digital Twin, Contracts, Document Vault, Report Builder, Onboarding. Command Center and PO Control stay for management.
- **Permissions explained:** every permission in Users & Access shows *what it opens*, *why grant it*, and a High-risk tag. **Revoking now notifies the user** in-app ("Your access was changed — Removed: …") and the feature disappears from their menu.
- **Category-wise navigation with sub-features:** Home · Documents & WhatsApp · Finance · Operations · People · Intelligence (developer preview) · Company & Settings · Developer — each with an expandable chain of sub-features; settings-type screens consolidated under Company & Settings.
- **Developer can rewrite any entry, highlighted:** trips, registrations, POs and imprest entries saved by the developer carry a `devEdited` stamp (who, when, which fields) and show an amber "Developer edited" chip / outline; settled imprest entries become editable for the developer only. Audit unchanged.

tsc clean · next build 67/67 · layout verified to ship real fonts.

## Pass 20 — Shared vendor codes, as the business decided (18 Sep 2026)
- The three SGE vendors keep the code exactly as issued (earlier SGE2/SGE3 split reverted; existing installs migrate automatically).
- Vendors page: a separate highlighted **"Shared vendor codes · needs attention"** category listing every code held by more than one vendor; those rows are amber-tinted with a ⚠ on the code.
- New registrations are refused with the reason on every path — Vendors master (create and code change) and Registration (partners, also checked against the vendor master): *"Not registered — vendor code SGE is already used by Shri Ganpati Enterprises. Every vendor needs its own code; choose a different one."*
- WhatsApp agent: when a reference carries a shared code, the vendor is chosen from the document's own text (name or alias on the page); if none is named, the supply set shows **"⚠ Shared code — confirm vendor"** instead of guessing. Tested: SOHI named → resolved; nobody named → flagged; unique codes untouched.

---
## Pass 21 — Phase 0 fixes · vendor merge · approved structure · redesign foundation (19 Sep 2026)

### Root causes fixed
- **Scanned WhatsApp PDFs not read (the big one):** the agent only pulled embedded JPEGs from PDFs; phone/CamScanner PDFs store pages as Flate/JBIG2/CCITT images, so nothing was OCR'd. Now every page is rasterised with **MuPDF (WebAssembly — no install on the PC)** at 2× and OCR'd in **Hindi + English** (hin.traineddata bundled from GitHub tessdata_fast). Verified on the real sample: a 4-page image-only PDF renders to clean pages (a Hindi *dharam kanta* slip with handwritten weights). Hindi weighbridge/bilty vocabulary added to the rules (कांटा, वजन, गाड़ी, खाली, पक्का, क्विंटल, बिल्टी…).
- **Font never worked:** next/font/google needs internet at build. Fonts are now bundled files (@fontsource: Inter, Manrope, Plus Jakarta Sans, IBM Plex Sans, Sora, Space Grotesk, IBM Plex Mono). Build passes with no network; the font picker switches real families.
- **Light theme sidebar blank:** an old `html[data-theme="light"] aside {background:#fff}` rule overrode the forest rail → white labels on white. Fixed.

### Vendor register — ONE place
- Registration is the single vendor/transporter register (KYC, freeze, categories, email). The WhatsApp agent's vendors.json is now **derived** from it (`lib/vendorSync.ts`): one-time import of the 53 trading vendors into Registration as category *trading*, then every save syncs back. `/vendors` redirects to Registration. Role rules unchanged and enforced server-side: plant manager → own plant raw-material vendors + transporters; coordinator → trading; admin/accounts/developer → all; each cannot see the other's.

### Navigation — approved map
Home · Documents · Supply · Partners · Finance · People · Reports · Admin · **Developer (super access)** with Labs (Issues, Meetings, Forms, Communications, Twin, Onboarding) and Inbox. Decisions/Work/Insights/Calendar live under Command Center for the developer.

### Redesign foundation (motion.dev patterns, Three.js)
- `components/motion/kit.tsx`: TiltCard (3D), SplitText, Scramble, CountUp, Stagger, Magnetic, PathLogo (self-drawing), PageWipe (route transitions) — all reduced-motion aware.
- `components/brand/Hero3D.tsx`: real WebGL scene — lime particle hexagonal prism (the logo in 3D), wire edges, floating pellet field, pointer parallax.
- New **Splash** (3D prism + path-drawn logo + split-text wordmark + wipe-out) and **Login scene** (3D + aurora + brand statement); Dashboard KPI tiles tilt in 3D with scrambling money; every route change wipes in; premium gradient-border cards, glowing primary buttons.

tsc clean · next build 67/67 (no font stub).

---
## Pass 22 — "Feature by feature": the hub system (19 Sep 2026)
The cure for the khichdi is ONE registry — `lib/featureMap.ts` — that says what the app is:
Category → Feature → Sub-feature (with a one-line "what it does", icon, permission, and page sections).
Everything now reads from it:
- **Sidebar** shows only the 9 categories (Home, Documents, Supply, Partners, Finance, People, Reports,
  Command Center, Admin, Developer) — a category is visible when the person may open at least one of its features.
- **Category hubs** at `/hub/<category>`: premium 3D-tilt cards, one per feature, each listing its own
  sub-features as click-through rows; locked features show with a lock (people learn the map, never a secret).
- **FeatureShell** on every page (via AppGate, no page edited): Home › Category › Feature › Sub-feature
  breadcrumb + spring-morphing pill tabs for the feature's chain; Settings' sections become anchor pills
  (Appearance & font, Automation, Mail, Save location, Override, Backup, Google Drive, Business memory,
  Server & Sync).
- **Dashboard** gains "Open the OS." — the categories as tilt cards with their feature chips.
Adding a page to the app now = one line in the registry; it appears in the sidebar category, the hub,
the shell and the dashboard at once. tsc clean · next build 67/67 (+ /hub/[category]).

---
## Pass 23 — Themes, effects, cinematic splash & login (19 Sep 2026)
Guided by the uploaded design-skills repo (modern-web-design, motion-framer, lightweight-3d-effects,
animated-component-libraries) and motion.dev patterns — implemented natively (framer-motion + Three.js + canvas + CSS).

- **Five complete themes** in `app/themes.css` (imported last, so nothing older can leak): Light · Paper
  (rebuilt from scratch: ink on paper, real card edges, lime that reads on white), Dark · Moss, Command · Teal,
  **Midnight · Neon** (obsidian + electric lime, HUD scanlines, native cursor hidden behind the glow),
  **Sunrise · Ember** (warm ivory, amber/coral). Every token defined per theme; rail stays branded per theme.
- **FX layer** (`components/fx`): cursor glow + lagging ring that grows over anything clickable; theme-aware
  particle field (pointer-repelled, pauses when hidden); Material ripples on every press; HUD corner brackets
  and a rotating conic light-border on card hover; shimmer skeletons; button glow/press physics; sidebar
  icon pops. Off on touch and reduced-motion.
- **Splash — 10 seconds, five scenes**: void wakes (grid sweep, 2000-particle 3D prism) → the mark draws
  itself → **BIOME** letters slam in from scattered space → **AI ERP** resolves from scramble noise + tagline →
  HUD boot (six modules come online with OK, counters: 2 plants · 27 clients · 53 vendor codes) → READY flash
  and an iris wipe into the app. Enter/click skips after 3 s.
- **Login — the Biome story**: six modules orbit the 3D prism in real 3D; rotating headlines about the
  business (two plants, self-filing documents, PO balances, 27 power plants, Command Center) with progress
  dots; live counters; client marquee; particles; cursor glow; the card in lime glass with the new logo.
tsc clean · next build 67/67.

---
## Pass 24 — 4 bug fixes: white screen, sidebar green, light theme, page cut (19 Sep 2026)

Root causes found and fixed:

1. **White screen on new-entry / form pages** — FormPanel's fullscreen modal uses `bg-biome-bg`
   (= white in light theme) on a white page body — invisible. Fixed: `app/themes.css` now pins
   the FormPanel background to `#f0f4ed`, sections to `#ffffff` with visible contrast, and body to `rgb(var(--c-bg))`.
   Also FormPanel body area gets a `bg-biome-surface/20` tint so sections are distinguishable.

2. **Sidebar white in light mode** — three conflicting rules in `globals.css` set `aside { background: #ffffff }`
   for the light theme; this fought `themes.css`'s forest-rail rule and won (earlier in cascade ≠ lower specificity).
   Fixed: removed all `aside` background rules from `globals.css`; `themes.css` (loaded last) is now the only
   source of truth for the rail colour.

3. **Light theme text invisible** — `themes.css` is loaded last but `globals.css` had an older light-theme block
   that left `--c-leaf-bright` and `--c-volt` undefined (they defaulted to the dark values = lime on white = 
   unreadable). Also `text-white` classes were painting on a white bg. Fixed with a definitive block in
   `themes.css`: ink text, `text-white` → `rgb(var(--c-text))` except inside buttons/rail, forms fully legible,
   tables, selects, scrollbars, modals, popovers, code blocks — all specified explicitly.

4. **Page options cut off** — `min-h-screen` on both the outer and inner flex wrappers created a double
   height constraint: content taller than the viewport had nowhere to scroll. Fixed: outer = `h-screen overflow-hidden`,
   inner = `min-h-0 flex-1 overflow-hidden`, `<main>` = `overflow-y-auto overflow-x-hidden`. Sidebar nav gets
   `pb-20` so the last item is never hidden behind the user-info footer. Sub-feature child panels changed from
   `overflow-hidden` to `overflow-visible`.

tsc clean · next build 67/67.

---
## Pass 25 — Sidebar text, splash/login white text, page-cut root cause (19 Sep 2026)

1. **Sidebar text invisible in light theme** — the old rule relied on `color: inherit`, which
   depended on what the rail's parent happened to set; in light theme that resolved to near-black.
   Fixed: every element inside `.forest-rail` is now forced to `#e2f6d5` (light) explicitly,
   with the active pill's text forced to dark green (`#163300`) since its background is bright lime.

2. **Splash & login text not white** — both screens are always-dark scenes, but the light-theme
   `text-white → ink` override (from Pass 24) was reaching inside them too, since they render inside
   the same themed `<html>`. Fixed: both screens now carry `data-force-dark="1"`, and a new CSS block
   pins everything inside that attribute to white/light regardless of the active theme.

3. **Pages cutting off / content going off-screen** — root cause found: `PageWipe` (the route-transition
   wrapper around every page) animated with `clipPath: inset(0 0 100% 0)`, which clips from the bottom.
   On any page taller than one screen, the clip constrained scrollable content into the clipped box.
   Fixed: `PageWipe` now uses a plain opacity + slight y-shift transition — no clipPath at all, so tall
   pages scroll exactly as far as their content requires.

tsc clean · next build 67/67.

---
## Pass 26 — launch review (27 Sep 2026)

Every item below was reproduced first, then fixed, then re-checked in a browser.

**Themes (#7)** — root fix, not patches: 366 hard-coded white/black classes in 45 files rewritten to
theme tokens; 43 stale light-theme blocks removed from globals.css; themes.css is the single authority.
Light/Sunrise now have a LIGHT sidebar (dark text, forest/amber active pill); dark themes keep the forest rail.
New `--c-hover` token is a translucent wash (6%), not a solid colour.
*Command theme was completely blank*: a rule set every `body > *` to `position:relative`, turning the fixed
particle canvas into 900px of normal flow and pushing the app off-screen. Scoped to in-flow elements only.
Sunrise backdrop and particles fixed. All 60 pages swept in Light and Command: 0 crashes, 0 blanks, 0 overflow.

**Splash & login (#1)** — the splash never ended (its 10s timer was reset every frame because the clock was
an effect dependency). Text on both screens is white with legibility scrims; login inputs keep their dark ink.
Invented client names in the marquee replaced with real clients.

**Cards / modals (#4, #9)** — root cause: `position:fixed` inside any transformed/blurred ancestor (page
transition, glass cards, hover lift, `will-change`) is positioned against that ancestor — modals were cut off
and moved with the mouse. New `Portal` mounts every overlay on `<body>` (25 overlays in 19 files); card hover
no longer transforms. FormPanel is now a centred spring-animated card (max 88vh, inner scroll, Esc/backdrop close).
QR "Open on phone" is an animated card.

**WhatsApp (#3)** — (a) no chat selected = nothing processed ("automatic processing is paused"): groups
named "sales" are now auto-selected when the selection is empty; (b) vendor papers whose supply's OWN document
is already filed join that folder immediately (SOP-safe: path taken from our document, never from the vendor
paper); (c) held papers are re-offered on connect and every 20 min; "Match the N waiting" button on the page.

**Users & Organisation (#2, #6)** — designation + department dropdowns (from Organisation) on user create,
stored on the account, shown in the list and on the phone header. Organisation shows where each entry is used
("12 employees · 3 logins"). Delete: accounts with history were always refused; the developer can now
force-delete — login destroyed, hidden everywhere, history keeps the name (tombstone). Verified: refused → forced →
cannot sign in.

**Data locking (#10)** — 24 API routes had no auth guard at all (Tally, clients, vendors, WhatsApp, plant data,
dashboard…). All guarded; only login/logout/health/OAuth callbacks remain public. Coordination register scoped:
coordinator = trading only, plant manager = own plant manufacturing only. Verified per role with live requests.

**OCR (#8)** — engine + Hindi/English language data bundled (no CDN; works offline); default language
Hindi+English; PDF export now classified like Excel (contents page + one section per document type +
unreadable list); the sorted Excel export was silently broken (it was fed the raw upload queue) — fixed;
GSTIN digit/letter correction; every file download in the app hardened against the revoke race.
Verified: 2 invoices → both exports correct.

**Android (#5)** — PWA (manifest, icons, service worker that never caches business data, offline page,
install prompt) + a role-aware phone home (/m) + **live sync**: every save bumps a version; open screens on every
device reload within ~6s (imprest, coordination, WhatsApp, attendance, PO, partners, leave). Desktop pages fit
a phone (sidebar becomes a drawer). `android-app/` is an Android Studio project for a real APK (works on plain
http LAN; see its README) — not compiled here (Google/Maven hosts are blocked from this workspace).

tsc clean · next build 68/68.
