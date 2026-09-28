# BIOME ERP — Update 28 Sep 2026

## 1. WhatsApp documents save nahi ho rahe the — asli wajah aur fix
Ye 4 bugs mile (sab fix):
1. **OCR internet se model download karta tha.** Net slow/firewall/offline par download fail →
   OCR hamesha ke liye atak jaata tha → queue ruk jaati thi → uske baad ka koi document save nahi hota tha.
   Ab app ke saath aaya offline model use hota hai, har read par time-limit hai. Internet ki zaroorat nahi.
2. **Scanned PDF ka English model purana tha** aur naye OCR engine ko crash kar deta tha. Ab sahi model.
3. **Sirf "sales" naam wala group auto-select hota tha.** Aapka group "Supply" hai → kuch watch hi nahi hota tha.
   Ab sales / supply / dispatch / documents naam wale group, aur koi na mile to saare groups.
4. **PC/app band tha tab aaye messages skip ho jaate the.** Ab pichhle 7 din ke messages app chalte hi process hote hain.

Test: sample invoice → 96% confidence se "Vendor Tax Invoice", reference `BDC/45/JSR/15` pakda gaya.
**Zaroori:** WhatsApp → Chats me dekh lein ki Supply group ✓ selected hai.

## 6. WhatsApp document ↔ Coordination entry (reference se auto-link)
- Coordination trip me **Coordination reference** field (khali chhodo to trip se khud banta hai:
  BDC / hamara doc no / vendor code / vendor doc no).
- Trip save hote hi — document pehle aaya ho ya baad me aaye — us supply ke saare WhatsApp documents
  trip ke andar **category-wise** (Our documents / Vendor documents / Transport & weighment / Client side) dikhte hain.
  Click karke document khulta hai.
- Staging me ruke vendor papers trip save hote hi supply set folder me file ho jaate hain.
- Har document trip ke data se match hota hai (vehicle, date, doc no, weight, amount, client).
  Farak ho to ⚠ warning trip me aur register ke upar "WhatsApp documents disagree" section me.
- Jo papers nahi aaye unki list + "Ask the vendor" button.

## 2 & 4. Developer → Data (delete)
- Module choose karo (coordination, WhatsApp docs, plant sheets, stock, registrations, PO, imprest, payroll…)
  → **10 second warning** (server bhi 10 sec se pehle mana karta hai) → DELETE type karo.
- Delete se pehle **automatic backup** (Settings → Backup se wapas la sakte ho).
- Logins, plants, number series, settings, WhatsApp link, passwords, backups kabhi delete nahi hote.
- **Delete one record:** vendor/client registration (frozen bhi), client, coordination trip, PO.

## 3. Number series (Tally jaisa)
- Coordination → Number series: **Add a series**, naam / pattern / padding / start / FY restart / trading-manufacturing edit.
- **Numbering method:** Automatic · Automatic (Manual Override) · Manual.
- Doc type / series chunte hi agla number turant dikhta hai; automatic me save par number lagta hai.
- Number lagne ke baad type/series badla → "Re-number" (purana number void, kabhi reuse nahi).

## 5. Follow-ups (Partners → Follow-ups)
Pending tax invoice (challan aaya invoice nahi), credit note pending (debit note ke against), supply documents missing,
KYC papers, PO khatam / expiry / extend request / closed notice — ready message ke saath.
**Send email** (Settings → Mail) ya **Send WhatsApp** (company number se; agent off ho to WhatsApp message ready khulta hai).
Har message ka log.

## 7. Developer → Server & devices
- Server: address (dusre device isi se connect), data folder, disk, uptime, last backup.
- **Saare devices** (desktop app, browser, phone): kaun, kis IP se, version, online/offline.
- Control: message bhejo, reload karao, sign out, user ko har device se sign out, **block device**, rename, forget.
- "Make this PC the server" — desktop app me isi tab me.

## 8. Android app download
Top bar me **Android app** button → APK download. GitHub build APK bana ke installer me daal deta hai;
naya APK Developer → Server & devices se upload bhi kar sakte ho.

## 9. Plant (sidebar me alag category)
Biomass entry · Transport entry · Stock (spare parts & stores) · Plant vendors & clients.
Stock GRN par **purchase invoice / kanta parchi upload** (PDF/photo); ledger me 📎 se koi bhi (stock access wala) khol sakta hai,
baad me bhi "+" se attach. Access: plant users, procurement, ya developer jisko de.

## 10. Naya version sabko
Server PC par naya app install karo → Developer → Server & devices → "Reload all" → sab devices naye features ke saath.
Desktop installer badla ho to .exe upload + **Publish & notify** → har user ko "Download & install" + notice.

## 11. OCR scanner
Offline OCR theek chal raha hai (test: 90% confidence). "Kharab hai" wala galat banner hataya.
Behtar AI reading ke liye **free Gemini key**: aistudio.google.com/apikey → Settings → AI OCR Engine me paste → Save
(verify hoti hai, encrypted save; OCR aur WhatsApp dono use karte hain, restart nahi).

## 12. Close (✕) button hilna — fix
Close button par galat hover animation lagi thi jo button ko upar khiskati thi. Ab button apni jagah rehta hai.
