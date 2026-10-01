# BIOME ERP — Project status (01-10-2026)

Repo: https://github.com/biomeindustriaprivatelimited-boop/BiomeERP-AI
Kaam wali branch: `claude/app-data-security-backup-f6c0ze` (main me abhi sirf Round 1 merged hai — PR #1)
Latest .exe: https://github.com/biomeindustriaprivatelimited-boop/BiomeERP-AI/actions/runs/36556768749 (13-10-2026 tak download)

---

## ✅ Ho chuka kaam

### Round 1 (main me merged — PR #1)
1. Server PC = data centre; client PC par data nahi; scheduled backup (daily/weekly/monthly) local + extra folder + Google Drive, encrypted backup, restore (server / Drive / uploaded file).
2. BIOME Command theme me mouse cursor hide hone ka fix.
3. Report Builder: module-wise reports (imprest, coordination, transport, biomass, stock, registrations, PO, leave) — category / person / place / plant / user wise, PDF + Excel.
4. Vendor/client registration: trading = coordinator, manufacturing = plant manager; KYC upload; Submit & freeze; edit sirf accounts/admin/developer unlock se.
5. Plant manager vs coordination vehicle match/unmatch indicator (data share kiye bina).
6. Plant spare-parts stock (items, machines, GRN, issue, return, transfer, adjustment); Procurement role.

### Round 2 (branch par)
7. WhatsApp document scanning fix (offline OCR, group selection, purane messages, 40 MB files).
8. Developer: poora data wipe (10 sec warning + pehle backup), vendor/client/trip/PO delete.
9. Number series Tally jaisi: automatic / automatic + manual override / manual; series add/edit.
10. Follow-ups: vendor/client ko email/WhatsApp — missing papers, credit note, tax invoice, KYC, PO end/extend.
11. WhatsApp papers coordination trip se reference (BDC/45/JSR/15) se link + mismatch notice.
12. Server PC se sab devices control (message, reload, sign-out, block); update notice; top bar me Android app download.
13. Sidebar me Plant category; stock me purchase invoice / kanta parchi upload.
14. Gemini key Settings se (env file nahi); close button hilna fix.

### Round 3 (branch par)
15. Plants: Mayan (1st) + Gangakhed (2nd); add/edit sirf Developer (Developer → Plants).
16. Access: coordinator = coordination + apna imprest + WhatsApp docs; plant manager = apna plant (biomass, transport, plant imprest, stock); dono plants ka data alag; coordination ↔ plant data ek doosre ko nahi dikhta.
17. Automatic reco (vehicle + weight); 3 din me fix/note nahi → red flag; Mismatches page (accounts/admin/dev) se app/email/WhatsApp notice.
18. Weight hamesha kg (MT / quintal apne aap convert).
19. Biomass/transport sheet sirf plant manager likhega; office ke liye read-only + accounts remarks.
20. Google Drive keys Settings (Cloud) se.
21. Help & support: normal users ticket; admin/dev resolve; band hone ke baad sirf developer reopen.
22. Directors ki photo (Tanesh Singh Dod, Shubham Goel) badi.
23. Biomass/transport Excel me professional heading (company, plant, title, logo).

### Round 4 — installed .exe fixes (branch par)
24. WhatsApp agent "Not Running" fix (Node 20 / ESM) + auto-restart + log files.
25. 15 sec baad blank screen fix + error screen.
26. PDF reading installed app me fix.
27. Audit fixes: vendor master khali hona, plants.json format, weight slip galat folder, OCR verify, challan template, duplicate code.
28. "Add documents by hand" (WhatsApp jaisa processing).
29. Train-the-agent samples ka dropdown (page lamba nahi hota).

---

## ⏳ Pending (aapki taraf se chahiye / baaki)

| # | Kaam | Kis cheez ka intezaar |
|---|---|---|
| P1 | Splash + login screen video jaisa (parallax, ghost-trail text, sections, footer) | **Aapki images** (hero + 3 cards + optional leaf background) — prompts chat me diye hain; text confirm |
| P2 | Repo ko **Private** karna | Aap karenge: GitHub → Settings → Danger Zone → Make private |
| P3 | Purani Gemini key (git history me) delete karna | Aap karenge: aistudio.google.com/apikey |
| P4 | Branch ko main me merge karna (naya PR) | Aapka "PR banao" bolna; merge ke baad har push par .exe apne aap |
| P5 | Asli WhatsApp QR link test | Aap naya .exe install karke "Link WhatsApp" karein; problem ho to `%APPDATA%\Biome\logs\whatsapp-agent.log` bhejein |
| P6 | Rate per kg vs per ton confirm (biomass/transport amount = kg × rate) | Aapka confirm |
| P7 | Admin ko stock access rakhna ya hatana | Aapka faisla (abhi admin ke paas hai) |
| P8 | Git history se purani key hatana (force-push) — optional | Aapka "haan, history saaf karo" |

Chhoti baatein (jab chahein):
- Holiday/non-document photo WhatsApp se aaye to "held" me padi rehti hai — ise "Not a document" me bhejna.
- Delivery challan / payroll export ka real-data test.
