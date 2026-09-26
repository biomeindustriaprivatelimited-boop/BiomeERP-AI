
## 16 Aug (4) — vendor/transporter registration (#11) aur Documents (#10)

### #11 — Registration (sidebar me "Registration")

**Purane vendor master se alag kyun rakha:** `vendors` wala record
**operational** hai — chhota code jo coordination reference me chhapta hai,
taaki WhatsApp pe aaya document supplier se match ho. Coordinator ko wo
har waqt chahiye.

Ye **commercial** record hai: company kaun hai, GST/PAN dekha gaya ya
nahi, kya tay hua aur kis rate pe, aur signed purchase agreement khud.
Aapne kaha tha coordinator ko iska access nahi hona chahiye — signed rate
card us aadmi ke padhne ki cheez nahi jo weight slip chase kar raha hai.

Access: **admin, accounts, plant manager. Coordinator ko nahi.** Guard
permission pe hai (`partners`), sirf menu se link nahi hataya — URL type
karke bhi 404 hi milega.

**Onboarding ek status hai, checkbox nahi.** Company `Draft` me baithti hai
jab tak asli kaagaz file pe na ho. **Active tab tak nahi ho sakti** jab tak
ye na ho: purchase agreement (transporter ke liye transport agreement), GST
certificate, PAN, cancelled cheque, aur GSTIN/PAN/bank details bhare hue.
Card pe saaf likha aata hai kya-kya baaki hai.

Wajah seedhi hai: **jis account ko cancelled cheque se milaya hi nahi gaya,
usme payment chala jaana is register ki rok sakne wali sabse mehngi galti
hai.** Aur adhoora folder khaali folder se bura hai, kyunki wo poora dikhta
hai.

Aur ek alag rule: **plant manager register kar sakta hai aur kaagaz laga
sakta hai, par "Active" mark karna accounts/admin ka kaam hai** — wahi
separation jo baaki app me chalti hai.

**Expiry chase hoti hai.** Har paper ki validity date rakhi jaati hai;
expire ho gaya to activation ruk jaata hai (file hone aur *chaalu* hone me
farq hai), aur 30 din pehle warning aati hai.

**GSTIN/PAN/IFSC pe sirf SHAPE check hai** — typo pakadta hai, registration
verify nahi karta. Screen pe bhi wahi likha hai: *"Looks like a GSTIN — the
shape is right, not the registration."* Regex se "GST verified" likhna jhooth
hota.

Chhoti baat jo mayne rakhti hai: document **delete karne pe row hatti hai,
file disk pe rehti hai** — galti se delete hua signed agreement wapas na
aana bahut bura hota, aur folder waise bhi backup me jaata hai.

### #10 — Documents me plant manager ki taraf ke documents

Har uploaded paper pe **uploader ka plant stamp** hota hai. Documents page
pe naya filter: **"Vendor & transporter papers"**.

- Plant manager ko dikhta hai: **jo unke site ne upload kiya**, aur unke
  saath kaam karne wale partner ke liye **centrally rakhe gaye** kaagaz.
  Head office wala agreement chhupana — jiske under wo kaam kar rahe hain —
  bekaar se bhi bura hota.
- Baaki sabko sab dikhta hai.
- Coordinator ko ye endpoint 404 deta hai, aur page us failure pe **chup
  rehta hai** — warna unki poori Documents screen khaali ho jaati.

Panel me source ab "Registration · uploaded by <naam> · <plant>" dikhata hai.

### Verify

```
npx next build     ✓ pass — /partners 9.9 kB, /documents 10.2 kB
tsc --noEmit       ✓ 0 error
npm run check      ✓ 159/159  (22 naye check, incl. coordinator ko partners access nahi)
```

### Ab bhi baaki (aapki original list se sab ho gaya)

attendance sheet UI polish · machinery stock · task assignment ·
production-vs-purchase report · Tally TDL sales + period selector ·
ledger-agent UI wiring

**Tally TDL aur ledger-agent** aapke live Tally ke bina main likh sakta
hoon par chala kar dekh nahi sakta — unhe "ho gaya" main nahi kahunga.


## 16 Aug (3) — backup/restore (#3), state-wise holidays (#7), support reopen + email (#8)

**Zaroori: is baar `npm install` phir chalana padega** — `jszip` ab
package.json me hai.

---

### #3 — Backup aur Restore

Settings me naya section. Poore data folder ka ek zip.

**Teen faisle jo jaan lene chahiye:**

1. **WhatsApp login backup me kabhi nahi jaata.** `whatsapp/auth` khud wo
   account hai — jiske paas ye files hain wo company ka WhatsApp padh sakta
   hai. Wo zip pen drive pe, Drive pe, mail me ghoomta hai. QR dobara scan
   karna isse kahin chhota risk hai. Mail password aur cloud token bhi
   bahar hain. **Restore ke baad ye jo machine pe hai wahi rehte hain — QR
   dobara scan nahi karna padega.**

2. **Restore kabhi upar se nahi likhta.** Purana folder pehle side me
   *move* hota hai (delete nahi) aur uska naya rasta screen pe bataya jaata
   hai. Zip pehle ek naye folder me khulti hai; kahin bhi atka to **live
   folder ko haath tak nahi lagta**. Aadha-adhoora restore do mahine ka
   mixture chhod deta aur kabhi pata nahi chalta konsi row kahan se aayi.

3. **Backup likhne ke baad padh kar dekha jaata hai** — zip wapas kholi
   jaati hai aur files gini jaati hain. Count na mile to zip **delete kar
   di jaati hai**, kyunki ek kharaab backup ka "backup hai" dikhna hi
   sabse bada khatra hai. Jis din pata chalta hai usi din zaroorat hoti hai.

Restore ke liye **Override chalu hona chahiye** aur `RESTORE` type karna
padega. Pehle ek dry-run dikhata hai ki kya-kya hoga. Ye is app ka akela
button hai jo mahine bhar ka kaam kha sakta hai — wo backup banane wale
button se ek click door nahi hona chahiye.

Ek chetavni jo screen pe bhi likhi hai: **backup usi disk pe rakhna backup
nahi hai.** Download karke kahin aur rakhiye.

### #7 — Public holidays states ke hisaab se

Asli dikkat mili: state **code me hard-code thi** —
`if (code === "REW") return "HR"`. Matlab aap teesra plant add karte to
uske log **chup-chaap Delhi ke calendar** pe chale jaate — apne hi state
ki chhutti pe absent mark hote, aur jis din unka state band tha us din ka
paisa bhi galat banta.

Ab **plant ek record hai** (`lib/plants.ts` + `/api/plants-master`) aur usi
pe uska **state** likha hai. Plant add karna ab data hai, code nahi. `HR`,
`MH`, `DL` ke saath UP, PB, MP, RJ, GJ bhi list me hain.

- Chhutti state ki hoti hai, aadmi apne plant ke state ko follow karta hai
- Plant ka state badla to audit me **alag line** banti hai, kyunki uska
  asar mahino baad dikhta hai
- Jis plant pe abhi log lage hain use band nahi kiya ja sakta — pehle unhe
  hataiye (warna unki attendance aati rehti aur plant picker se gayab)

`HolidayRegion` ab fixed union nahi, plain string hai. Union rakhta to naya
state daalte hi uske log Delhi pe chale jaate — wahi bug dobara.

### #8 — Support: dobara uthana, aur dono taraf email

**Reopen:** resolved/rejected/closed message pe jawab likhiye — wahi
message dobara khul jaata hai, **nayi status "Reopened"** ke saath. Ye
`accepted` pe wapas nahi jaata: tracker dekhne wale ko **aage badhta**
dikhna chahiye, aur desk ko ek nazar me dikhna chahiye ki unka pehla jawab
kaam nahi aaya. **Kitni baar khula, wo bhi ginta hai** — teesri baar wapas
aayi query pehli baar wali se alag baat hai.

Settled message pe ab saaf likha aata hai: *"Did this actually sort it?"*
aur button bhi "Reopen with this reply" ho jaata hai.

**Doosre ki taraf se query:** labour ke paas login hi nahi hota. Ab plant
manager aur accounts unki taraf se query utha sakte hain. Plant manager
**sirf apne plant ke** logon ke liye — warna ek manager doosre site ke
labourer ke naam se shikayat file kar sakta tha.

**Email dono taraf, har movement pe** — raise, reply, status change,
reopen, resolve. Do niyam:

