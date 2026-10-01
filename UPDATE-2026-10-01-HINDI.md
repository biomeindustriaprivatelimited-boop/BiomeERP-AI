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
