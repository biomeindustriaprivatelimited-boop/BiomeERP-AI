# Biome ERP — Update 29-09-2026 (Hinglish guide)

## 1. Plants: Mayan (1st) aur Gangakhed (2nd)
- Pehla plant ab har jagah **Mayan Plant** (code REW, Mayan Village, Rewari, Haryana), doosra **Gangakhed Plant** (GKD).
- Naya plant add / naam, state, address edit: **sirf Developer** → Developer → **Plants** tab → "Add plant".
  Naye plant ko apna biomass sheet, transport sheet, stock aur imprest milta hai — doosre plant se alag.
- Plant ka code (REW, GKD…) baad me nahi badalta; naam badal sakte ho.

## 2. Kaun kya dekhega (access)
| Role | Kya milega |
|---|---|
| Coordinator | Poora coordination, apna imprest, WhatsApp documents, trading vendors. **Plant sheets nahi.** |
| Plant manager | Sirf apna plant: biomass sheet, transport sheet, apne plant ke **sab logon ka imprest**, spare parts stock. **Coordination / PO nahi.** |
| Procurement | Stock & spare parts (sab plants), spare-part vendors. |
| Accounts | Finance, coordination, plant sheets (sirf padhna + "Accounts remarks" column), mismatches. **Stock nahi.** |
| Admin / Developer | Sab. |
- Mayan ka manager Gangakhed ka data nahi dekh sakta, aur ulta bhi.
- Kisi ek user ko extra access: Developer → Access → us user par permission on/off.

## 3. Plant ↔ Coordination automatic reco + 3 din ka RED FLAG
- Plant manager ki transport sheet aur coordinator ka manufacturing register **vehicle no + date (±1 din) + weight (kg)** se apne aap match hote hain.
  Dono ko sirf ✓ / ⚠ / ✗ dikhta hai — doosri team ka data nahi.
- Mismatch **3 din** me fix (entry sahi) ya explain (note) nahi hua → row par **⚑ red flag**.
- Row ke flag par click → "kyun alag hai" note likho (jaise: same din doosra trip) → flag hat jata hai.
- **Accounts / Admin / Developer**: Supply → **Plant ↔ Coordination mismatches** — dono side ka data saath me,
  aur responsible user ko **app notice / Email / WhatsApp** ek click me. Notice user ko app ke upar laal card me dikhta hai.

## 4. Weight hamesha KG me
- Sheet me **28.4 MT**, **284 qtl**, ya sirf **28.4** likho → cell chhodte hi **28,400 kg** ban jata hai (server par bhi).
- Coordination form (dispatch / receiving / CC weight) me bhi yahi.
- Weight slip OCR: slip par MT/Qtl ho to bhi kg me padh ke match karta hai.
- Dhyan do: **Rate ab per kg** ke hisaab se amount banata hai.

## 5. Biomass sheet sirf plant manager ka
- Biomass / transport sheet me entry, edit, delete, vendor import: **sirf us plant ka manager** (aur developer).
- Accounts/Admin ke liye sheet **read-only** hai; sirf "Accounts remarks" column likh sakte hain.
- Weight slip upload → 🔍 button → OCR slip padh ke gross/tare/net/vehicle match karta hai.

## 6. Google API key app ke andar se
- **Gemini (AI OCR)**: Settings → AI OCR Engine → key paste → Save.
- **Google Drive (documents storage)**: Admin → Cloud → **Google Drive API credentials** → Client ID + Client Secret → **Save & activate** → "Connect Google Drive".
  .env file edit karne ki zaroorat nahi, restart bhi nahi. Secret encrypted save hota hai.
- Backup wali Drive: Settings → Backup → Google Drive (pehle jaisa).

## 7. Help & Support ke naye rules
- Ticket (documents ke saath ya bina) **sirf normal users** raise karte hain — admin/developer nahi.
- **Resolve / Decline**: admin ya developer.
- Resolve/Decline/Close hone ke baad **sirf developer** reopen kar sakta hai ya status badal sakta hai
  (Reopen button + "Change status…"). Baaki log sirf reply likh sakte hain.

## 8. Directors ki photo
Company page par badi photo: **Director 1 — Tanesh Singh Dod**, **Director 2 — Shubham Goel**.

## 9. Excel export ka professional heading
Biomass / transport sheet ka Excel (plant manager ya koi bhi export kare):
- Upar logo + **BIOME INDUSTRIA PRIVATE LIMITED**
- Plant ka naam + address (jaise MAYAN PLANT · Mayan Village, Rewari, Haryana)
- Sheet ka title + date range + "All weights in kg" + kisne export kiya
- Hari header row, zebra rows, TOTAL row, print me landscape + page number.

---

# Fix update — installed .exe (29-09-2026, dopahar)

## A. WhatsApp agent "Agent Not Running" — theek
- Wajah: installed app ke andar Node 20 chalta hai; WhatsApp library (Baileys) aur PDF reader (pdfjs) naye version me
  sirf ES-module hain, jo purane code se load nahi hote the → agent start hote hi band ho jata tha, aur PDF kabhi padhe nahi jaate the.
- Ab dono sahi load hote hain. Agent band ho jaye to app use khud dobara chalu karta hai (pehle 5 baar jaldi, phir har minute).
- Log files: `%APPDATA%\Biome\logs\whatsapp-agent.log` aur `server.log` — problem ho to ye file bhejo.

## B. 15 second baad screen blank — theek
- Page badalne wala animation atak jaata tha (Windows ko window "chhupi" lagti to animation ruk jata) → content invisible.
- Ab page seedha dikhta hai (simple CSS animation), window kabhi throttle nahi hoti, aur page crash ho to
  "This screen hit a problem · Try again" dikhega — blank nahi.

## C. Audit me mile aur theek kiye bugs
1. **Vendor master khali ho jaata tha** (Registration sync 53 vendors mita deta tha) → ab sync sirf jodta/badalta hai; khali ho to master wapas aa jaata hai.
2. **plants.json do format me** (agent vs app) → Gangakhed ka +500 kg adjustment mit jaata tha / state galat → ab ek hi format.
3. **Weight slip galat client folder me** jaati thi → ab poora supply set hamare invoice ke client ke folder me.
4. **Weight slip OCR verify (plant)** installed app me fail → theek.
5. **Delivery challan template** installer me shamil nahi tha → ab shamil.
6. Agent me `/test` aur `/chats` code teen baar copy tha → saaf kiya.

## D. Naya: "Add documents by hand"
WhatsApp Documents page par — email/scan wale papers upload karo, woh WhatsApp jaisa hi padhe, match, hold ya file hote hain.

## E. Test result (installed-app runtime par)
Vendor invoice + weight slip + scanned e-way bill pehle aaye → held; hamara tax invoice aaya → chaaron ek folder
`September-2026/Jhajjar Power Limited/20-09-2026/BDC_45_JSR_15/` me file; same invoice dobara → duplicate skip;
vendor invoice baad me aaya → seedha supply me judaa. Sab APIs 2xx (Tally/Mail sirf set na hone par 502).