- **Email fail hone se kaam kabhi nahi rukta.** Ticket pehle save hota hai,
  email baad me, aur result ticket pe likha jaata hai — "use bataya gaya ya
  nahi" ka jawab hai, kandhe uchkana nahi. Jis din SMTP password expire ho
  us din query hi na uth paaye — is module ki sabse buri haar wahi hoti.
- **Apne hi kaam ka email kisi ko nahi jaata.** Jisne abhi Resolve dabaya
  use "resolved" ka mail bhejna bekaar hai, aur jo desk khud ko mail karta
  hai uska address log filter kar dete hain.

Resolve wale mail me saaf likha jaata hai: agar isse baat bani nahi, to app
me jawab likhiye, wahi message dobara khul jayega — **nayi query mat
uthaiye**, warna purana jawab alag pad jaata hai.

### Verify

```
npm install        ← zaroori (jszip)
npx next build     ✓ pass
tsc --noEmit       ✓ 0 error
npm run check      ✓ 137/137  (20 naye check)
```

### Ab bhi baaki

#10 documents (plant manager ki taraf se upload) · #11 biomass vendor aur
transporter registration (coordinator ko access nahi) · attendance sheet UI
polish · machinery stock · task assignment · production-vs-purchase report ·
Tally TDL + ledger-agent wiring (aapke live Tally ke bina test nahi ho sakte)


## 16 Aug (2) — DEVELOPER ROLE + per-user access (aapke #1 aur #6)

### Sabse pehle: developer account kaise banega

```
node tools/biome-admin.js --developer
```

Username `developer`, password `biome-admin` (pehli login pe badalna
padega). Ya apna: `--developer=mypassword123`.

**Sirf yahin se ban sakta hai** — data folder wali machine se. App me koi
screen nahi hai aur **admin ise bana bhi nahi sakta**. Agar admin bana
sakta, to wo khud ko wapas wo sab de leta jo is round me uske haath se
nikala gaya — aur poori kawayad bekaar ho jaati.

### Admin ke haath se kya nikla — sirf 4 cheezein

`access.grant` · `feature.switch` · `announce` · `developer`

Jaan-boojh kar chhoti list rakhi hai. Admin apna rozmarra ka kaam pehle
jaisa karta rahega — log add karna, password reset, approvals, override.
**Jo admin apna kaam hi na kar paaye, wo seedha developer account maangega,
aur phir in sab ka koi matlab nahi rahega.**

Ab admin **role badal nahi sakta** — na kisi ka, na naya developer account
bana sakta hai. Server refuse karta hai, sirf button chhupaya nahi gaya.

### Developer chhupa hua hai

- Kisi aur ki **user list me developer account aata hi nahi** — filter API
  me hai, page me nahi, taaki raw response me bhi na dikhe
- **Role list me "developer" option nahi** milta kisi aur ko
- Admin ne agar id guess bhi kar li, to us account ko edit karne par
  **404** milega — warna admin usi account ko disable kar deta jo access
  control rakhta hai
- `/audit` me developer ki entries **kisi aur ko nahi dikhtin**
- `/developer` page pe koi aur jaaye to middleware **404** deta hai, 403
  nahi — 403 bata deta ki page hai

### Ek cheez jo maine aapke kehne se thodi alag ki — aur kyun

Aapne kaha tha developer ki activity kisi ko dikhe nahi. Wo poora hua.
**Par maine record likhna band nahi kiya.** Developer ki activity ek alag
`developer/activity.jsonl` me jaati hai jo sirf developer padh sakta hai
(uske apne page pe "My activity" tab).

Wajah: jo record likha hi na gaya ho, wo baad me nikala nahi ja sakta. Agar
kabhi ye account kisi bahari aadmi ke paas gaya, to "kisi ko nahi dikhta"
suvidha nahi, **wahi problem ban jaata hai**. Aapko wahi mila jo aapne
maanga — admin ko developer ka kaam nahi dikhta — par record maujood hai.

Ek apwaad: **kisi doosre ke access me kiya gaya badlav aam audit log me
bhi jaata hai.** Jis aadmi ka access badla, use aur uske manager ko jaanne
ka haq hai. Wo developer ki niji baat nahi hai.

### #6 — kis user ko kya access

Har user pe ab **exceptions** rakhe ja sakte hain — role ke upar. Green =
role jo nahi deta wo de do, Red = role jo deta hai wo cheen lo.

**Poori permission list क्यों nahi rakhi, sirf exception rakhe:** agar har
user apni poori list rakhta, to aage kabhi "Coordinator kya kar sakta hai"
badalne par wo badlav har coordinator pe haath se lagana padta — aur jo
chhoot jaate wo chupchap purana access rakhte. Sirf **farq** store karne se
role hi sach ka source rehta hai, aur apwaad dikhta hi apwaad jaisa hai.

**Access badalte hi us bande ko dobara login karna padega.** Session token
me permissions chalti hain (page guard Edge runtime pe chalta hai, wo users
file padh hi nahi sakta). Isliye har user pe `accessVersion` hai — badalte
hi token purana ho jaata hai aur agli request "sign in again" se ruk jaati
hai. **Jo permission chheen kar bhi 8 ghante chalti rahe, wo chheeni hi
nahi gayi.**

Ek suraksha: developer-only key kisi aur role ko grant nahi ho sakti —
warna feature switch aur access control phir se ek mis-click door ho jaate.

### Feature freeze / disable

14 module switch ho sakte hain, teen halat me:

- **Live** — normal
- **Frozen** — khulta hai, dikhta hai, **save nahi hota**. Month closing ke
  waqt ke liye.
- **Off** — menu se gayab, server refuse karta hai.

Frozen me GET chalta hai — warna "read-only" ka matlab hi kya, wo to bas
outage hota accha naam ke saath.

**Login, audit log aur Help & Support is list me jaan-boojh kar nahi
hain.** Jis raste se log problem batate hain usi ko band kar dena, ek
chhote outage ko aisa outage bana deta hai jo kisi ko dikhta hi nahi.

Freeze karte waqt **message likhna zaroori hai** (10 akshar se kam nahi) —
bina wajah ka refusal sirf phone call paida karta hai, jo message bacha
leta.

### Notices — app + email

Developer notice likhta hai: Notice / New feature / Software update /
Warning / Maintenance. App me turant dikhta hai; **email alag button hai.**

Bhejna kabhi automatic nahi — jo timer ek rule galat laga de, wo chalees
logon ko wo cheez mail kar deta hai jo unhe nahi jaani chahiye thi, aur wo
wapas nahi aata.

Audience me **roles + plants = AND hai, OR nahi.** "Plant managers" + "REW"
ka matlab Rewari ka manager hai — har plant manager nahi. Galat padhna
Rewari wali warning poori company ko bhej deta. Naam se chune gaye log
group ko override karte hain.

Notice **pehle store hota hai, email baad me** — letters wale module ka
wahi niyam. Har aadmi ka email result alag likha jaata hai, to "use mila ya
nahi" ka jawab hai, kandhe uchkana nahi. Jiska employee record pe email
nahi, wo **"no email address" ke saath report hota hai** — chupchap skip
nahi, warna "sabko bhej diya" ka matlab hota "jinka pata tha unko".

### Verify

```
npx next build     ✓ pass — /developer 8.44 kB
tsc --noEmit       ✓ 0 error
npm run check      ✓ 117/117  (30 naye check)
node --check       ✓ biome-admin.js
```

### Baaki (aapki list se)

#3 backup/restore · #7 state-wise leave · #8 support reopen + email ·
#10 documents (plant manager side) · #11 vendor/transporter registration


## 16 Aug — WhatsApp double-invoice fix, plant master, access, sidebar

### #2 — double invoice aur "document open nhi hota" — EK hi bug tha

Screenshot me `Sales Haryana_BI-26-27-HR0996.pdf` **chaar baar** hai: do
"Biome Tax Invoice", do "Unclassified". Group me wahi file dobara share hoti
hai — coordinator bhejta hai, plant phir maangta hai, koi forward kar deta
hai, aur WhatsApp raste me PDF ko dobara compress kar deta hai. Har copy ek
alag document ban jaati thi.

Isse teen cheezein tooti thin:

1. **Count jhooth bolta tha** — ek invoice 4 baar aayi to "4 documents".
2. **Requirement count bhi jhooth** — 3/6 collected ek hi kaagaz teen baar
   aane par bhi dikh sakta tha.
3. **Kuch rows khulti hi nahi thin** — re-share aksar ek hi baar disk pe
   store hota hai aur kai ledger rows usko point karti hain; jis row ke paas
   apne bytes nahi, wo "file is no longer on disk" deti thi.

