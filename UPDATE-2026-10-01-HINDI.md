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
  (ya aapka port **30359** → server PC port **4173**) — app dono try karta hai.
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
