# Pass 8 — Registration split · Imprest mobile · Multi-PC sync · Smart Sheets · Premium motion
(2026-08-18)

## 1. Registration
- Vendors split into **Trading** (coordinator's register) and **Raw material** (plant manager's).
  Enforced in /api/partners for every verb — a typed URL fails the same way a hidden link would.
- Coordinator's sidebar shows the same route as **"Trading Vendors"**; plant manager sees **"Registration"**.
  Plant manager registers raw-material vendors and transporters for their own site only.
- **One-week freeze**: a plant manager's submission stays editable for 7 days from registration,
  then edits and document uploads return 423 with a plain-language message. Admin/accounts unaffected.
  Re-saving never restarts the clock. UI shows a countdown chip and a frozen state.
- Missing REQUIRED documents are now loud: red card border, breathing "Missing" chip row,
  and a "Required, not on file" strip inside the documents section.

## 2. Imprest
- A float can only be opened for someone on the **active employee rolls** (name or code match);
  the employee list ships with the holder picker. Skipped only while the master is empty.
- **Mobile app at /m/imprest**: float card, expense/return filing sheet, live status, 10s polling.
  No sync layer — phone and desktop read the same server, so entries appear instantly everywhere.
- "Open on phone" QR in the desktop Imprest header, built from /api/server-info's LAN addresses.

## 3. Multi-PC (server / client)
- electron/main.js: **server mode** (runs Next + WhatsApp agent, holds all data) or **client mode**
  (starts nothing, points at the server URL). Config in userData/sync-config.json, applied by relaunch.
- /api/health heartbeat + components/ServerGuard.tsx: when the server stops answering (2 missed
  beats), every client blocks behind a full-screen notice and auto-recovers when it returns.
  Clients never fall back to local work — one server, one truth.
- Settings → **Server & Sync** card (developer role only, desktop app only) via electron/preload.js.

## 4. Smart Sheets (/ocr/sheets)
- Batch up to 100 images/PDFs → one fixed-column table. Presets: Receivings/weight slips,
  Lab reports, Sales invoices; or a custom schema up to 30 typed columns.
- Fully offline (Tesseract). Every empty or low-confidence cell is flagged in the grid and
  shaded in the Excel/PDF export; the grid is editable in place. CSV/XLSX/PDF export.
- Honest limits stated in the UI: clean print reads well, handwriting will need the flags checked.

## 5. Premium motion layer (globals.css + GlassCard)
- Page-entrance rise, card light-sweep on hover, gradient hairline wake, native-feeling
  bottom sheet on mobile, breathing attention chips, sidebar micro-slide, consistent focus rings.
- All of it steps aside for prefers-reduced-motion and the app's own reduce-motion switch.

## Build
- `tsc --noEmit` clean; `next build` compiles every route (fonts fetch needs internet, as before).

## Hotfix (same day)
- /api/health added to PUBLIC_PREFIXES: it was behind the sign-in wall, so every heartbeat
  returned 401, ServerGuard read that as "server down", and the block covered the login
  screen itself. The guard now also treats any HTTP answer below 500 as proof of life.
- Auto-login switched off: the session cookie no longer persists (no maxAge), so closing
  the app or browser ends the session and reopening always shows the login screen. The
  token still expires after 8 hours server-side as before.

## Pass 9 — "Deep moss with lime voltage" (full UI system pass)
Grounded in wise.com's DESIGN.md (via styles.refero.design):
- **Tokens rewritten, names kept** so all 49 screens restyle at once:
  light = Paper canvas (#ffffff), Fog cards (#e8ebe6 family), Charcoal/Slate text,
  Forest Ink (#163300) as the brand's gravity, Spruce for accent text.
  dark = green-tinted obsidian forest floor with Lime Voltage (#9fe870) as the text accent.
- **One electric note:** --c-volt (#9fe870) drives focus rings, input focus, button
  voltage edges, selection, and the sidebar's active pill — never body text on light.
- **Pills are foundational:** every .bmx-btn / .bmx-chip is now 9999px radius.
- **Flat premium:** .glass drops blur/gradients for a Fog surface + hairline border
  (Wise: "no gradients, no decorative blurs"); the hover light-sweep remains as the
  single flourish. shadow-glow re-tuned to lime.
- **The forest rail (signature):** the sidebar is a Forest Ink inverted panel in BOTH
  themes — Linen Mist labels, lime active pill (spring-morphing via layoutId), lime-on-
  forest brand mark set in the new .biome-shout display voice (Inter 900, -0.035em).
- Crisper motion curve (cubic-bezier .19,1,.22,1) across chrome; reduced-motion honoured.
- Other accent presets (ocean/sunset/violet/slate) untouched — "leaf" is the flagship.
- tsc clean; next build 49/49.

## Pass 10 — WhatsApp filing: the learning loop (SOP accuracy work)
Checked against the uploaded SOP; already implemented and verified in the agent:
sales-group-only tracking (allowedChats + watchAllChats off by default), vendor master
with all 53 codes (three SGE collisions seeded as SGE/SGE2/SGE3 — correct these in
Vendors), client list, BDC/x/VENDOR/y and BDC/x/REW|GKD/y parsing with typo tolerance,
vendor docs held in staging until our invoice claims the set, Month/Client/Date/Reference
folders, FIFO receiving matching (vehicle + client + 3-day window + no double-claim),
and the Gangakhed +500 kg weight allowance.

New — the agent now LEARNS from corrections (whatsapp-agent/lib/learning.js):
- Every manual correction records a chat-scoped filename-shape rule and a name alias
  in config/learning.json (human-readable, user-owned).
- On the next arrival the learned rule is consulted BEFORE trusting the classifier:
  it overrides when strong, and fills in whenever the classifier said "other"/nothing.
  Learned client-name aliases ("Jhajjar TPS" → Jhajjar Power Limited) resolve instantly.
- GET /learning reports what it knows; corrections flow through the existing manual
  correction route, so the current UI teaches it with no extra steps.
- Loop verified end-to-end by test: correction → same shape next time → right type.

## Pass 11 — Document typing rebuilt from the company's OWN documents
Extracted the 22 real supply documents embedded in the SOP Word file and used them as
the test set. Root causes found and fixed:
- Our tax invoices and delivery notes PRINT an "e-Way Bill No" column; the keyword
  scorer let "e-way bill" (weight 3) beat "delivery note" (weight 2), so our challans
  filed as e-way bills. The real consignment tag says "Tag for Consignment"
  (Annexure-II), not "consignment tag", so it fell through to the weight-slip guess.
  Filenames ("Consignment tag BIPL-912.pdf") were being ignored as evidence.
- New whatsapp-agent/lib/docRules.js: deterministic, evidence-ordered typing.
  1) The header STRIP of page one decides (a document announces itself at the top);
  2) e-way bills are recognised only by the printout's own structure (E-WAY BILL
  Details / Valid Upto) — never by the phrase as a column label; 3) the coordinator's
  filename decides when page text is too thin. Handles OCR noise seen on real paper:
  "TAX INVOLCE", soft hyphens in "e-Way", O↔0 swaps inside GSTINs.