Ab re-shares **fold** ho jaate hain. Naya `whatsapp-agent/lib/setDedupe.js`.
Teen tarah ke saboot, aur teeno ko **transitively union** kiya jaata hai —
ye sabse zaroori hissa hai. Asli case me do copy invoice ke roop me classify
hui thin aur do nahi. Sirf invoice-number se group karte to pehli jodi milti;
sirf filename se karte to chaaron. Sabse strong key uthana **ek document ko
do me toड़ deta tha** aur set phir bhi over-count karta. Isliye union.

Filename sabse kamzor saboot hai aur uspe **veto** hai: agar ek hi naam wali
files me do alag-alag known document type hain, to naam ittefaq hai aur wo
alag hi rehti hain. Ek gaadi sach me weight slip + bilty + invoice le kar
aati hai — unko jodna galti sudharna nahi, asli set todna hota.

Kaun si copy rakhi jaati hai: **classified copy hamesha unclassified se
jeetti hai** (kyunki requirement count usi type se banta hai), phir jisne
zyada extract kiya, phir sabse pehli. Rakhi gayi row par **sabse pehla
arrival time** chipakta hai — teesre forward ka time dikhate to jo kaagaz
time pe aaya tha wo late dikhta.

Kuch delete nahi hota — copies `duplicates` me rehti hain aur card me
"3 re-shares folded" ke neeche khul jaati hain.

Aur `/file` ab: jis row ke bytes nahi mile, wo usi document ki doosri row
(same hash ya same filename) se serve kar deti hai.

### #4 — plant master aur budget month

Budget me sirf `REW` aa raha tha kyunki plant list **imprest holders** se
banti thi — jis site pe koi float holder nahi, wo picker me thi hi nahi. Ab
list plant master (`PLANTS`) se aati hai, aur holder records me likha koi
naya code end me jud jaata hai.

Budget me ab **"Runs from" aur "Until"** hain. Default us mahine ka jo aap
dekh rahe hain — warna August me budget banate hi wo July ke approved kharch
par chup-chaap laagu ho jaata aur ek breach dikhata jo kabhi hua hi nahi.

### #5 — plant manager se coordination hata

Coordination ab apni **alag permission** (`coordination`) pe hai. Pehle wo
`operations` pe thi, aur plant manager ko `operations` chahiye hi hai (plant
+ transport entry ke liye). Sirf link chhupana kaafi nahi hota — guard API
aur page dono par hai, isliye URL type karke bhi nahi khulegi.

Ab: admin, accounts, coordinator ke paas hai. Plant manager ke paas nahi.

### #9 — sidebar categories

Har category ab dropdown hai, animation ke saath. Do choti baatein jo mayne
rakhti hain: **band group jisme aapka current page hai wo dot dikhata hai**
(warna dhoondhne ke liye har group kholna padta), aur default **khula** hai
— naya section baad me juda to apne aap dikhega, chhupa nahi rahega.

Height animate ho rahi hai par ye surakshit hai: framer-motion apne content
ko naapta hai. Jo bug ek din le gaya tha wo CSS class thi jo max-height ko
ek **andaaze** ki value tak le jaati thi aur usse lambe panel kaat deti thi.

### Verify

```
npx next build     ✓ pass
tsc --noEmit       ✓ 0 error
npm run check      ✓ 87/87  (dedupe ke 8 naye check, screenshot wale asli case par)
node --check       ✓ agent.js, store.js, setDedupe.js
```


## 15 Aug (3) — Help & Support: attachments + admin status board

### Attachments

Ticket pe photo ya PDF laga sakte hain — 5 tak, 12 MB tak. "App kaam nahi
kar raha" ka jawab nahi diya ja sakta; wahi message screen ke screenshot ke
saath aksar ek reply me nipat jaata hai.

Do niyam jo mayne rakhte hain:
- **Store hone wala filename hamesha khud banaya jaata hai**, browser ka
  nahi — uploaded naam me path separator ho sakta hai aur wo folder se
  bahar nikal sakta hai.
- **Settle ho chuke ticket pe attachment nahi lagta.** Wo ab record hai;
  baad me kuch jodne ka matlab hai ki jis cheez par faisla hua tha wo badal
  gayi. Naya ticket uthaiye.

Colleague kisi aur ka ticket kholkar attachment nahi dekh sakta — salary
wali shikayat colleague ke padhne ki cheez nahi. Screenshot browser me
`inline` khulta hai, Downloads me nahi girta.

### Admin status board

Ek hi sawal ke ird-gird bana hai: **hamare upar kya atka hai.**

Sabse upar **"Never answered"** — kyunki helpdesk volume se nahi, khamoshi
se marta hai. Isme ek zaroori faisla hai: **jis insaan ne ticket uthaya,
uska apna reply "jawab" nahi ginta.** Jo aadmi teen baar apne hi ticket pe
likh chuka hai, use ab tak jawab nahi mila — aur agar board unko ginta, to
sab kuch chalta-phirta aur sehatmand dikhta jabki har koi intezaar kar raha
hota.

Baaki: 2 din se khamosh (sirf open wale), open + urgent, aur pehle reply ka
median time. Har status column apna oldest aur urgent/stale count dikhata
hai — laal tab jab koi ruka pada ho.

### Verify

```
npx next build     ✓ pass — /support 9.84 kB
tsc --noEmit       ✓ 0 error
npm run check      ✓ 78/78
```

### Baaki kaam

attendance sheet UI polish · Tally TDL sales + period selector ·
ledger-agent UI wiring · machinery stock · task assignment ·
production-vs-purchase report


## 15 Aug (2) — imprest budgets, admin override, aur do build-breaking bug

### Multi-PC sync — band

Aapne bataya server hai. To sync ka poora kaam list se **hata diya**. Ek
server, ek data folder, invoice number ek hi jagah se — sawal khatam.

Bas ek shart: sab log **usi server ko browser se kholein**. Agar har PC
apna app chala kar shared network folder pe likhega, to do process ek saath
JSON likhenge aur race hogi.

---

### Naya bug: aaj `npm install` karne par build fail ho jaata

`package.json` me `"typescript": "^5.5.4"` hai — floating range. Aaj install
karne par **TypeScript 5.9** aata hai. TS 5.7 se `Uint8Array` generic ho
gaya, isliye `lib/authToken.ts` ki ye line reject hone lagi:

```
crypto.subtle.verify("HMAC", await key(), base64UrlDecode(signature), ...)
```

`Uint8Array<ArrayBufferLike>` ko `BufferSource` nahi maana jaata (kyunki
SharedArrayBuffer ho sakta hai). Matlab **session verify wali file pe build
atak jaati**. Fix aisa hai jo purane aur naye dono compiler pe chale —
explicit ArrayBuffer allocate karke return type inference pe chhoda.

---

### Imprest budget

Mahine ka budget: **expense head** pe, **plant** pe, ya **ek holder** pe.

**Sabse ahem design faisla — approved paisa aur pending paisa alag ginte
hain.** Sirf approved ginte to 28 tareekh ko "₹40,000 bacha hai" dikhta,
jabki ₹38,000 ke diesel bill queue me pade hote. Approver sab pass kar deta
aur head over ho jaata — bina kisi ke ye faisla liye. Bar me **solid =
approved, faded = filed aur pending**.

**Block kuch nahi hota.** Block karte to wahi entry doosre head me file ho
jaati aur phir aankdon ka matlab hi khatam. Iski jagah approve button ke
**theek upar** likha aata hai:

> Approving this takes Diesel ₹4,300 past its monthly budget.

Ye warning usi response me aati hai jo entry draw karti hai — alag call
karte to card pehle bante aur warning button dabane ke baad aati.

Ek subject pe do live budget nahi ban sakte (dono same kharch claim karte
aur dono over dikhte). Advance/top-up kharch nahi ginta. ₹0 wala budget
100% used dikha kar screen laal nahi karta.

### Admin override — "edit anything" ka asli tareeka

Maine "admin hamesha sab edit kar sakta hai" **nahi** banaya. Jo admin
hamesha sab edit kar sakta hai, wo kabhi na kabhi galti se kuch badal dega
aur pata bhi nahi chalega.

Iski jagah **Override mode** (Settings me):

- Reason likh kar chalu karo — ek line se kam nahi chalega
- **30 minute**, phir apne aap band
- Upar banner chalta rehta hai jo minute ginta hai aur "Turn it off" deta hai
- Har change audit me `OVERRIDE_USED` ban kar aapke naam + reason ke saath

