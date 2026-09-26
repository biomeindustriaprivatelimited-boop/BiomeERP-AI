# Biome.exe kaise banayein (Windows installer)

Is project me ab poora Electron wrapper add ho chuka hai (`electron/main.js`), jo
built Next.js app (API routes samet) ko ek native Windows window me chalata hai.

**Zaroori baat:** Windows `.exe` (code-signed, proper icon ke saath) sirf ek
Windows machine par ya Windows-based build server par banta hai — Linux se
cross-build karne ke liye Wine chahiye hota hai, jo yahan available nahi tha,
isiliye maine test karke confirm kar liya (config sahi hai, bas Wine missing
hai). Aapke paas 2 aasan raaste hain:

## Option A — Apne Windows PC par (sabse simple)

1. Node.js install karein (v20 ya usse upar): https://nodejs.org
2. Project folder khol kar terminal (PowerShell / cmd) me:
   ```
   npm install
   npm run dist:win
   ```
3. `.exe` installer yahan milega: `release\Biome Setup <version>.exe`
4. Usi installer ko double-click karke install karein — Desktop aur Start
   Menu me "Biome" shortcut ban jayega.

Pehli baar build karne me `npm install` thoda time lega (~2-5 min), usके
baad `npm run dist:win` bhi 1-2 min lega.

## Option B — GitHub Actions se (cloud me, bina apne PC ke)

Workflow file: `.github/workflows/build-windows.yml` ("Build Windows installer").

- **Har push / pull request par** GitHub khud TypeScript check, `npm run check`
  aur production build chalata hai — PR page par ✓ ya ✗ dikh jaata hai.
- **`main` par push hote hi** (ya Actions tab → "Build Windows installer" →
  **Run workflow**) Windows installer bhi banta hai.
- Download: repo → **Actions** → sabse upar wala green run → neeche
  **Artifacts** → **Biome-Windows-Installer** (zip) → andar `Biome Setup <version>.exe`.
  Artifact 14 din tak rehta hai.
- Installer unsigned hai, isliye Windows "SmartScreen" warning de sakta hai →
  **More info → Run anyway**.

## Notes

- App offline hi chalta hai (khud ka local server spawn karta hai, port 4173
  par) — internet sirf OCR ke AI-extraction feature ke liye chahiye (agar
  `.env.local` me API key set hai).
- Icon `build/icon.png` se aata hai — apna khud ka professional icon chahiye
  to isi file ko replace kar dein (kam se kam 256×256, PNG).
- `npm run dist:win:dir` se bina installer banaye sirf unpacked `.exe` folder
  milta hai (testing ke liye faster) — installer ke liye `npm run dist:win`
  use karein.
