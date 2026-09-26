# BIOME ERP — Implementation Log (2026-08-09)

This build contains actual source changes. It is **not** marked as fully production-complete because external systems (Tally live company, WhatsApp account, GST portal) cannot be authenticated in this build environment.

## Implemented in this pass

### WhatsApp workflow
- Added separate workflow scopes for Sales, Receiving and Lab WhatsApp groups.
- Receiving groups are now processed even when they are not part of the Sales scope.
- Receiving matching uses client + vehicle + 0–3 day date window and FIFO for repeated vehicle supplies.
- Receiving weight is retained on the supply set as the actual client receiving weight.
- Safe receiving matches are filed into the matched supply folder.
- Unresolved/low-confidence receiving documents go to `_Review Queue` instead of a final business folder.
- Lab reports are processed as standalone client documents and are not attached to a single supply set.
- Lab reports use `Month → Client → First sample date To Last sample date` filing.
- Offline extraction already had lab sample-date and multi-vehicle support; the AI extraction schema is now aligned with it.
- Low-confidence/unresolved documents are routed to an explicit review path.

### WhatsApp UI
- Group picker now lets the user assign a chat as Sales, Receiving or Lab.
- Existing explicit “watch selected chats” safety remains.
- Supply-set cards now show receiving status and actual receiving weight.

### Business AI Assistant
- `/assistant` is now a real conversation workspace instead of a static capability page.
- It uses the existing grounded `/api/assistant` tool orchestration.
- Quick questions are included for finance, supplies, outstanding and document status.

### Delivery Challan templates
- Existing uploaded Mouda 3-sheet / 3-page and Solapur Delivery Challans + Annexure templates remain in `templates/challan/`.
- Template workbooks were verified against the supplied files by sheet names and dimensions.

### Tally
- The supplied TDL is byte-for-byte identical to the project `tally/BiomeBridge.tdl` in this source snapshot.
- Tally live data still requires the user's Tally company and XML/bridge connection to be available.

## Validation performed

- `node --check` passed for `whatsapp-agent/agent.js` and every `whatsapp-agent/lib/*.js` file.
- Receiving FIFO unit scenario was executed successfully.
- Lab-report date-range scenario was executed successfully.
- Review-queue filing path was executed successfully.
- Full Next.js build was not executed because dependencies are not installed in this environment.

## Not falsely marked complete

These require live external data or credentials and must be tested on the user's PC:
- Live WhatsApp login/media download.
- Live Tally company balances and voucher data.
- GST portal authentication/API/session access.
- End-to-end PDF/Excel exports through the browser runtime.

The app must not claim these are working until they pass real tests.

## Pass 2 — Accounting & reconciliation hardening
- Reconciliation now accepts ledgers where invoice numbers are missing or exported under incompatible formats. It can fall back to normalized Party/Ledger + Date + Amount matching within the configured tolerance.
- Added Party / Ledger as a first-class auto-detected reconciliation field.
- Reconciliation UI no longer blocks execution solely because invoice-number columns are absent; a party + monetary match key is sufficient.
- Export marks party/date/amount fallback matches so an accountant can audit how the match was made.
- Tally party response typing was corrected to carry raw closing balance metadata without breaking the normalized displayed balance.
- This pass does not claim live Tally/GST/WhatsApp integration is complete without real connected-system testing.