Isme coordination ka rule **sakht** hua: pehle admin frozen row seedha edit
kar leta tha, **ab usko bhi Override chalu karna padega** — warna jo freeze
baaki sab maante hain wo us ek insaan ke liye dikhawa hai jise sabse zyada
badalne ko kaha jaata hai. Tally import pe bhi wahi rule (import ek saath
kai row chhoota hai — chhoot dene ki sabse kharab jagah). Paid payroll month
reopen karne pe bhi Override chahiye.

**Override ye NAHI karta:** apni imprest entry, apni leave, ya apni edit
request khud approve karna. Wo separation-of-duty ke rule hain, purane data
ke lock nahi. Unko todne wala override poore app ke har approval ko bekaar
kar deta.

---

### Verify

```
npx next build     ✓ pass — /imprest 10.3 kB, /settings 17.6 kB
tsc --noEmit       ✓ 0 error, TypeScript 5.9 par
npm run check      ✓ 72/72
```

### Baaki kaam

help-desk restructure (attachments + admin status board) · attendance sheet
UI polish · Tally TDL sales + period selector · ledger-agent UI wiring ·
machinery stock · task assignment · production-vs-purchase report


## 15 Aug — COORDINATION: invoice/challan numbering, 2 registers, freeze, Tally import

Is round me **pehli baar poora `npx next build` chalaya gaya** — aur wo
fail ho raha tha. Neeche teen purane bug hain jo pehle se app me the.

---

### Pehle: 3 purane bug jo mile aur theek hue

**1. `npm run build` chalta hi nahi tha — matlab Windows installer ban hi nahi sakta tha.**

Next ke rule ke mutabik `route.ts` aur `page.tsx` sirf handler/component
export kar sakte hain. Par ye export ho rahe the:

- `app/api/support/route.ts` → `SUPPORT_TOPICS`, `STATUS_FLOW`, `Status`
- `app/support/page.tsx` → `relativeAge`

`npm run dev` ye kabhi nahi pakadta, sirf build pakadta hai. Isliye app
chalti thi par `npm run dist:win` fail hota. Topics/flow ab
**`lib/support.ts`** me hain.

**2. Payroll attendance save har baar 500 deta tha — jabki data save ho jaata tha.**

`app/api/payroll/runs/route.ts` ke PUT handler me `user` aur `action`
kabhi declare hi nahi hue the. Order ye tha:

```
saveRuns(...)        ← file likh di gayi
recordAudit({ action: `PAYROLL_${action...}` })   ← yahan crash
```

To attendance **save ho jaati thi**, phir 500 aata tha aur screen "failed"
bolti thi. Log dobara-dobara save kar rahe honge. Ab `findById` se user
padha jaata hai aur action fixed hai (`PAYROLL_ATTENDANCE_SAVED`).

**3. Notification bell — `kind: "error"` bhejne pe poora header crash.**

`lib/notifications.tsx` me kind sirf `success | info | warning` tha, par
`app/ocr/page.tsx` export fail hone pe `kind: "error"` bhej raha tha.
`KIND_ICON[n.kind]` undefined hota aur render pe throw karta — sirf wo row
nahi, poora header girta. Ab `error` dono map me hai.

Chhota: `lib/reconciliation.ts` me `matchedVia` ka type itna tang tha ki
teesri matching strategy (`party-amount-date`) compile hi nahi ho sakti
thi — wahi jo galat date pe padi payment dhoondhti hai.

---

### Number series — aapki sheet se

Sheet me numbers **neeche tak drag kiye hue** hain. Isliye "column ka
aakhri number" aur "asli me use hua aakhri number" alag hain. Seed hamesha
**used** se hui:

| Book | Format | Last USED | Sheet me khinchi hui |
|---|---|---|---|
| Tax Invoice (HR) | `BI-26-27-HR0786` | 786 | 02600 tak |
| Tally DC | `BIPL/2026-27/886` | 886 | — |
| NTPC Solapur DC | `BI/NTPC/SOL/039` | 39 | 0253 tak |
| NTPC Mouda DC | `BI/NTPC/MOU/088` | 88 | 0154 tak |

Neeche se seed karte to **1,800 invoice number ek saath chhoot jaate**.

Padding aapki hi shakl me rakhi hai: `HR0554` aur `HR01000` ek hi pattern
se bante hain (`BI-26-27-HR0{SEQ}`, count 3 digit pad). Ise "sudhaarna"
purani issued invoices se mel nahi khaata.

**Pakka niyam:** number kabhi dobara nahi milta. Cancelled trip apna
number rakhti hai aur register me cancelled dikhti hai — GST me book me
chhed hi pakda jaata hai.

**Trading aur manufacturing ki series alag NAHI hai.** Aapki sheet me
supplier "BIOME" wali rows (apna maal) usi invoice run me baithi hain, aur
invoice book GSTIN ka hota hai. **Register alag, numbering ek.** Alag
chahiye to boliye — series ab Manage screen se configurable hai.

### Do register

Trading = vendor se lekar client ko. Manufacturing = apna maal, **vendor
hai hi nahi** — server vendor ke saare field khaali kar deta hai. Ek hi
list me rakhne se per-supplier shortfall table aisa padhta tha jaise BIOME
khud se weight kho raha ho. Serial bhi alag chalte hain.

### Freeze — receiving date se 7 din

Aapne yahi kaha aur ye theek bhi hai: vehicle entry se ginte to jis row ka
receiving weight abhi aana hi hai wahi bante-bante lock ho jaati. Jis trip
ka receiving nahi aaya, uspe clock chalta hi nahi.

- Lock **server pe** lagta hai (423), sirf field grey nahi hota
- Coordinator reason likh kar request bhejta hai → admin approve/reject
- Approve = **sirf wahi ek row, 24 ghante**, aur ek baar save karte hi khatam
- Apni request khud approve nahi kar sakte
- Admin seedha edit kar sakta hai, par wo audit me alag action se dikhta hai
- **Import pe bhi freeze lagu hai** — warna file upload karke chupke se purani row badal jaati

### Client / vendor / PO

Dropdown ab **master se** aate hain, "jo pehle type hua tha" se nahi (isi
se SGE teen baar ban gaya tha). PO client ke andar rehta hai. Client
chunte hi: ek PO ho to apne aap bhar jaata hai, kai ho to chunwaata hai —
galat PO khud bhar dena bura hota. Wahin se naya client aur naya PO add
ho jaata hai. Naya client bina requirements ke banta hai aur form me saaf
likha aata hai ki requirements set karni hain.

### Tally import

Column mapping ke saath — order koi bhi ho, aur Tally ka format badle to
bhi chalta hai. Match: pehle hamara doc no, phir vehicle + aas-paas ki date.

**Jo match na ho wo nayi row KABHI nahi banati.** Warna ek supply do baar
gin jaati aur shortage ke saare aankde jhoote ho jaate — jo is module ka
poora maqsad hai. Do sheet row ek hi trip pe aayein to bhi rok deta hai.
`taxable + tax ≠ total` ho to saaf bolta hai ki mapping galat hai.
Date day-first padhi jaati hai (`01-08-2026` = 1 August, 8 January nahi).

---

### Verify kya hua

```
npx next build     ✓ poora pass, /coordination 17.6 kB
tsc --noEmit       ✓ 0 error (poore project pe)
npm run check      ✓ 57/57 pass
```

`npm run check` naya hai — `tools/check-coordination.mjs`. Aapke apne
numbers pe chalta hai: HR0554 se HR01000 tak padding, 36090→34020 wali
shortage row, day-first dates, aur ek hi vehicle ke do trip.

**Iski ek kamzori jaan lijiye:** ye checks plain JavaScript me logic ki
**nakal** hain (taaki plant PC pe bina kuch install kiye chalein). Agar
`lib/numberSeries.ts` badla, ye chup rah sakte the — isliye aakhri check
source file padh kar chaaron pattern aur count milaata hai. Logic badlein
to check bhi badalna padega.

---

### Ye abhi bhi khula hai

**Jab tak multi-PC sync nahi bani, invoice number sirf EK PC se issue
hone chahiye.** Series ek JSON file me hai. Do PC pe do copy hongi, dono
same invoice number nikaal lenge, aur kisi ko pata nahi chalega.


## 14 Aug (4) — BUILD ERROR FIX

`Truck` icon Sidebar me **do baar import** ho gaya tha. Ye compile error
deta hai, warning nahi — app chalti hi nahi.

