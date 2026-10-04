# Update 01-10-2026 — Server/Client login fix + WhatsApp auto-filing fix

## 1. Doosre PC par login nahi ho raha tha — kyun?
Naya install apne aap **server** ban jaata tha aur apna khaali user database bana leta tha.
Isliye server PC par banaye user ID doosre PC par "galat" batate the — wo PC asli server se
juda hi nahi tha.

### Ab kya hota hai
- **Naya PC (jisme Biome ka data nahi hai)**: pehli baar khulte hi "Connect to the Biome server"
  screen aati hai. Server ka address daalo → Test → Connect. Ye PC ab **client** hai — data
  sirf server PC par rahega.
- **Server PC**: jahan developer login hai. Developer ka login **server PC par permanent** rehta
  hai (app band/restart karne par bhi) — jab tak aap khud Sign out na karein. Baaki sab accounts
  (aur client PC par developer bhi) normal 8 ghante ke session wale client hain.
- **Server band ho to**: client PC aur Android par "Server connection lost / The server is not
  answering" screen aati hai aur server wapas aate hi apne aap jud jaata hai.
- Login screen par neeche dikhta hai ki ye PC kis server se juda hai, aur **"Change server"**
  button hai. Jo PC pehle galti se apna server ban gaya tha, wahan isi button se asli server
  ka address daal dein.
- Server PC par pehli baar Windows ek permission maangega (firewall me port 4173 kholne ke
  liye) — **Yes** dabayein, warna doosre PC/phone jud nahi payenge.

### Doosri location — office static IP se (koi extra app nahi)
Remote Desktop jaisa hi tareeka:
1. **Router me ek baar:** Port Forwarding → external port **4173** → server PC ka office
   address (jaise 192.168.1.50), port **4173**, TCP. Server PC ka office address fixed rakhein
   (router me DHCP reservation) — jaise Remote Desktop ke liye kiya hai.
2. **Server PC:** Biome → Settings → Server & Sync → "Office static IP" me **Detect** dabayein
   (ya IP khud likhein) → **Save**. Neeche `http://<static-ip>:4173` dikhega — copy kar lein.
3. **Client PC:** Biome install karke pehli screen par sirf static IP likhein → Connect.
   **Android:** app me wahi static IP daalein. Port 4173 apne aap lag jaata hai.
4. Login ab internet se khula hai, isliye strong password rakhein. 8 baar galat password par
   wo user ID 15 minute ke liye lock ho jaata hai.

## 2. WhatsApp documents supply set me save nahi ho rahe the
- **Hamara apna invoice vendor ka samjha ja raha tha** jab OCR GSTIN ka ek akshar galat padhta
  tha (jaise `…H1Z5`), ya photo me GSTIN kat gaya tha. Phir wo "hamare invoice ka intezaar"
  me khud hi atak jaata tha aur poora supply set nahi banta tha. Ab GSTIN ko PAN
  (AAJCB1927H) se pehchana jaata hai, OCR ki galtiyon ko maaf karke, kisi bhi state code ke saath.
- **Jis page par reference (BDC/…) chhapa hai par heading padhi nahi gayi** — wo ab hamara
  document maana jaata hai aur supply set me file hota hai ("Not a document" me nahi jaata).
- **Pehli baar link karne par aaye purane documents gum ho jaate the** (group list load hone se
  pehle). Ab rok ke rakhe jaate hain aur group select hote hi process hote hain.
- Jo group select nahi hai, uske documents chhodne par log me saaf likha aata hai:
  `ignoring documents from "<group>" — this group is not selected`.

Log file: `%APPDATA%\Biome\logs\whatsapp-agent.log`

## 3. Pehla login (naya server PC)
- Naye server PC par pehli baar: **User ID `developer`**, **Password `biome-admin`**.
  Login screen par ye hint sirf server PC par dikhta hai (internet/doosre PC par nahi).
- Login ke turant baad apna naya password set karna padega (kam se kam 8 akshar).
- Developer → Users me sabke user ID / password banayein. Wahi ID-password har client PC,
  phone par chalega, aur tab tak same rahega jab tak developer/admin khud na badle.
- Client PC par koi default ID nahi hoti — wahan sirf server ke banaye ID se login hota hai.
- Purane server (jisme pehle se users hain) par koi naya default account nahi banta.