- Wired into coerce() in classify.js — the single choke point every result (AI and
  offline) passes through.
- RESULT: 20/20 exact on the real documents (2 others are merged multi-doc PDFs,
  handled page-wise by the existing pipeline), and all three misfiled names from the
  screenshot now type correctly (Consignment tag → consignment_tag, BILL NO 53 →
  bilty, Delivery Note → biome_delivery_challan). End-to-end verified through
  classifyDocument: the challan that used to file as an e-way bill now reads
  biome_delivery_challan @96 with reference BDC/868/AT/357 extracted.
- New "Train the agent with real documents" panel on the WhatsApp page: upload any
  supply document, label its type, and the agent stores its wording as an exemplar
  consulted before guessing (existing samples engine, now with a UI + proxy routes).

## Pass 12 — Visibility repair, emails, attendance picker, Drive sync
- VISIBILITY (the real bug): color-scheme was never declared, so native <select>
  popups painted WHITE on the dark theme; and form fields used the same background as
  the panels they sat in. Fixed globally: color-scheme per theme, dark option-list
  styling, every .bmx-input now sits one surface step lighter, dark text/hairline
  tokens raised to readable, cards get a real border + faint top light, page-entrance
  blur removed. This is why the imprest budget screen (and others) "didn't work" —
  the fields were there, just invisible, with white dropdowns on top.
- Payslip modal: "Email payslip" button beside Download PDF — same PDF, same
  /api/payroll/mail route as the bulk send, per-slip.
- Attendance: double-click or right-click any day opens a mark PICKER (Present /
  Absent / Holiday / Leave / Half day / Clear) — clicking still cycles. Plus
  "Announce holiday / shutdown": plant-wise manual email to every active employee
  with a work email; response names anyone unreachable.
- Registration: "Send registration email" button in the partner form — a proper
  letter with every registration detail, documents on file, and what's still owed.
  Manual by design; proposes the partner's saved email, sender can change it.
- Sidebar: open sections now sit in faintly-lit cards with staggered item entrance.
- Google Drive sync (Settings): connect the company's OWN Drive via its own OAuth
  desktop credential (5-min setup, instructions on the card, exact redirect URI
  shown); tokens encrypted at rest like SMTP; scope drive.file only; "Back up to
  Drive now" uploads the same zip the local backup makes, resumable upload, into a
  "Biome Platform Backups" folder.
- Build verified: tsc clean, 49/49 pages.

## Pass 13 — Local, free AI assistant (same working as the cloud one)
- The assistant now has two brains behind ONE behaviour. "Local · free" (default when
  the machine supports WebGPU) runs a small open model ON the PC via WebLLM —
  Llama 3.2 1B/3B or Qwen2.5 3B (Hindi-friendly), picked in the panel header. First
  use downloads the weights once (free, progress bar shown); after that it works with
  no internet and no API key. "Cloud · API key" keeps the existing Anthropic path.
- Same hands for both brains: the local model drives the SAME read-only tool
  catalogue (Tally balances, supply sets, documents, vendors, clients, system status)
  through the new /api/assistant/tool endpoint — data stays on the server behind the
  session, writes stay impossible, and the trace still shows every lookup.
- Small models can't do native function calling, so the local loop speaks a strict
  one-JSON-object protocol ({"tool":…} or {"answer":…}) with a repair nudge on
  malformed replies and a graceful surrender after that — the person always gets an
  answer, never a stuck spinner. Answers stream in, Hinglish in → Hinglish out.
- Honest limits, stated in the UI: a 1–3B local model is good at lookups, summaries
  and drafting; the cloud brain stays available for genuinely hard reasoning.
