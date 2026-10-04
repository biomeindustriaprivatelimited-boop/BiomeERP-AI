/**
 * WhatsApp agent smoke test — runs the agent exactly as the installed app
 * does and checks the two things that matter:
 *
 *   A. Pipeline: two group documents (our tax invoice posted from the linked
 *      phone, and the vendor's invoice) go through the WhatsApp Web message
 *      path → download → read → filed into ONE supply-set folder.
 *   B. Engine: the WhatsApp engine starts and reaches the QR screen
 *      (proves the browser / library actually run on this machine).
 *
 * Usage:
 *   node tools/smoke/wa-smoke.js                       (agent via this node)
 *   node tools/smoke/wa-smoke.js --exe <Biome.exe> --app <resources/app>
 *
 * Prints "PASS …"/"FAIL …" lines, and GitHub annotations when in CI.
 */
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const exe = opt("--exe") ? path.resolve(opt("--exe")) : null;
const appDir = path.resolve(opt("--app") || path.join(__dirname, "..", ".."));
const engineWanted = opt("--engine") || "auto";
const qrWaitMs = Number(opt("--qr-wait") || 150000);
const CI = !!process.env.GITHUB_ACTIONS;
const results = [];

function report(ok, name, detail = "") {
  results.push({ ok, name });
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  if (CI) console.log(`::${ok ? "notice" : "error"} title=WhatsApp smoke::${line.replace(/\r?\n/g, " ")}`);
}

const PORT = 4290 + Math.floor(Math.random() * 50);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "biome-smoke-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "whatsapp-settings.json"), JSON.stringify({ whatsappEngine: engineWanted }));