## 4. Zero-setup connection (WhatsApp jaisa — kuch type nahi karna)
- **Server PC (sirf ek baar):** app install karo → pehli screen par "This PC is the main office
  server" (ya jo PC pehle se server hai wahan kuch nahi) → `developer` se login. Bas.
  Jis PC par developer signed in hai **wahi server** hai.
- **Baaki har PC / phone:** app install karo → user ID + password se login. Koi address,
  koi setting nahi:
  - office Wi-Fi/LAN par app server ko apne aap dhundh leta hai (network discovery);
  - bahar kahin bhi app me built-in office static IP (122.180.246.211) se judta hai.
- **Router:** server PC router se khud port 4173 kholne ki koshish karta hai (UPnP).
  Settings → Server & Sync me "Automatic setup" me dikhta hai ki hua ya nahi. Agar router ne
  mana kiya, to ek baar router me port forward: external **4173** → server PC, port **4173**
  — app me ab external port **30360** bake hai: router rule **30360 → 192.168.1.5 : 4173 (TCP)**. 30359 Remote Desktop ka hai, use nahi kar sakte.
- **Developer server PC par signed out / server PC band:** client PC aur phone par login nahi
  hoga — "Server PC is not ready" ya "Server connection lost" dikhega, aur ready hote hi
  apne aap hat jaayega.
- Galti se server ban chuka koi aur PC, asli server (developer signed in) milte hi apne aap
  client ban jaata hai.

## 5. Developer password bhool gaye? (offline, sirf server PC)
- Server PC ki login screen par **"Forgot developer password?"** → developer ka user ID + 3 sawaal:
  1. Company ka GSTIN number? (06AAJCB1927H1ZS)
  2. Company ka pehla plant? (Mayan)
  3. Kisi ek director ka poora naam? (Tanesh Singh Dod / Shubham Goel)
- Sahi jawab → password **biome-admin** ho jaata hai; login ke turant baad naya password set karein.
- Settings → **Developer password recovery** me apne khud ke 3 sawaal-jawab set kar dein —
  phir built-in sawaal kaam nahi karenge.
- Ye option doosre PC / phone / internet par dikhta hi nahi. 5 galat koshish par 15 minute lock.

## 6. Baaki fixes
- Business Profile me directors ki photo — login wali rok ki wajah se image load nahi hoti thi; fixed.
- Top-right user name ka menu — screen ke neeche khul raha tha (dikhta nahi tha); ab chip ke neeche khulta hai.
- Plant transport sheet ↔ coordination match — plant ab "From plant" (naya field), reference
  (BDC/45/REW/15), ya gaadi number se pehchana jaata hai; date ±2 din (entry ya invoice date);
  dispatch weight ↔ invoice/challan weight aur R. Weight ↔ receiving qty dono check.

## 7. WhatsApp — final fix (03-10-2026)
**Kyun kaam nahi kar raha tha:** WhatsApp ne groups ko naye "LID" system par shift kiya hai. Jo library
(Baileys) WhatsApp ka protocol khud banati hai, wo linked device par in groups ke messages decrypt hi
nahi kar paati thi — message aate the par khaali, aur chupchaap gaayab. Upar se hamari ek setting
(history sync) ne zaroori LID mapping bhi rok rakhi thi.

**Ab:** agent asli **WhatsApp Web** ko PC ke **Microsoft Edge** (har Windows me hota hai) me chupke se
(bina window) chalata hai — decryption WhatsApp ka apna code karta hai, isliye jo WhatsApp Web me
dikhta hai wahi agent ko milta hai. Edge/Chrome na mile tabhi purana engine (setting fix ke saath).

Aur:
- Vendor ka paper hamare invoice ke BAAD aaye to turant usi supply-set folder me jaata hai
  (pehle 20 minute "held" padha rehta tha — bahar se lagta tha kuch save hi nahi hua).
- Connect hote hi / group select karte hi selected group ke pichhle 7 din ke documents bhi padhe jaate hain.
- Har build me GitHub ke Windows PC par asli Biome.exe se test hota hai: documents → supply set →
  folder, scanned PDF (OCR), aur Edge me WhatsApp Web ka QR.