Meri galti thi: Coordination ka menu item add karte waqt maine `Truck` import
kar diya, jabki Transport ke liye wo pehle se tha.

**Aur meri jaanch me ye pakda hi nahi ja raha tha** — mera check duplicate
import dekhta hi nahi tha. Ab wo check add kar diya hai:
- Ek import block me duplicate naam
- Do alag module se ek hi naam
- Duplicate top-level declaration
- Duplicate export

Poore project pe chalaya — **ab sirf yahi ek tha, aur wo theek hai.**

---

## 14 Aug (3) — panel bug, holidays, Drive

### Wo "chhota banner" — meri hi galti thi
Panel `bmx-msg-in` animation use kar raha tha. Us animation ke keyframes me
**`max-height: 120px`** aur `overflow: hidden` hai — wo ek chhote inline
message ke liye banaya tha. Poore screen wale panel pe lagane se panel khud
120px ka ban gaya. Screenshot me wahi dikh raha tha.

Ab panel ka apna animation hai (`bmx-screen-in`) jisme size ki koi limit
nahi. Saath me `bmx-msg-in` se bhi max-height hata di — wo 30 jagah use
hoti hai aur lamba message chupchap kaat rahi thi.

### Public holidays — ab pura control (point 2)
Leave page → **Public holidays**:
- **Add** — ek din ya **poora period** ("A period" toggle). Plant shutdown
  ek baar me add ho jayega
- **Edit** — date, naam, kis plant pe lagu
- **Delete**
- **Confirm button ab kaam karta hai** — pehle wo sirf dikhawa tha, ab wo
  sach me flag hata deta hai

Kis plant pe lagu — Rewari / Gangakhed / Office, alag-alag chun sakte hain.

### Google Drive — imaandari se, aur phir hal (point 3)

**Email aur password se login Google KHUD nahi hone deta.** "Less secure
app access" 2024 me band ho gaya. Koi bhi app jo Google password bhejta hai,
Google use mana kar deta hai. Ye app ki kami nahi hai, aur iska koi setting
ya jugaad nahi hai. Main aapko jhooth nahi bol sakta ki ye ho jayega.

Google sirf do raaste deta hai, aur **dono ab app me hain**:

**1. Browser se sign in** (pehle se tha) — ek baar consent screen.

**2. Service account** (naya) — **yahi aapke kaam ka hai**:
- Google Cloud se ek JSON file download kijiye
- Apne Drive me ek folder banaiye
- Us folder ko service account ke address se share kar dijiye (Editor)
- App me JSON aur folder link daal dijiye

**Uske baad koi browser nahi, koi consent nahi, koi password nahi.** App
khud jud jayegi, hamesha ke liye.

Ye asal me behtar hai: OAuth token tab mar jata hai jab aap apna Google
password badalte hain — service account nahi marta.

Screen pe step-by-step likha hai, aur JSON daalte hi wo address dikha deta
hai jise aapko folder share karna hai.

⚠️ Service account ka apna storage nahi hota — files aapke Drive me hi
rahengi aur aapka hi quota use karengi.

---

## 14 Aug (2) — Attendance rules aur Leave

### 2 baje ka lock
Employee 2 PM tak apni attendance laga sakta hai. Uske baad cell band.
**Accounts aur admin par ye lock nahi hai** — kisi ko galti sudharni hi
padegi, aur wo unka kaam hai.

Ye lock **server pe bhi lagta hai**, sirf screen pe nahi. Purane din ki
entry bhi employee nahi kar sakta.

### Reminder aur warning
Attendance → upar ek panel: aaj kis-kis ne nahi lagayi.

- **3 PM ke baad** — reminder mail (din me 3 baar tak)
- **Agle din 1 PM tak koi jawab nahi** — warning mail (ek hi baar)
- **Jisne attendance laga di ya leave apply kar di — usko kabhi mail nahi**
- **Sunday aur uske state ki holiday pe kisi ko mail nahi**

⚠️ Ye **button dabane se** jata hai, apne aap nahi. Ek galat rule aur 40
logo ko bina baat ki warning chali jaati — wo wapas nahi aati. Accounts
pehle list dekhti hai, phir bhejti hai.

### Leave (sidebar → Leave)
| Type | Limit |
|---|---|
| Sick leave | 2 din/mahina |
| Medical leave | 5 din/mahina (certificate zaroori) |
| Casual leave | 1 din/mahina |
| Earned leave | 15 din/saal |
| Compensatory off | koi limit nahi |
| Leave without pay | koi limit nahi (paisa nahi katega... milega nahi) |

Employee apply karta hai, **accounts ya admin decide karte hain**. Apni
leave khud approve nahi kar sakte — wahi rule jo imprest me hai.

**Sunday aur holiday leave me nahi gine jaate.** 10 se 16 August maanga to
7 din nahi, **5 working days** kategi.

Limit se zyada maanga to app **saaf mana karegi**, chupke se kam nahi
karegi — warna aadmi samajhta rahega ki uske paas 3 din hain.

### Public holidays
Rewari → Haryana, Gangakhed → Maharashtra, accounts/coordinator → Delhi.

⚠️ **Sirf 4 date pakki hain** — 26 January, 1 May, 15 August, 2 October.
Baaki (Holi, Diwali, Id, Ganesh Chaturthi…) chand ke hisaab se badalti hain
aur har state alag notify karta hai. Wo list **"confirm" mark ki hui hai** —
gazette se milakar theek kar lijiye. Main galat date daal kar kisi ki ek
din ki salary nahi katwaunga.

Ganesh Chaturthi sirf Gangakhed pe chhutti hai — Rewari aur Delhi wale us
din bhi attendance lagayenge. App ye samajhti hai.

**Test: 35/35 pass** — lock, caps, reminder ladder, holiday regions, sab.

---

## 14 Aug — weight slip fix, letters, panel UI

### Weight slip scan — ASLI WAJAH (point 2)
Mera code Tesseract ko **agent se alag tarike se** call kar raha tha.
Agent mahino se `createWorker("eng")` — bas itna — use karta hai aur chalta
hai. Maine `langPath` aur `cachePath` de diye the. `langPath` us folder pe
tha jisme sirf `eng.traineddata.gz` hai, aur saath me cachePath bhi — dono
milkar language data do jagah dhoondhte hain aur pehle hi pe fail ho jate
hain.

Ab bilkul wahi call hai jo agent me chalti hai.

**Aur ab reason bhi milega.** Pehle sirf "check failed" aata tha. Ab:
- File ka size, type, kitne second me scan hua, kitne word mile
- Slip pe kya-kya pada — vehicle, gross, tare, net
- Text hi na mile to: "photo blur hai / andhera hai / tirchi hai — flat
  rakhkar daylight me dobara kheenchiye"
- Text mile par weight na mile to **"Show what the scan actually read"** —
  usko kholkar mujhe bhej dijiye, main us weighbridge ki wording sikha
  dunga

### Letter templates (point 1)
Employees → naam → **Letters**. 14 ready templates:

**Joining** — Appointment, Joining, Confirmation
**Performance** — Appraisal, Increment, **Appreciation**
**Discipline** — Warning, Final warning, Attendance warning, Penalty
**Exit** — Termination, Experience, Relieving
**Other** — Salary certificate

Template pe click kijiye — draft **employee ke record se apne aap bhar
jayega** (naam, code, designation, joining date, salary, aaj ki date).
Phir edit kijiye aur **"Issue letter"** ya **"Issue and email"**.

Do cheezein maine jaan bujh kar rakhi hain:

1. **Adhoora placeholder chhupta nahi.** Agar `{{new_salary}}` nahi bhara,
   to app rok degi. Warna letter "Rs.  per month" likhkar chala jata.
2. **Jo bheja gaya wo word-for-word save hota hai.** Template baad me badla
   to purana letter nahi badlega.

Warning/termination/penalty pe **laal nishaan** hai aur upar guidance —
termination pe likha hai ki notice period, dues aur pehle ke warnings check
kar lijiye.

### Popup UI (point 5)
Aapka screenshot sahi tha — wo plain safed page tha. Ab:
- Header me icon, eyebrow, gradient rule, halka background wash
- Har section apne card me, apne icon ke saath
- Footer me destructive button (Freeze) **baayein**, safe buttons daayein
- Compliance badge header me

---

## 13 Aug (3) — top bar, cloud storage foundation, audit log

