# Biome Industria — Enterprise Platform (Phase 1)

A premium Next.js dashboard for Biome Industria Private Limited — dark
glassmorphism UI, animated aurora background, and a signature
"energy pulse" border motif (leaf → bolt → sky) referencing the
company's biomass-to-energy story.

## What's real vs. what's a placeholder

- **Dashboard** and **Company Profile** are fully built. Company Profile
  uses real information pulled from biomeindustria.com (about, purpose,
  products, both manufacturing units, leadership, contact).
- The **Reconciliation**, **OCR Scanner**, and **WhatsApp Documents**
  pages are intentionally marked **"In Development"** — the real, working
  versions of these tools are your existing Streamlit app
  (`app.py`) and `whatsapp_webhook.py`. This platform doesn't yet call
  into that logic; wiring a real API between them is the next phase.
- Dashboard KPI numbers are clearly labeled as **sample data** — they are
  not connected to any real reconciliation or OCR results yet.

This was a deliberate choice: it would have been easy to fill every
screen with realistic-looking numbers, but that would be inventing data
that doesn't exist. Nothing on this platform claims to be live unless it
actually is.

## Requirements

- [Node.js](https://nodejs.org) 18.18 or newer (includes npm)

## Setup

```bash
cd biome-platform
npm install
npm run dev
```

Then open **http://localhost:3000** in your browser.

## Project structure

```
biome-platform/
├── app/
│   ├── layout.tsx          # Root layout — fonts, sidebar, navbar, background
│   ├── page.tsx             # Dashboard (home)
│   ├── company/page.tsx     # Company Profile (real data)
│   ├── reconciliation/page.tsx
│   ├── ocr/page.tsx
│   └── whatsapp/page.tsx
├── components/
│   ├── Sidebar.tsx
│   ├── Navbar.tsx
│   ├── AuroraBackground.tsx
│   ├── GlassCard.tsx
│   ├── AnimatedCounter.tsx
│   └── ModuleComingSoon.tsx
├── public/assets/logo.png   # Company logo
└── tailwind.config.ts       # Design tokens (colors, animations)
```

## Design system

| Token | Value | Use |
|---|---|---|
| `biome-leaf` | `#7CB342` | Primary green accent |
| `biome-sky` | `#5B9BD5` | Secondary blue accent |
| `biome-bolt` | `#FDE047` | Energy/highlight accent |
| `biome-bg` | `#0A0F1A` | Base background |

Fonts: **Space Grotesk** (display/headlines), **Inter** (body),
**IBM Plex Mono** (data/KPI numbers).

## Next phases (not built yet)

1. Expose the Streamlit reconciliation/OCR logic as an API (FastAPI or
   Next.js API routes calling into Python) so this platform can show
   real results instead of "In Development" pages.
2. Wire the WhatsApp Documents viewer to read from the same
   `WhatsApp_Documents/` folder the webhook receiver writes to.
3. Add authentication if this will be used by more than one person.
4. Deploy (Vercel is the simplest option for a Next.js app like this).

## Production build

```bash
npm run build
npm run start
```

## WhatsApp Documents

Link the company WhatsApp account once by QR code (Vendors → WhatsApp
Documents → **Link WhatsApp**). From then on the app watches that account in
the background and files everything that arrives.

An incoming document is downloaded, read by AI, matched to its coordination
reference, and saved:

    BDC / 786 / MHI / 44
     |     |     |    |
     |     |     |    +--- the vendor's tax invoice or challan no
     |     |     +-------- the vendor code
     |     +--------------- our tax invoice or challan no
     +--------------------- our company code

    Documents/Biome Platform/whatsapp/inbox/
      2026-27/Jhajjar Power Limited/BDC-786-MHI-44/
        Biome/    Biome Tax Invoice - BI26-27-HR0786.pdf
        Vendor/   Vendor Tax Invoice - 44.pdf
        Shared/   Weight Slip - RJ29GC7686.jpg

The **Supply sets** view groups every document under one reference and shows
what has not arrived yet, so coordination can chase the gap rather than
discover it at billing time.

Anything the AI cannot place goes to `_Needs Review` rather than being filed
on a guess. Register the vendor code, then press **Re-scan**.

The watcher runs as its own process (`whatsapp-agent/`) so a dropped WhatsApp
connection or a slow document read can never freeze the UI. It starts and
stops with the app; in development run `npm run whatsapp:agent` alongside
`npm run dev`, or `npm run dev:all` for both. See `whatsapp-agent/README.md`.

## Vendor registry

Vendors → **Vendor registry** holds the codes that appear in coordination
references, plus each vendor's full details and KYC documents.

- **Add vendor** — register a code by hand, with GSTIN/PAN validated as you
  type, plus contact, address, banking and payment terms.
- **Upload vendor list** — bring in an existing CSV or Excel sheet. Column
  headers are matched loosely ("Vendor Code", "vendor_code", "GST No" all
  work), and you see a row-by-row preview of what will be added, updated and
  skipped before anything is saved.
- **KYC** — store the GST certificate, PAN, cancelled cheque, MSME
  certificate or signed agreements against a vendor. Files live in
  `Documents/Biome Platform/kyc/<CODE>/` as ordinary files you can also open
  in Explorer or hand to an auditor.

A code registered here immediately improves document matching — the agent
reads the same vendor master.

## GST Compliance

Load the JSON the GST portal gives you and work with it invoice by invoice.

- **Invoice-wise returns** — drop in a GSTR-2B (purchases) or GSTR-1 (sales)
  JSON. It's parsed entirely in the browser, so the file never leaves the
  machine. B2B, credit/debit notes, amendments, exports, ISD and import of
  goods all come through as flat rows, with the GST rate, taxable value,
  IGST/CGST/SGST/cess split, IRN and supplier filing date on each line.
- **ITC at risk** — every 2B invoice the portal has marked ineligible is
  flagged, with the portal's own reason, and lands on its own sheet in the
  Excel export.
- **GST vs Books** — add your books export (any CSV or Excel with an invoice
  number and a taxable value) and every line is classified: matched, tax
  mismatch, taxable-value mismatch, date mismatch, only-in-portal,
  only-in-books, or a probable match where only the invoice number differs.
  Invoice numbers are normalised first, so "0044" and "44" match. Export is
  one sheet per category.

### Why there's no GST password login

gst.gov.in protects sign-in with a captcha and an OTP, and its terms don't
permit automated access. Storing your GST credentials to click through those
checks would mean defeating security controls that exist for a reason, so
this app doesn't do it. The official JSON download is two clicks and carries
identical invoice-level detail. For hands-off syncing, a licensed GSP (GST
Suvidha Provider) sells authorised API access — that key can be wired in
without changing anything else here.

## AI-assisted reconciliation

Two places the AI helps with ledger reconciliation, at
`/api/reconcile-ai`:

- **Column mapping** (`action: "map"`) — reconciliation usually fails because
  the two files name things differently: "Vch No." against "Voucher Number",
  a Tally export with debit and credit in unlabelled columns. Keyword
  auto-detection gives up on those. The AI sees the real headers plus a
  sample of rows and maps them, and any column name it invents is discarded
  rather than trusted.
- **Difference explanation** (`action: "explain"`) — groups differences by
  the cause an accountant would recognise (TDS not recorded, GST on one side
  only, timing difference, part payment, duplicate posting, invoice number
  typed differently) with the action to take and a severity. Anything it
  can't explain from the numbers is marked for manual review rather than
  given a made-up cause.

Only headers and a small row sample are sent — never the whole file.

## Appearance

Settings → Appearance now has a light/dark switch and five accent palettes
(Biome Leaf, Ocean, Sunset, Violet, Slate). The choice is applied before
first paint, so there's no flash of the wrong theme on load.
