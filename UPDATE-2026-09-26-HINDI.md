# BIOME ERP — Update 26 Sep 2026 (kya naya hai, kaise use karein)

## 1. Data security — Server PC hi "Data Centre" hai

**Aapka doubt:** 15 log (3 accounts, 5 coordination, 3 plant manager, 2 procurement, 2 admin) apne phone/PC me app chalayenge — kya sabke device me poora data jayega?

**Jawab: nahi — agar setup niche jaisa ho.**

- **Ek PC = SERVER.** Saara data sirf isi PC ke data folder me rehta hai
  (`Documents\Biome Platform`, ya jo folder Settings me choose kiya).
- **Baaki sab PC = CLIENT.** Developer → Settings → *Server & Sync* me har client PC ko
  `client` mode + server ka address (jaise `http://192.168.1.10:4173`) do.
  Client PC par koi server nahi chalta, koi data file nahi banti.
- **Phone** browser/PWA se usi server address par khulta hai.
- **Kaun kya dekh sakta hai — server tay karta hai**, device nahi. Plant manager ke phone ko
  dusre plant ka, coordination ka ya finance ka data bheja hi nahi jaata. Device par "trick" se
  dekhne ke liye kuch hota hi nahi.
- **Naya (is update me):**
  - Server har page/API answer par `Cache-Control: no-store` bhejta hai — browser/phone ya
    client PC ka cache data save nahi karta.
  - Client PC ka app start aur band hote waqt apna cache khud saaf karta hai.
  - `X-Frame-Options`, `nosniff` security headers.

> Server PC ko hamesha ON rakhein, UPS lagayein, aur Windows login par password rakhein —
> data wahi hai.

## 2. Backup — Daily / Weekly / Monthly, Local + Google Drive, Restore

**Settings → Backup** (admin / developer):

| Setting | Matlab |
|---|---|
| Automatic backups on | Schedule chalu/band |
| Time | Kis samay (default raat 2:00) |
| Daily — keep last 7 | Roz ek backup, sabse naye 7 rakhega |
| Weekly — Sunday, keep 5 | Har hafte |
| Monthly — day 1, keep 12 | Har mahine |
| Also upload to Google Drive | Har automatic backup Drive par bhi |
| Second copy folder | Doosri disk / USB / NAS, jaise `D:\Biome Backups` |
| Backup password | AES-256 encryption. **Password kahin likh ke rakhein** — iske bina encrypted backup naye server par restore nahi hoga |

- PC raat ko band tha? App chalte hi chhoota hua backup khud le liya jaata hai.
- Har backup ko likhne ke baad wapas khol ke **verify** kiya jaata hai.
- Purane backups "keep" rule se khud hat jaate hain (local, extra folder aur Drive teeno se).
  Manual aur uploaded backups kabhi auto-delete nahi hote.

**Google Drive connect:** `CLOUD-SETUP.md` ke steps se Client ID/Secret banayein →
Settings → Google Drive → Connect.

**Restore (poora data wapas):**
1. Settings ke upar **Override** ON karein (admin login).
2. Backup list me **Restore** dabayein → jo hoga wo padhein → `RESTORE` type karein.
3. Naya server PC ho to: pehle **"Show backups on Drive" → Bring here**, ya
   **"Choose backup file"** se pen-drive wala `.zip` / `.biomebak` upload karein, phir Restore.
4. Restore ke baad server PC par app restart karein.

Restore me aata hai: users, vendors/clients + KYC files, coordination, plant sheets, stock,
imprest, payroll, attendance, documents — sab. Purana folder delete nahi hota, side me
`biome-data-replaced-…` naam se rakha jaata hai. WhatsApp login aur passwords backup me nahi
jaate (security) — isliye restore ke baad WhatsApp QR dobara scan nahi karna padta.

## 3. BIOME Command theme — mouse cursor

Command/Midnight theme me mouse pointer chhupa diya gaya tha (`cursor: none`). Ab normal
pointer hamesha dikhta hai; glow sirf saath chalta hai.

## 4. Report Builder (Reports → Report Builder)

Har module ka alag report:

- Imprest — expenses & advances
- Coordination — trading supplies · manufacturing supplies (plant match ke saath)
- Transport — plant dispatch sheet
- Biomass — purchase at plant
- Stock — on hand & value · receipts & issues (kaunsa part, kaunsi machine)
- Vendor & client registration
- Purchase orders — consumption
- Leave requests

Har report me: **Period** (This month / Last month / 3 months / FY / custom), **Plant**,
**Group by** + **Then by** (category, person, place, plant, user, vendor, client, vehicle,
machine, status, month… jo us report par lagu ho), filters, search.
Output: sub-totals + grand total, detail table, **PDF** (company letterhead, landscape, page
numbers) aur **Excel** (Summary + Detail sheet, formatted, filter wale headers).
Report sirf wahi data dikhata hai jo us login ko module me dikhta hai.

## 5. Vendor & Client Registration