### Top bar (points 1, 2, 3)
- **Naya clock** — bada, monospace, seconds chhote font me. Din ki date upar.
- **Naya connectivity badge** — Online / No server / Offline.
  Ye sirf internet nahi dekhta, **BIOME server se sach me baat karke** dekhta
  hai. Plant ka wi-fi chalu ho par office ka link toota ho to purana tarika
  "online" batata — aur plant manager ek ghante ki entry dead connection me
  daal deta.
- **Black shadow theek** — search bar aur buttons `bg-white/[0.04]` use kar
  rahe the, jo dark theme ke liye bana tha. Light theme me wo grey film daal
  deta tha. Ab theme ke apne colours use hote hain.

### Audit Log (sidebar → Audit Log, admin only)
Har action, har bande ka, permanently. Kisi bhi tarah edit ya delete nahi ho
sakta — **document delete karne se uski history nahi jaati.**

Abhi record hota hai: login (success aur fail dono), imprest approve/reject,
user create/update/delete/password reset, payroll approve/reopen/paid, aur
saare cloud events.

Upar har bande ka activity count, phir filters (mahina, category, success/
failure, search).

### Cloud Storage — foundation (sidebar → Cloud Storage, admin only)
**Pehle CLOUD-SETUP.md padhiye** — Google ki taraf ka 10 minute ka setup hai.

Bana hua hai:
- Provider interface (Drive hard-code nahi — OneDrive/S3 baad me add ho sakte)
- Google Drive provider — resumable upload, update-in-place, trash, restore,
  quota, folder tree
- OAuth (signed state, 10 min expiry, refresh token **sirf server pe**,
  AES-256-GCM me encrypted)
- Admin-only page: connection, **asli quota** (15 GB maan kar nahi chalta),
  folder link, aur "ye kya karta hai / kya nahi karta"
- Conflict engine — **27/27 test pass**

⚠️ **Ye foundation hai, poora sync nahi.** Neeche imaandari se likha hai.

## 13 Aug (2) — Plant & Transport crash FIX