**Aapko ek baar karna hai:** naya .exe install → WhatsApp page → QR dikhega (naya engine = naya
linked device) → phone se scan karein. Phone ke "Linked devices" me purana "Biome Platform"
device ho to use hata dein. Diagnostics me "Engine: WhatsApp Web (msedge.exe)" dikhna chahiye.

## 8. 04-10-2026 — 14 points
1. **Plant manager home**: naya "Plant home" — aaj ki biomass/transport entries, vehicle mismatch, low stock + shortcut tiles (Biomass, Transport, Imprest, Stock, Registration, Follow-ups, Attendance, Employees, Leave, Reports, Documents, Help).
2. **Naam suggestion**: plant manager jo vendor/transporter/client register karta hai, uska naam biomass sheet (vendor) aur transport sheet (transporter, party) me 2 akshar type karte hi suggest hota hai — sirf usi plant ka; trading aur doosre plant ka data kabhi nahi milta.
3. **Client PC**: ek baar server mil gaya / "Connect to server" se address daala to wahi yaad rehta hai; login par sirf User ID + password.
4. **WhatsApp**: chat select na hone ke 5 kaaran theek; ab har chat par ek click "Watch" switch (turant save, Undo), groups + people, search/filter, naya page — summary cards + 7 tabs.
5. **Plant manager imprest**: "New imprest entry" ab dikhta hai (holder apne aap banta hai); apne plant ke holders ke liye bhi entry.
6. **Budget**: admin/developer — employee / plant / category / designation / department / company, monthly/quarterly/yearly/custom; budget se zyada entry ruk jaati hai, admin/developer "Over budget" tab se approve/reject. Report Builder me "Budget vs actual" aur "Over-budget approvals".
7. **Role access**: har feature ki line par Active/Inactive, buttons Activate / Deactivate.
8. Jo option user ke liye nahi hai ya freeze/off hai, wo uske sidebar, search, hub, home me dikhta hi nahi.
9. Mouse ke saath ghoomne wala circle hata diya.
10. **Plant ke employee**: plant manager apne plant ka employee add kare → admin/developer approve karein tab active; phir uski attendance, leave, imprest plant manager sambhalta hai.
11. **Attendance**: plant manager ko apne plant ki sheet; naya Cards + Register view, mark menu, "Mark all present", summary, Excel/PDF, month lock; rules (week-off, late, back-dated days…) sirf developer.
12. **Holiday announce**: theek kiya (calendar + attendance me Holiday lagta hai, email optional); sirf developer/admin.
13. **Coordination import**: "Import data" → Excel template (Trading/Manufacturing) → har row ka check: Complete / Missing data (kya missing) / Error (vendor registered nahi, duplicate…) → "sirf complete rows" ya "missing data ke saath" import, ya Cancel.
14. **Server PC**: X dabane par app band nahi hota — server tray (ghadi ke paas Biome icon) me chalta rehta hai; Windows ke saath apne aap start; tray me "Stop server & quit" se hi band (clients ko "Server connection lost" dikhega).

## 9. Developer account security (04-10-2026)
- **Server PC par developer kabhi apne aap logout nahi hota** (login har hafte apne aap naya hota hai).
- **Developer logout kare tab bhi server server hi rehta hai** — clients/Android kaam karte rehte hain.
  Server tabhi badalta hai jab developer kisi **doosre PC** ko server bana kar wahan login kare **aur us PC
  par company ka data ho** (backup restore). Khaali naya PC kabhi server nahi chheen sakta.
- **Lock**: user menu → "Lock now", tray → "Lock Biome now", aur window tray me jaate hi lock.
  Auto-lock: developer ke liye hamesha (default 5 min, band nahi ho sakta); baaki users Security me chun sakte hain.
  Lock sirf us PC ka hota hai — server sabke liye chalta rehta hai.
- **8-digit MPIN** (har account): user menu → "Security & MPIN" → MPIN + password se set.
  Jis PC/phone par pehle password se login kiya ho wahan logout ke baad MPIN se login aur unlock.
  **Naye PC par hamesha User ID + password.** 5 galat MPIN → MPIN block, password se login karne par khulta hai.
  Aasaan MPIN (11111111, 12345678…) nahi chalta.
- Installed app me developer tools / menu shortcuts band — koi PC par baith kar andar se cookie ya data nahi chhed sakta.