- **Trading** vendor/client → **Coordinator** register karega.
- **Manufacturing** vendor/client/transporter → **Plant manager** (apne plant ke liye).
- **Procurement** → manufacturing side ke spare-part / stores vendors.
- Registration form me hi **KYC & business documents** attach karein (GST, PAN, cancelled
  cheque, agreement, Aadhaar, incorporation, trade licence, address proof, bank letter…).
- Sab check karke **"I have checked…" tick → Submit & freeze.** Iske baad coordinator /
  plant manager edit nahi kar sakta.
- **Accounts, Admin, Developer**: frozen record seedha correct kar sakte hain (audit hota hai)
  ya **Unlock for correction** (reason ke saath) karke wapas bhej sakte hain.
- **"Handled for"**: har vendor ke liye choose karein — Biomass, Machine spare parts,
  Consumables, Machinery service, Transport, Packaging, Fuel, Civil/Electrical…
  Plant Stock me GRN karte waqt sirf spare-part/consumable/service wale vendor aate hain.

## 6. Plant ↔ Coordination vehicle match

Plant manager ki **Transport sheet** (dispatch) aur coordination ki **Manufacturing register**
ko server match karta hai: **same plant + same vehicle + date ±1 din** (+ weight ±1% / 100 kg).

- Coordination register me har trip par: ✓ Plant matched / ⚠ Plant weight differs / ✗ Not in plant dispatch
- Plant transport sheet me har row par: ✓ Coord. / ⚠ Wt / ✗ Coord.
- Dono ko sirf **indication** milta hai — ek doosre ka data nahi.
- Plant pehchanne ke liye coordination trip ke **Location** me plant ka naam/code
  (Rewari / REW, Gangakhed / GKD) hona chahiye.

## 7. Plant Stock (Supply → Plant Stock · Spare parts)

- **Items**: part name, part no, make, category, unit, re-order level, rack, kaunsi machines me lagta hai.
- **Machines**: plant-wise machine master.
- **Receive (GRN)**: registered vendor + invoice/challan + multiple lines (qty, rate).
- **Issue to machine**: machine + kisko diya + purpose → stock se minus.
- **Ledger**: har entry, Excel export; stores in-charge cancel kar sakta hai.
- **Opening stock / adjustment / return / transfer** (stock.manage wale).
- Balance kabhi store nahi hota — har baar entries se calculate hota hai (galat balance ban hi nahi sakta).
  Value = weighted average rate. Re-order level se neeche → LOW / OUT.

**Roles:** naya role **Procurement** (sab plants ka stock + spare-part vendors + reports).
Plant manager apne plant me receive/issue kar sakta hai. Developer kisi bhi user ko
Users & Access se `Plant stock` / `Plant stock — manage` permission de sakta hai.

---

## 8. GitHub se app test kaise karein

GitHub khud app nahi chalata — wahan sirf code rehta hai. Test karne ke 2 raaste:

**A) Installer download karke (sabse aasan, Node.js ki zaroorat nahi)**
1. GitHub repo → **Actions** tab → "Build Windows installer" → sabse upar wala ✓ green run.
2. Neeche **Artifacts → Biome-Windows-Installer** download karein, zip kholein.
3. `Biome Setup ….exe` chalayein (SmartScreen aaye to *More info → Run anyway*).
4. Test ke liye kisi **alag PC** par ya alag data folder ke saath chalayein, taaki asli
   server ka data na chhede.

**B) Code download karke (developer tarika)**
1. Node.js 20+ install karein: https://nodejs.org
2. Repo page → **Code → Download ZIP** (ya `git clone`), folder kholein.
3. Terminal me: `npm install` → `npm run dev` → browser me `http://localhost:3000`.
4. Asli data se bachne ke liye test data folder alag rakhein:
   PowerShell: `$env:BIOME_DATA_ROOT="C:\BiomeTest"; npm run dev`

**Pehla login (naye/khali data folder par):** username `admin`, password `biome-admin`
→ app turant naya password maangega. Developer account:
`node tools/biome-admin.js --developer=AapkaPassword123`

**Kya-kya test karein (checklist):**
- Settings → Backup: "Backup now", schedule save, backup Restore (Override ON karke).
- Command theme me mouse pointer dikhta hai.
- Users & Access se coordinator, plant manager, procurement, accounts banayein, har login se:
  - Vendor & Client Registration → documents attach → Submit & freeze → edit block;
    accounts se Unlock.
  - Supply → Plant Stock → Items, Machines, GRN, Issue to machine.
  - Plant transport sheet aur Coordination (manufacturing) me same vehicle/date → ✓ badge.
  - Reports → Report Builder → report chalayein → PDF aur Excel download.

---

### Aapke liye sawal (confirm kar dijiye)

1. Coordination team ko ab **manufacturing register** bhi dikhta hai (aapne "coordination team
   ke manufacturing wale sheet" bola tha). Pehle ye sirf admin/accounts ko khulta tha. Theek hai?
2. Stock me **plant manager** ko items/machines add karne ki permission di hai, edit/adjust nahi.
   Aap chahein to sirf procurement ko hi rakhein.
3. Plant sheet me weight **MT** me ho aur coordination me **kg**, to match ke liye 200 se kam
   value ko MT maana hai. Agar plant kg me hi likhta hai to koi dikkat nahi.