### Do crash the, dono meri galti
**Crash 1:** `SheetGrid` me maine `verifyRow` function likha jo `columns`
use karta hai — par `columns` uske **neeche** declare hota tha. JavaScript
me ye seedha error deta hai ("Cannot access 'columns' before
initialization"), aur poora page gir jata hai. Isliye Plants aur Transport
dono khulte hi crash kar rahe the.

**Crash 2:** `COMPARED` naam ki list ka declaration ek purane edit me gum
ho gaya tha — use ho raha tha par exist nahi karta tha. Ye tab girta jab aap
kisi cell me kuch type karte.

Dono theek. Saath me poore project me isi tarah ka check chalaya — aur
kahin ye galti nahi hai.

### Help & Support ka naya UI
- Upar **4 stat tiles** — Waiting, Urgent, Longest waiting, Settled this
  month
- **Filters** — Open / Urgent / Answered by me / Settled
- **Search** — subject, naam, ya reference number se
- Har ticket pe **topic ka icon** (salary, imprest, attendance, app problem)
- Har ticket pe **"waiting 3 days"** — aur 7 din se zyada ho to **laal**,
  kyunki wahi cheez log ko helpdesk chhodne pe majboor karti hai
- Behtar empty state — role ke hisaab se alag message

---

## 13 Aug — bug fixes

### OCR weight slip — ASLI WAJAH MIL GAYI (point 1)
Rewari sheet me upload column ka naam **`kantaParchi`** hai, par Gangakhed
me **`weightSlipCopy`**. Maine sirf Rewari wala naam code me likh diya tha.
Isliye Gangakhed me OCR kuch karta hi nahi tha — button dabate hi chup.

Ab column schema se apne aap dhoondha jata hai. Dono plant me chalega.

### Transport me weight slip (point 2)
Transport sheet me upload column **tha hi nahi** — isliye option nahi dikh
raha tha. Ab hai. Slip ka **net weight R. Weight se match** hota hai — yahi
shortage batata hai.

### Employee page crash (point 3)
`IdCard` icon naye lucide me hai, purane me nahi. Agar install kiya hua
version purana ho to wo `undefined` ban jata hai aur React poora page gira
deta hai — theek us waqt jab aap naam pe click karte hain. `Contact` icon
se badal diya (wahi dikhta hai, par har version me maujood hai).

Documents upload ka feature **pehle se hai** — Employees → naam pe click →
**Documents** tab. Crash ki wajah se aap wahan tak pahunch hi nahi paa rahe
the.

### AI OCR export (point 6)
Purana export har document ke har field ko **har row ka column** bana deta
tha. 100 mixed document = 40 column ki sheet jo 90% khaali. Aur poora
recognised text har row ke cell me — sheet khulti hi nahi thi.

Ab **document type se chhant kar** export hota hai:
Weight slips ki apni sheet, Lab reports ki apni, Tax invoices ki apni.
Har sheet me sirf uske apne column. Aage **Contents** sheet, peeche
**Could not read** aur raw text.

Button: **"Excel — sorted by type"**. Purana wala "Flat sheet" naam se
rakha hai.

### Sidebar (points 8, 9)
- **HR** naam ka naya section — Employees, Attendance, Payroll & Salary,
  Organisation
- Organisation Operations se hata kar HR me

### Imprest (point 7)
"Cash return" ab **"Money given back — I returned unspent cash"**.
Expense heads **12 se 33** kar diye — vehicle, machinery, material, people,
office, statutory ke groups me.

### Clients aur Vendors — coordinator ko pehle se hai (point 4)
Coordinator ke paas `vendors` aur `customers` dono permission pehle se
hain. Sidebar → Operations me dono dikhne chahiye. Agar nahi dikh rahe to
bataiye.

---
# BIOME PLATFORM — Complete App (11 August 2026)

Ye **poora app** hai, tukdon me nahi. Purana project folder hata kar
seedha ye use kar lijiye.

---

## Kya karna hai

**1.** Purane project folder ka naam badal dijiye — `biome_old`. Delete
mat kijiye, abhi rakhiye.

**2.** Is zip ka `biome_final_work` folder nikal kar rakhiye. Jagah aisi
chuniye jisme **space aur `&` na ho** aur OneDrive ke andar na ho:

```
C:\biome\biome_final_work
```

**3.** Terminal me:

```
cd C:\biome\biome_final_work
npm install
npm run dev
```

`npm install` me 3-5 minute lagenge.

**4.** Browser me `localhost:3000` kholiye.

**5.** Login: **admin** / **biome-admin**

Agar ye na chale (aapne pehle password badal diya tha):

```
node tools/biome-admin.js --reset
```

---



## 12 Aug (raat 2) — is round ka kaam

### ⚠️ `npm install` chalana zaroori hai (email ke liye)

### Employees ka apna dashboard (point 7)
Sidebar → **Employees**. Ab yahan sab kuch hai:
- **Add** — koi bhi (coordinator ko chhod kar). Plant manager sirf apne
  plant me add kar sakta hai — plant ka option dikhta hi nahi, server khud
  uska plant laga deta hai
- **Documents upload** — Aadhaar, PAN, photo, cheque, certificates.
  Plant manager bhi kar sakta hai, apne plant walon ke liye
- **Edit / Freeze** — **sirf admin**. Accounts sirf dekh sakti hai, aur
  screen pe likha hai ki correction Help & Support se maangna hai
- **Letters** — joining, appointment, appraisal, increment, experience,
  relieving. Sirf admin issue kar sakta hai

### User & Access (point 1)
Ab **Edit** button hai — naam aur username badal sakte hain. Aur **delete**
bhi, par do taale ke saath: username type karke confirm karna padta hai,
aur agar us account ne koi entry ya approval ki hai to app **mana kar
degi** — kyunki delete karne se wo history kisi ki nahi rahegi. Disable
karna hi sahi raasta hai.

### Weight slip auto-check (point 4)
Biomass sheet me slip upload karte hi **apne aap check hota hai**:
- OCR slip se padhta hai — Vehicle no, Name, Gross, Tare, Net
- Aapki entry se milata hai
- **Jo cell galat hai wo laal ho jata hai**, hover karne pe difference
- Upar ek banner me saari galtiyan ek saath
- Agar vehicle number AND weights dono alag hain to app kehti hai
  **"galat slip lagi lagti hai"** — teen alag warning ke bajaye

**Shifting wale columns check nahi hote** — aapne kaha tha wo plant manager
ki apni entry hai, aur weighbridge se uska koi lena-dena nahi.

Naya column: **Vehicle No.** — ye wahi field hai jo typo aur galat slip me
farak batata hai.

### Transport ab plant-wise (point 3)
Pehle transport me plant switcher chhupa hua tha. Ab dono sheet ek jaisi
hain. Export ka naam bhi ab **plant se shuru hota hai** — warna dono
manager ki file ek hi naam se aati thi aur ek doosri ko replace kar deti.

### Help & Support ka status (point 2)
Ab har ticket pe **step tracker** hai:
**Received → Accepted → With the admin → Resolved / Not accepted → Closed**

Har step pe date aur kisne kiya. **Resolve ya reject sirf admin kar sakta
hai**, aur reason likhna zaroori hai — bina reason ka faisla nahi hoga.
Accounts accept kar sakti hai aur admin ko refer kar sakti hai.

### Email schedule (point 6)
Settings → **Email**. Gmail ya company SMTP. Gmail ke liye **App Password**
chahiye — screen pe hi likha hai kyunki normal password aisa fail hota hai
jaise app ka bug ho.

"Send payslips after a month is approved" on kar dijiye aur **2 din** set
kijiye. Do din baad payroll me prompt aayega. **Chupke se nahi bhejta** —
40 logo ko salary slip bina kisi ke dekhe bhejna theek nahi.

### Hataye gaye
- **Customers** (Operations se) — point 2
- **AI Business Assistant** — point 8

## 12 Aug (raat) — pending kaam ek saath

### ⚠️ Pehle ye: `npm install` chalaiye
Email ke liye `nodemailer` add kiya hai. Files copy karke `npm install`
chalaiye. Na kiya to baaki sab chalega par email nahi jayega — app aapko
bata degi.

### Clients add — asli wajah mili
Client add karne ka editor **pehle se bana tha, par kisi page pe mount hi
nahi tha.** Kahin se pahunch hi nahi sakte the. Ab sidebar me **Clients**.

### Organisation masters
Sidebar → **Organisation**: Departments, Designations, Work Locations.
Work location me **state** bhi hai — wahi professional tax aur wage floor
decide karta hai. Sirf admin badal sakta hai.

### Attendance
Sidebar → **Attendance**. Poore mahine ka grid, cell pe click karke mark:
khaali → P → A → H → L → HD. Plant manager apne plant ka, accounts/
coordinator apna, admin sabka. **Khaali khaali hi rehta hai** — pre-fill
karte to bina padhe mahina approve ho jata. Payroll me totals apne aap
aa jate hain.

### Employee KYC + documents + letters
Payroll → Employees me ab KYC (Aadhaar, PAN, bank, skill category),
documents, aur letters (joining/appraisal/experience) hain.
**Point 9:** record ban jane ke baad **sirf admin edit kar sakta hai** —
accounts dekh sakti hai, badal nahi sakti.

### Compliance indicator (point 4)
Laal/peela badge jab: wage state ke minimum se kam, wage table expired,
PF on par UAN nahi, ESIC on par number nahi, PAN/bank/email missing.

### Salary sheet — Excel
Run kholiye → **Excel**. Letterhead, grouped bands, frozen panes, totals
row **real SUM formula** ke saath, autofilter, alag Employer cost sheet.

### Payslip — asli PDF
Logo wala letterhead, statutory identity, attendance strip, earnings vs
deductions, **net pay words me bhi**, employer contributions alag, bank
account masked.

### Email payslips
Settings me email set kijiye. Gmail ke liye **App Password** chahiye —
normal password kaam nahi karega. Approve hone ke baad "Email payslips".
**Draft month email nahi hoga.**

---

## 12 Aug (shaam) — do ASLI bug fix + naye features

### BUG 1 — Gangakhed ka data Rewari manager ko dikh raha tha (asli security bug)
`/api/plant-data` plant ka naam **URL se** le raha tha, session se nahi. Matlab
Rewari ka manager `?plant=gangakhed` maang kar doosre plant ki poori biomass
sheet nikaal sakta tha. Transport sheet aur Excel export me bhi wahi.

Ab plant **session se** aata hai. Field role ka manga hua plant ignore hi ho
jata hai. Switcher me bhi ab sirf unka apna plant dikhta hai — doosra list me
aata hi nahi.

### BUG 2 — Weight slip upload hoke open nahi hota tha
Grid sirf **file ka naam** cell me likh deta tha. File kahin jaati hi nahi
thi. Isliye click karne pe kuch nahi hota tha — kholne ko kuch tha hi nahi.

Ab file sach me upload hoti hai aur click karne pe khulti hai. Purani entries
jinme sirf naam hai, wo plain text dikhengi (dead link nahi) — unhe dobara
attach karna padega.

### Full page forms
Imprest ki entry, payroll ka employee form, aur support ka message — teeno ab
**poore screen** pe khulte hain. Header upar fix, body scroll, Save button
neeche hamesha dikhta hai.

### Imprest me payment mode
Ab har entry pe **Cash / Bank transfer / UPI / Cheque** chunna hai, aur bank
wale me UTR/cheque number. Balance me alag dikhta hai ki kitna bank se gaya
aur kitna cash se — accounts ko statement se milane me isi ki zaroorat thi.

Sign convention: **Expense jodta hai, receipt/return ghatata hai.**
Cash in hand = advance − expense − return.

### Minimum wages — dono states ki asli notification
| | Haryana (Rewari) | Maharashtra (Gangakhed) |
|---|---|---|
| Notification | 2/25/26-2 Lab, 9 Apr 2026 | 4 Feb 2026 |
| Effective | 1 Apr 2026 se | 1 Jan – **30 Jun 2026** |
| Unskilled | ₹15,220.71/mah, ₹585.41/din | ₹14,638/mah, ₹563/din |
| Semi-skilled | ₹16,780.74 | ₹16,250 |
| Skilled | ₹18,500.81 | ₹17,940 |
| Highly skilled | ₹19,425.85 | ₹19,500 |

⚠️ **Maharashtra ki table 30 June ko expire ho chuki hai — 43 din pehle.**
Wahan VDA har 6 mahine me badalta hai (Jan aur July). July-December wali nayi
notification aa chuki hogi. App ab ye khud batati hai.

---

## 12 Aug — Imprest/Payroll ka blank screen FIX + naye features

**Aapki shikayat sahi thi.** Fresh install pe:
- Plant manager aur coordinator ko Imprest page **bilkul khaali** dikhta tha
  — na tab, na entry ka option, na koi message
- Admin ko galat message aata tha ("ask accounts to open one") jabki wo khud
  accounts hai, aur asli raasta (Holders tab) kahin bataya nahi tha
- Payroll me employee add kiye bina sheet khaali aati thi

Ab dono page pe **setup guide** aata hai (Zoho jaise checklist), aur jisko
account nahi mila usko saaf message milta hai ki kis se maangna hai.

### Naya — Help & Support (sidebar me)
Koi bhi employee message bhej sakta hai — salary, imprest, attendance,
PF/ESIC, app problem. **"Mark as urgent"** dabane pe wo accounts/admin ki
list me sabse upar chipak jata hai aur band hone tak wahin rehta hai.
Apna message sirf apne ko dikhta hai; sabka sirf accounts aur admin ko.

### Naya — Version update notification
Admin naya version publish karega to **har user ko app me banner** aayega
download link ke saath. "Required" mark karenge to banner hataya nahi ja
sakta.

### Point 12 — imprest ki visibility
- **Admin** — sabka poora ledger
- **Accounts** — apna float + jo decision ke liye pending hai + jo unhone
  khud decide kiya. Kisi colleague ki purani spending browse nahi kar sakte
- **Baaki sab** — sirf apna

### Point 13 — plant alag
Plant manager jis plant ke liye login karega, sirf usi plant ka data
dikhega.

### Point 14 — hidden feature ab 404 deta hai
Pehle mana karne pe "aapko access nahi hai" aata tha — isse pata chal jata
tha ki page maujood hai. Ab seedha **404 "This page doesn't exist"** aata
hai. App maanti hi nahi ki wo module install hai.

---

## Imprest aur Payroll (12 Aug)

### Imprest — sabhi employees ke liye

Sidebar me **Imprest**. Har role ko dikhega, par kaam alag:

| Kaun | Kya kar sakta hai |
|---|---|
| Koi bhi employee | Apna expense file kare, bill photo lagaye, apna float dekhe, **apni pending entry edit ya withdraw kare** |
| Accounts / Admin | Sabka float dekhe, **approve ya reject kare**, advance de, naye holder add kare |

**Shuru kaise karein:** Imprest → **Holders** tab → "Add an imprest holder".
Wahan login link kar dijiye, to wo bandaa apni entry khud file karega. Login
na ho to accounts uske naam se file kar sakti hai.

**Zaroori design faisle:**

1. **Pending entry balance nahi badalti.** Jab tak accounts approve na kare,
   wo sirf ek claim hai. Warna koi bhi apna balance khud badha leta.
2. **Approve/reject ke baad edit band.** Settled entry badalna matlab kisi
   ki sign ki hui decision badalna. Nayi entry file kijiye.
3. **Apni entry khud approve nahi kar sakte** — chahe aap admin hi kyun na
   hon. Yahi cheez approval ko matlab deti hai.
4. **Advance sirf accounts de sakti hai.** Employee khud advance file kar
   pata to float self-service ban jata.
5. **Reject karte waqt reason zaroori hai** — warna bandey ko pata hi nahi
   chalega kya theek karna hai.
6. **Jis holder ke paas cash bacha hai, uska account close nahi hoga.**

**Real-time:** har 8 second me apne aap refresh hota hai. Employee entry
karega, accounts ko 8 second me dikh jayega — kisi ko reload nahi karna.

### Payroll — sirf accounts aur admin

Sidebar me **Payroll**. Teen tab:

**Employees** — staff (monthly salary) ya labour (daily wage). PF/ESIC
applicable ya nahi, UAN, ESIC number.

**Salary sheet** — mahina kholiye, attendance bhariye (paid days, worked
days, OT hours, bonus, advance recovery, TDS), sheet apne aap calculate
hoti hai. Har row ka **payslip** print ho sakta hai.

**Statutory rules** — PF, ESIC, professional tax, OT rate. Sab editable.

**Kya apne aap calculate hota hai:**

- **PF** — 12% employee + 12% employer, ₹15,000 ceiling ke saath.
  Employer ka hissa EPS (8.33%) aur EPF me split hota hai. Admin charges
  aur EDLI alag.
- **ESIC** — 0.75% employee + 3.25% employer, sirf gross ₹21,000 tak.
  Upar chala jaye to app **rok kar batati hai**, chupke se band nahi karti.
- **Professional tax** — Rewari (Haryana) me nahi lagta. Gangakhed
  (Maharashtra) me lagta hai, aur **February me ₹300** kat-ta hai — ye wo
  cheez hai jo log bhool jate hain aur saal ke ant me shortfall aata hai.
- **Overtime** — 2× rate (Factories Act ka minimum).
- **Labour** — days worked × daily wage.

**Approve karne pe mahina lock ho jata hai**, aur uske saath us waqt ke
rates bhi freeze ho jate hain. Agli baar slip nikalenge to wahi dikhega jo
sach me kata tha.

**Negative net pay pe approve nahi hoga** — recovery zyada ho gayi to app
rok degi.

---

## Full motion — splash aur login (12 Aug)

Dono screen ab poori tarah zinda hain. Sirf splash aur login badle hain —
dashboard, sidebar, settings, koi module, koi API, kuch nahi chhua.

**Ab kya-kya chal raha hai:**

| Layer | Kya | Raftaar |
|---|---|---|
| Aasman | Baadal, roshni ki kirnein, dhundh | Sabse dheemi |
| Factory | Conveyor, pahiye, chimney ka dhuan, batti, kabhi-kabhi truck | Dheemi |
| Khet | 96 ghaas ke tinke hawa me jhoolte hue, gusts | Dheemi |
| Workers | 5 log — koi chal raha, koi jhuk kar fasal kaat raha, koi gattha uthaye | Dheemi |
| Patte | 18 patte, har ek ki apni raftaar, ghoomna, drift, gehrai | Medium |
| Kan (particles) | 30 udte hue kan | Medium |
| Globe | Ghoomta naksha, atmosphere, network lines, sites, orbit, pulse | Dheemi |
| Telemetry | 5 layer ki wave — teen alag raftaar, data points, light pulse | Medium |
| Login form | Hover, focus, press, error, loading | Tez |

**Workers ki movement:** har ek ka apna timing hai, isliye do log kabhi
ek saath nahi chalte. Jo jhuk raha hai wo neeche thodi der rukta hai —
jaise asli kaam me hota hai.

**Patte:** har patte ka apna size, speed, rotation, opacity aur raasta
hai. Neeche pahunch kar apne aap dobara upar se aate hain — kahin
"teleport" nahi karte.

**Mouse hilaiye** — background halka sa hilta hai (parallax). Har layer
apni gehrai ke hisaab se. Bahut halka rakha hai taaki padhne me dikkat
na ho.

**Login form:**
- Box pe mouse le jaayein — halka upar uthta hai
- Click karein — neeche se cyan line beech se failti hai, icon roshan
- Kuch type karein — dayein taraf chhota hara point
- Galat password — halka sa nudge (jhatka nahi)
- Login button — hover pe uthta hai aur roshni daudti hai, press pe
  halka dabta hai

Aapke Windows ki "reduce motion" setting on hogi to sab apne aap ruk
jayega.

---

## Naya splash screen

Splash bilkul naya bana diya hai. Ab wo aapka apna kaam dikhata hai:
biomass conveyor pe chalta hua turbine me jaata hai, aur turbine se jo
energy nikalti hai wahi loading bar chalati hai. Saath me modules ek-ek
karke online hote dikhte hain.

Login screen ke hi elements use kiye hain — silo, conveyor, turbine,
udte patte, wahi teal aasman — taaki splash aur login ek hi jagah lagein.
Dono card pe ab ek jaisa halka sweep bhi chalta hai.

Splash ab 5.6 second ka hai (pehle 8 second tha), aur ek session me sirf
ek baar dikhta hai.

Dobara dekhna ho to URL me `?splash=1` laga dijiye:
`localhost:3000/login?splash=1`

---

## Animation ki problem — theek ho gayi

App me ek setting hai "Reduce motion", jo saare animations band kar deti
hai. Aapke original app me wo setting kabhi lagti hi nahi thi. Maine use
"theek" kiya tha — aur wahi galti thi. Uske baad splash, login scene aur
dashboard, sab freeze ho gaya.

Ab wapas aapke original jaisa kar diya hai. Aapke browser me wo setting
"on" padi thi (kabhi Settings me toggle hui hogi). App ab use ek baar
apne aap saaf kar degi — aapko kuch nahi karna, bas app kholiye.

Ye files aapke original se **byte-to-byte same** hain, maine inhe chhua
hi nahi:

- `components/brand/BiomassLoginScene.tsx` (login animation)
- `components/brand/SplashScreen.tsx` (shuru wala splash)
- `components/AnimatedBackground.tsx` (dashboard background)
- `app/globals.css` (saare animations)
- `app/page.tsx` (dashboard)

---

## Aapke original se sirf 10 files badli hain

| File | Kyun |
|---|---|
| `app/login/page.tsx` | Asli login (design bilkul same, "Testing mode" badge bhi wapas) |
| `components/AppGate.tsx` | Login ke baad session dobara padhta hai |
| `components/Navbar.tsx` | Sign out theek kiya + asli naam/role dikhta hai |
| `components/Sidebar.tsx` | Role ke hisaab se menu |
| `app/layout.tsx` | Reduce-motion wali galat value hatati hai |
| `lib/preferences.ts` | Reduce-motion original jaisa wapas |
| `app/settings/page.tsx` | Master data ab live padhta hai |
| `app/api/whatsapp-settings/route.ts` | Save-location ab kaam karta hai |
| `components/settings/SaveLocationSetting.tsx` | Behtar error message |
| `electron/main.js` | Session ki secret key banata hai |

Baaki sab kuch aapka original hai.

---

## Test kijiye

1. **Splash + login animation** — chalna chahiye jaise pehle chalta tha
2. **Login** — admin / biome-admin
3. **Sign out** — upar daayen kone me apne naam pe click → Sign out.
   Login screen aani chahiye aur wapas andar nahi aana chahiye.
4. **Users & Access** — ek test plant manager banaiye (username `test`,
   role Plant Manager, plant REW, password `test12345`)
5. **Us se login karke** address bar me `localhost:3000/ledgers` daaliye
   — "This section isn't open to your role" aana chahiye

---

## Ek baat imaandari se

Main ye app apne yahan chala kar nahi dekh sakta — mere paas
`node_modules` bhi nahi hai aur internet bhi nahi. Jo test main kar
sakta tha wo kiye hain: saari files ke imports, sab JS ka syntax, login
ka logic, token ki security, permission ki list, aur reduce-motion ka
behaviour.

Par asli chalta hua app sirf aapke PC pe hi dikhega. Koi bhi error aaye
to poora text bhej dijiye.