const env = {
  ...process.env,
  BIOME_DATA_ROOT: root,
  BIOME_AGENT_TEST: "1",
  BIOME_WA_AGENT_PORT: String(PORT),
  BIOME_AUTH_SECRET: "smoke-secret",
  NODE_ENV: "production",
};
process.on("uncaughtException", (e) => { report(false, "smoke test crashed", e.stack ? e.stack.split("\n").slice(0, 3).join(" ") : String(e)); finish(); });
if (exe && !fs.existsSync(exe)) {
  const dir = path.dirname(exe);
  let listing = "";
  try { listing = fs.readdirSync(dir).join(", "); } catch (e) { listing = e.message; }
  report(false, `packaged exe not found at ${exe}`, `folder has: ${listing}`.slice(0, 600));
  process.exit(1);
}
let child;
if (exe) {
  child = spawn(exe, [path.join(appDir, "whatsapp-agent", "agent.js")], { cwd: appDir, env: { ...env, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] });
} else {
  child = spawn(process.execPath, [path.join(appDir, "whatsapp-agent", "agent.js")], { cwd: appDir, env, stdio: ["ignore", "pipe", "pipe"] });
}
child.on("error", (e) => report(false, "could not start the agent process", e.message));
child.on("exit", (code) => { if (!finished) report(false, "agent process exited early", `code ${code}`); });
let finished = false;
const logLines = [];
for (const s of [child.stdout, child.stderr]) s.on("data", (d) => { const t = d.toString(); logLines.push(t); process.stdout.write("  | " + t.replace(/\n(?=.)/g, "\n  | ")); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let TOKEN = null;
function call(method, route, body) {
  return new Promise((resolve) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({ host: "127.0.0.1", port: PORT, path: route, method, headers: { "x-agent-token": TOKEN || "", "content-type": "application/json", ...(data ? { "content-length": data.length } : {}) } }, (res) => {
      let out = "";
      res.on("data", (d) => (out += d));
      res.on("end", () => { try { resolve({ status: res.statusCode, json: JSON.parse(out) }); } catch { resolve({ status: res.statusCode, json: null, text: out }); } });
    });
    req.on("error", (e) => resolve({ status: 0, error: e.message }));
    req.setTimeout(30000, () => req.destroy());
    if (data) req.write(data);
    req.end();
  });
}

(async () => {
  // Wait for the agent's handshake file (token).
  const hs = path.join(root, "runtime", "whatsapp-agent.json");
  for (let i = 0; i < 120 && !TOKEN; i++) {
    try { TOKEN = JSON.parse(fs.readFileSync(hs, "utf8")).token; } catch { await sleep(1000); }
  }
  report(Boolean(TOKEN), "agent starts from the packaged app", TOKEN ? `port ${PORT}` : "no handshake in 120 s");
  if (!TOKEN) return finish();

  let selfTest = null;
  for (let i = 0; i < 30 && !selfTest; i++) {
    selfTest = logLines.join("").match(/self-test: all (\d+) checks passed|SELF-TEST FAILED[^\n]*/);
    if (!selfTest) await sleep(1000);
  }
  report(Boolean(selfTest && /passed/.test(selfTest[0])), "startup self-test", selfTest ? selfTest[0] : "no self-test line");

  // ---- A. pipeline through the WhatsApp Web message path ----
  const GROUP = "120363000000000001@g.us";
  await call("POST", "/chats", { allowedChats: [GROUP], watchAllChats: false, receivingChats: [], labChats: [], learnChats: [] });
  const doc = (f) => fs.readFileSync(path.join(__dirname, f)).toString("base64");
  const a = await call("POST", "/test/web-message", { chat: GROUP, fromMe: true, type: "document", mimetype: "application/pdf", filename: "Biome Tax Invoice BI26-27-HR0871.pdf", base64: doc("biome_invoice_trading.pdf"), sender: "Biome Accounts" });
  const b = await call("POST", "/test/web-message", { chat: GROUP, author: "919800000001@c.us", type: "document", mimetype: "application/pdf", filename: "Invoice 338.pdf", base64: doc("vendor_invoice.pdf"), sender: "Vendor" });
  report(a.status === 200 && b.status === 200, "group documents accepted from the WhatsApp Web path", `${a.status}/${b.status}`);

  let sets = null;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    const st = await call("GET", "/status");
    const d = st.json && st.json.diag;
    const r = await call("GET", "/sets");
    sets = r.json;
    const set = (sets && sets.sets || []).find((s) => /871/.test(s.reference || s.canonical || ""));
    if (set && (set.documents || []).length >= 2) break;
    if (d && d.processed + d.failed >= 2 && i > 5) break;
  }
  const set = (sets && sets.sets || []).find((s) => /871/.test(s.reference || s.canonical || ""));
  const docs = (set && set.documents) || [];
  report(Boolean(set), "supply set created for BDC/871/AT/338", set ? `${docs.length} document(s)` : JSON.stringify(sets && (sets.sets || []).map((s) => s.reference || s.canonical)).slice(0, 200));
  const onDisk = docs.filter((d) => d.filePath && fs.existsSync(d.filePath));
  report(onDisk.length >= 2, "both documents saved in the supply-set folder", onDisk.map((d) => path.relative(root, d.filePath)).join(" | ") || "none on disk");

  // ---- A2. a scanned (image-only) PDF goes through offline OCR ----
  const before = (await call("GET", "/status")).json?.diag || {};
  await call("POST", "/test/web-message", { chat: GROUP, author: "919800000002@c.us", type: "document", mimetype: "application/pdf", filename: "scan.pdf", base64: doc("vendor_scan.pdf"), sender: "Driver" });
  let after = before;
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    after = (await call("GET", "/status")).json?.diag || {};
    if ((after.processed || 0) + (after.failed || 0) > (before.processed || 0) + (before.failed || 0)) break;
  }
  report((after.processed || 0) > (before.processed || 0), "scanned PDF read with offline OCR", `processed ${after.processed}, failed ${after.failed}`);

  // ---- B. engine reaches the QR screen ----
  await call("POST", "/connect");
  let last = null;
  const t0 = Date.now();
  while (Date.now() - t0 < qrWaitMs) {
    await sleep(3000);
    const st = await call("GET", "/status");
    last = st.json || {};
    if (last.status === "qr" && last.qrDataUrl) break;
    if (last.status === "error") break;
  }
  report(last && last.status === "qr", `WhatsApp engine reaches the QR screen (engine: ${last && last.engine}${last && last.browser ? ", " + path.basename(last.browser) : ""})`, `status ${last && last.status}${last && last.lastError ? " — " + last.lastError : ""}`);
  await call("POST", "/disconnect", { forget: true });
  finish();
})();

function finish() {
  if (finished) return;
  finished = true;
  // The agent's own last log lines, as annotations: the CI log itself is not
  // always readable, these are.
  if (CI) {
    const tail = logLines.join("").split(/\r?\n/).filter((l) => /WhatsApp|engine|status|error|fail|filed|held|QR|qr|browser|could not/i.test(l)).slice(-10);
    for (const l of tail) console.log(`::warning title=agent log::${l.replace(/^\[Biome WhatsApp Agent [^\]]+\]\s*/, "").slice(0, 300)}`);
  }
  try { child.kill(); } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 1500);
}
