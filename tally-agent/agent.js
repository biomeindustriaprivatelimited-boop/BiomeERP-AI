/**
 * Biome Platform — Tally Agent
 * ---------------------------------------------------------------
 * Runs on the SAME PC as Tally. Talks to Tally locally (safe — never
 * leaves the machine), and exposes one small password-protected HTTP
 * endpoint that the Biome Platform app (running on any other PC, over
 * the internet) can call instead of hitting Tally's own HTTP gateway
 * directly.
 *
 * Why this exists instead of just opening Tally's port 9000 to the
 * internet: Tally's HTTP gateway has NO password of its own — anyone
 * who found that address could read your company's data. This agent
 * sits in front of it and requires a shared API key on every request.
 *
 * REQUIRES: Node.js installed on the Tally PC (https://nodejs.org —
 * download the "LTS" installer, Next-Next-Finish, no configuration
 * needed). No other dependencies — this file only uses Node's
 * built-ins, so there's no `npm install` step.
 *
 * SETUP:
 *   1. Copy this whole `tally-agent` folder onto the Tally PC.
 *   2. Copy `config.example.json` to `config.json` and edit it:
 *        - apiKey: make up a long random password, e.g. a UUID.
 *        - tallyHost / tallyPort: normally leave as "localhost"/9000.
 *        - agentPort: the port THIS agent listens on (default 8420).
 *   3. Open Command Prompt in this folder and run:  node agent.js
 *      Leave that window open — it needs to keep running. (See
 *      README.md for making it start automatically with Windows.)
 *   4. To make this reachable over the internet, use a tunnel — see
 *      README.md for Cloudflare Tunnel (recommended, free) or ngrok.
 *   5. In the Biome Platform app → Settings → Tally Integration →
 *      switch to "Different network (via Agent)" and enter the
 *      tunnel's public URL + the apiKey from step 2.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(__dirname, "config.json");

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error(
      '\n[Biome Tally Agent] config.json not found. Copy config.example.json to config.json and edit it first.\n'
    );
    process.exit(1);
  }
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch (err) {
    console.error("[Biome Tally Agent] config.json is not valid JSON:", err.message);
    process.exit(1);
  }
}

const config = loadConfig();
const AGENT_PORT = config.agentPort || 8420;
const TALLY_HOST = config.tallyHost || "localhost";
const TALLY_PORT = config.tallyPort || 9000;
const API_KEY = config.apiKey;

if (!API_KEY || API_KEY === "CHANGE-ME-TO-A-LONG-RANDOM-VALUE") {
  console.error(
    "\n[Biome Tally Agent] Please set a real apiKey in config.json before running this (don't leave the placeholder value).\n"
  );
  process.exit(1);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function checkAuth(req) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : header;
  return token === API_KEY;
}

const server = http.createServer(async (req, res) => {
  // Simple unauthenticated health check so it's easy to confirm the
  // agent itself (and any tunnel in front of it) is reachable.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", agent: "biome-tally-agent" }));
    return;
  }

  if (req.method !== "POST" || req.url !== "/tally") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. POST XML requests to /tally." }));
    return;
  }

  if (!checkAuth(req)) {
    res.writeHead(401, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid or missing API key." }));
    return;
  }

  let body;
  try {
    body = await readBody(req);
  } catch (err) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Could not read request body." }));
    return;
  }

  // Forward the exact XML request straight to Tally, running locally
  // on this same PC — this part never touches the internet.
  const tallyReq = http.request(
    {
      host: TALLY_HOST,
      port: TALLY_PORT,
      method: "POST",
      path: "/",
      headers: { "Content-Type": "text/xml", "Content-Length": Buffer.byteLength(body) },
      timeout: 25000,
    },
    (tallyRes) => {
      let responseData = "";
      tallyRes.on("data", (chunk) => (responseData += chunk));
      tallyRes.on("end", () => {
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(responseData);
      });
    }
  );

  tallyReq.on("timeout", () => {
    tallyReq.destroy();
    res.writeHead(504, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Tally didn't respond within 25 seconds at ${TALLY_HOST}:${TALLY_PORT}.` }));
  });

  tallyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: `Could not reach Tally at ${TALLY_HOST}:${TALLY_PORT} on this PC: ${err.message}. Is Tally open with the company loaded, and is the HTTP gateway enabled (F1 → Settings → Connectivity)?`,
      })
    );
  });

  tallyReq.write(body);
  tallyReq.end();
});

server.listen(AGENT_PORT, () => {
  console.log(`\n[Biome Tally Agent] Listening on http://localhost:${AGENT_PORT}`);
  console.log(`[Biome Tally Agent] Forwarding to Tally at ${TALLY_HOST}:${TALLY_PORT}`);
  console.log(`[Biome Tally Agent] Keep this window open. See README.md to set up a public tunnel.\n`);
});
