/**
 * WhatsApp agent smoke test — runs the agent exactly as the installed app
 * does and checks the two things that matter:
 *
 *   A. Pipeline: group documents (our tax invoice posted from the linked
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

  // ---- A3. whose document is it, and does every paper reach its set ----
  // Vendor papers for the Nabha supply arrive FIRST (a scanned vendor
  // invoice where Biome is the buyer, a sideways weight-slip photo), then
  // OUR delivery challan; separately, OUR tax invoice photographed at the
  // Gangakhed plant. Nothing may be left waiting once its set exists.
  const media = (f) => (/\.pdf$/i.test(f) ? ["document", "application/pdf"] : ["image", "image/jpeg"]);
  const send = (id, f, fromMe, sender) => {
    const [type, mimetype] = media(f);
    return call("POST", "/test/web-message", { id, chat: GROUP, fromMe, author: fromMe ? undefined : "919800000003@c.us", type, mimetype, filename: f, base64: doc(f), sender });
  };
  const beforeA3 = (await call("GET", "/status")).json?.diag || {};
  await send("SMOKEV1", "vendor_invoice_npl_scan.pdf", false, "IBS vendor");
  await send("SMOKEV2", "weight_slip_sideways.jpg", false, "Driver");
  await send("SMOKEO1", "biome_challan_npl.pdf", true, "Biome Accounts");
  await send("SMOKEO2", "biome_invoice_photo_gkd.jpg", true, "Gangakhed Plant");
  for (let i = 0; i < 120; i++) {
    await sleep(2000);
    const st = (await call("GET", "/status")).json || {};
    const d = st.diag || {};
    if ((d.processed || 0) + (d.failed || 0) >= (beforeA3.processed || 0) + (beforeA3.failed || 0) + 4 && !st.processing && !st.queueDepth) break;
  }
  const docsNow = ((await call("GET", "/documents?limit=1000")).json || {}).documents || [];
  const byId = (id) => docsNow.find((d) => d.id === `doc-${id}`) || {};
  const typeOf = (id) => byId(id).extracted?.documentType || "unread";
  report(typeOf("SMOKEO2") === "biome_tax_invoice", "our tax invoice photographed is OURS, not a vendor's", `read as ${typeOf("SMOKEO2")}`);
  report(typeOf("SMOKEO1") === "biome_delivery_challan", "our delivery challan is OURS", `read as ${typeOf("SMOKEO1")}`);
  report(typeOf("SMOKEV1") === "vendor_tax_invoice", "vendor invoice (Biome as buyer) is the vendor's", `read as ${typeOf("SMOKEV1")}`);
  const setsNow = ((await call("GET", "/sets")).json || {}).sets || [];
  const npl = setsNow.find((s) => s.reference === "BDC/884/IBS/30");
  const gkd = setsNow.find((s) => /^BDC\/905\//.test(s.reference || ""));
  report(Boolean(npl), "supply set created from our challan (BDC/884/IBS/30)", npl ? `${npl.documents.length} document(s)` : setsNow.map((s) => s.reference).join(", "));
  report(Boolean(gkd), "supply set created from our photographed invoice (BDC/905/GKD/905)", gkd ? gkd.reference : setsNow.map((s) => s.reference).join(", "));
  const v1 = byId("SMOKEV1");
  report(v1.bucket === "filed" && v1.reference?.canonical === "BDC/884/IBS/30" && Boolean(v1.filePath) && fs.existsSync(v1.filePath),
    "vendor invoice that arrived first is filed into its supply-set folder", `${v1.bucket || "?"} ${v1.reference?.canonical || ""} ${v1.relativePath || ""}`);
  const waitingNow = docsNow.filter((d) => d.bucket === "_Staged");
  const stuck = waitingNow.filter((d) => ["SMOKEV1", "SMOKEV2"].some((k) => d.id === `doc-${k}`));
  report(stuck.length === 0 && Boolean(npl), "no document left in waiting-to-match when its set exists",
    stuck.length ? stuck.map((d) => `${d.originalName} (${d.extracted?.documentType || "?"})`).join(", ") : `${waitingNow.length} waiting overall`);

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
  // Only when something failed — on a green run these lines are just noise.
  if (CI && results.some((r) => !r.ok)) {
    const tail = logLines.join("").split(/\r?\n/).filter((l) => /WhatsApp|engine|status|error|fail|filed|held|QR|qr|browser|could not/i.test(l)).slice(-10);
    for (const l of tail) console.log(`::warning title=agent log::${l.replace(/^\[Biome WhatsApp Agent [^\]]+\]\s*/, "").slice(0, 300)}`);
  }
  try { child.kill(); } catch {}
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  setTimeout(() => process.exit(failed ? 1 : 0), 1500);
}
