# Google Drive setup — ek baar ka kaam, ~10 minute

Ye Google ki taraf ka setup hai. App me kuch nahi karna, sirf teen value
copy karke laani hain.

---

## 1. Google Cloud Console me project banaiye

https://console.cloud.google.com → upar **Select a project** → **New Project**
Naam kuch bhi, jaise `Biome ERP`. Create.

## 2. Google Drive API on kijiye

**APIs & Services → Library** → search "Google Drive API" → **Enable**

## 3. Consent screen

**APIs & Services → OAuth consent screen**

- User Type: **External** → Create
- App name: `BIOME ERP`
- User support email: aapka email
- Developer contact: aapka email
- Save and Continue

**Scopes** page pe kuch add mat kijiye — app khud maangega. Save.

**Test users** → **Add users** → wahi Google address daaliye jise cloud
storage banana hai (jaise `biomecompany@gmail.com`). Save.

> App "Testing" me rahega — ye theek hai. Aap hi use kar rahe hain, publish
> karne ki zaroorat nahi.

## 4. OAuth client banaiye

**APIs & Services → Credentials → Create Credentials → OAuth client ID**

- Application type: **Web application**
- Name: `BIOME ERP Server`
- **Authorized redirect URIs → ADD URI** — bilkul yahi daaliye:

```
http://localhost:4173/api/cloud/callback
```

⚠️ Ek character bhi alag hua to Google mana kar dega. Agar aap dusre port
pe chalate hain to wahi port likhiye. App ke Cloud Storage page pe sahi URI
likha rehta hai — wahan se copy kar lijiye.

Create. Ab **Client ID** aur **Client Secret** dikhenge.

## 5. `.env.local` me daaliye

Project folder me `.env.local` kholiye (na ho to bana lijiye):

```
GOOGLE_CLIENT_ID=<yahan paste kijiye>
GOOGLE_CLIENT_SECRET=<yahan paste kijiye>
GOOGLE_REDIRECT_URI=http://localhost:4173/api/cloud/callback
```

App band karke dobara chalaiye.

## 6. Connect kijiye

App me **Cloud Storage** (sidebar) → **Connect Google Drive** → Google se
sign in → Allow.

Ho gaya. App khud `BIOME ERP` folder aur uske andar ki 17 sub-folders bana
degi.

---

## Do baatein pehle se jaan lijiye

**App aapka poora Drive nahi padh sakti.** Sirf `drive.file` scope maanga
gaya hai — matlab wahi files jo app ne khud banayi hain. Aapke personal
documents, photos, Gmail — kuch bhi app ko nahi dikhta. Consent screen pe
bhi yahi likha aayega.

**Personal Gmail me 15 GB Drive, Gmail aur Photos me batta hai.** App
Google se asli figure poochti hai, 15 GB maan kar nahi chalti. Isliye
"available" wo hai jo sach me bacha hai.

---

## Kuch galat ho to

| Dikkat | Wajah |
|---|---|
| `redirect_uri_mismatch` | URI me farak hai. Console wala aur `.env.local` wala **exactly** same hona chahiye |
| `access_blocked` | Aapka email Test users me add nahi hai (Step 3) |
| "Google did not return a refresh token" | Pehle se authorize hai. myaccount.google.com/permissions → BIOME ERP hata dijiye → dobara connect |
| "Google has revoked this connection" | Password badla ya access hata diya. Dobara connect kijiye |
| Connect button dabate hi kuch nahi | `.env.local` set nahi hai ya app restart nahi hui |
