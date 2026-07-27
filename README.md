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
