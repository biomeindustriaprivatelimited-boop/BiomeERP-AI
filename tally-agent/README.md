# Biome Tally Agent

Runs on the **same PC as Tally**. Lets the Biome Platform app fetch data
from Tally over the internet, from any other PC or laptop, without ever
exposing Tally's own (unprotected) HTTP gateway directly to the internet.

```
Biome Platform app (anywhere)  →  internet  →  Tunnel  →  this Agent (on Tally PC)  →  Tally (same PC, local only)
```

## 1. First — get Tally itself talking to this agent locally

This must work before anything else does:

1. Load `tally/BiomeBridge.tdl` (from the main project) into Tally
   (F1 → TDL & Add-On) — this defines the custom report the app requests.
2. Enable Tally's HTTP gateway: F1 → Settings → Connectivity → set
   "TallyPrime acts as" to include **Server**, port **9000**.
3. Confirm it's up: open a browser on the Tally PC and go to
   `http://localhost:9000` — you should see `TallyPrime Server is Running`.

## 2. Install and run the agent

1. Install Node.js on the Tally PC if it isn't already: https://nodejs.org
   (download the **LTS** installer, click through with defaults).
2. Copy this whole `tally-agent` folder onto the Tally PC (a USB drive,
   email, WhatsApp — any way works, it's just a few small files).
3. Copy `config.example.json` to `config.json` and edit it:
   - `apiKey` — replace the placeholder with a long random password (this
     is what protects your data — anyone with this key can query Tally
     through the agent, so keep it private, like a password).
   - Leave `tallyHost`/`tallyPort` as `localhost`/`9000` unless you changed
     Tally's port in step 1.
4. Open Command Prompt in this folder and run:
   ```
   node agent.js
   ```
   You should see "Listening on http://localhost:8420". **Leave this
   window open** — closing it stops the agent. (See section 3 below for
   making this start automatically instead of a window you keep open.)

Quick local test — from the same PC, in a second Command Prompt window:
```
curl http://localhost:8420/health
```
should print `{"status":"ok","agent":"biome-tally-agent"}`.

## 3. Make it reachable over the internet — PERMANENTLY, no domain needed

This uses ngrok's free static domain: one URL that never changes, even
after restarts — no domain purchase, no router settings.

### One-time setup

1. Sign up free at https://dashboard.ngrok.com/signup.
2. Download ngrok for Windows: https://ngrok.com/download — unzip
   `ngrok.exe` into the `tally-agent` folder (keeps everything together).
3. Get your auth token from https://dashboard.ngrok.com/get-started/your-authtoken
   and run once, in this folder:
   ```
   ngrok.exe config add-authtoken YOUR_TOKEN_HERE
   ```
4. Claim your free static domain: go to
   https://dashboard.ngrok.com/domains → "New Domain" → it gives you
   something like `something-random.ngrok-free.app`. This is yours
   permanently, free, on the free plan (one static domain per account).
5. Test it once:
   ```
   ngrok.exe http --url=something-random.ngrok-free.app 8420
   ```
   Leave it running, and in a browser (from ANY PC, any network) visit
   `https://something-random.ngrok-free.app/health` — ngrok's free plan
   shows a one-time "Visit Site" warning page in a browser first (click
   through it), then you should see `{"status":"ok","agent":"biome-tally-agent"}`.
   The Biome Platform app itself skips this warning page automatically
   (it sends a special header ngrok looks for), so this "Visit Site"
   step is only something a human sees in a browser, not something that
   blocks the app.

### Make both pieces run automatically, with no window to keep open

This turns `agent.js` and the ngrok tunnel into proper Windows services —
they start automatically on boot, restart themselves if they crash, and
need no open Command Prompt window at all.

1. Download NSSM (a small free tool for wrapping any program as a
   Windows service): https://nssm.cc/download — unzip it, and use the
   `win64\nssm.exe` (or `win32` if on 32-bit Windows).
2. Open Command Prompt **as Administrator** in the NSSM folder, and run:
   ```
   nssm.exe install BiomeTallyAgent "C:\path\to\node.exe" "C:\path\to\tally-agent\agent.js"
   ```
   Set "Startup directory" (in the dialog that opens) to the
   `tally-agent` folder, then click "Install service".
3. Do the same for the tunnel:
   ```
   nssm.exe install BiomeTallyTunnel "C:\path\to\tally-agent\ngrok.exe" "http --url=something-random.ngrok-free.app 8420"
   ```
   Startup directory: the `tally-agent` folder again.
4. Start both:
   ```
   nssm.exe start BiomeTallyAgent
   nssm.exe start BiomeTallyTunnel
   ```
5. From now on, both start automatically whenever the Tally PC turns on
   — no window, no manual steps, survives restarts. To check on them
   later, open Windows "Services" (Win+R → `services.msc`) and look for
   `BiomeTallyAgent` / `BiomeTallyTunnel`.

If NSSM feels like too much right now, the simpler Startup-folder
shortcut approach below still works fine — it's just one manual login
click away from fully automatic, and doesn't restart itself if it
crashes.

### Simpler alternative (a window stays open, less robust)

1. Press `Win + R`, type `shell:startup`, press Enter.
2. Create a shortcut running `node.exe agent.js` (Start in: the
   `tally-agent` folder).
3. Create another shortcut running
   `ngrok.exe http --url=something-random.ngrok-free.app 8420`.

## 4. Connect the Biome Platform app

In the app → Settings → Tally Integration → switch the connection mode to
**"Different network (via Agent)"** and enter:
- **Agent URL**: your permanent ngrok URL from step 3 (e.g.
  `https://something-random.ngrok-free.app`)
- **Agent API Key**: the `apiKey` you set in `config.json`

Then use "Test Connection" the same way as before.

## Security notes

- The `apiKey` is the only thing standing between the internet and your
  Tally data through this agent — treat it like a password. Don't share
  it, don't commit `config.json` to any public place.
- Only the two endpoints this agent defines (`/tally`, `/health`) are
  exposed — Tally's own gateway is never reachable from outside this PC.
- If the API key is ever compromised, just change it in `config.json`,
  restart the agent, and update it in the app's Settings — the old key
  stops working immediately.
