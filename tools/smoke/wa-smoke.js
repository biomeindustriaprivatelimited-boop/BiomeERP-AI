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
  results.push({ ok, name, detail });
  const line = `${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`;
  console.log(line);
  // GitHub shows at most 10 notice annotations per step, so passes are
  // collected into ONE summary notice at the end; every failure gets its
  // own error annotation straight away (errors have their own, larger cap).
  if (CI && !ok) console.log(`::error title=WhatsApp smoke FAIL::${line.replace(/\r?\n/g, " ").slice(0, 900)}`);
}

const PORT = 4290 + Math.floor(Math.random() * 50);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "biome-smoke-"));
fs.mkdirSync(path.join(root, "config"), { recursive: true });
fs.writeFileSync(path.join(root, "config", "whatsapp-settings.json"), JSON.stringify({ whatsappEngine: engineWanted }));

// An INVALID Gemini key, saved exactly as Settings → AI saves it
// (lib/aiKeys.ts cipher). The run must surface Google's refusal as a clear
// error on the status / health check / document — and never crash.
const SMOKE_SECRET = "smoke-secret";
const BAD_GEMINI_KEY = "AIzaSyBADKEYbiomeSmokeTest0000000000000";
{
  const crypto = require("crypto");
  const key = crypto.createHash("sha256").update(`ai-keys:${SMOKE_SECRET}`).digest();
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const d = Buffer.concat([c.update(BAD_GEMINI_KEY, "utf8"), c.final()]);
  fs.writeFileSync(path.join(root, "config", "ai-keys.json"), JSON.stringify({ geminiEnc: `${iv.toString("base64")}.${c.getAuthTag().toString("base64")}.${d.toString("base64")}`, anthropicEnc: "" }));
}

const env = {
  ...process.env,
  BIOME_DATA_ROOT: root,
  BIOME_AGENT_TEST: "1",
  BIOME_WA_AGENT_PORT: String(PORT),
  BIOME_AUTH_SECRET: SMOKE_SECRET,
  // The invalid key must come from the saved file, not the runner's env.
  GEMINI_API_KEY: "",
  ANTHROPIC_API_KEY: "",
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

  // ---- A4. phone photos through the WhatsApp path (sent as IMAGE) ----
  // A WhatsApp-compressed (~1280 px) photo of OUR Tally invoice, tilted,
  // shadowed — the reference sits in a boxed table cell. Then the vendor's
  // hand-filled challan photo, whose CAPTION names the supply.
  const beforeA4 = (await call("GET", "/status")).json?.diag || {};
  await call("POST", "/test/web-message", { id: "SMOKEP1", chat: GROUP, fromMe: true, type: "image", mimetype: "image/jpeg", base64: doc("wa_photo_invoice_912.jpg"), sender: "Biome Accounts" });
  await call("POST", "/test/web-message", { id: "SMOKEP2", chat: GROUP, author: "919800000004@c.us", type: "image", mimetype: "image/jpeg", base64: doc("wa_vendor_challan_photo.jpg"), caption: "Ambika challan for BDC/912/AAT/338", sender: "Ambika" });
  await call("POST", "/test/web-message", { id: "SMOKEP3", chat: GROUP, author: "919800000005@c.us", type: "image", mimetype: "image/jpeg", base64: doc("wa_photo_dark.jpg"), sender: "Driver" });
  for (let i = 0; i < 150; i++) {
    await sleep(2000);
    const st = (await call("GET", "/status")).json || {};
    const d = st.diag || {};
    if ((d.processed || 0) + (d.failed || 0) >= (beforeA4.processed || 0) + (beforeA4.failed || 0) + 3 && !st.processing && !st.queueDepth) break;
  }
  const docsA4 = ((await call("GET", "/documents?limit=1000")).json || {}).documents || [];
  const p1 = docsA4.find((d) => d.id === "doc-SMOKEP1") || {};
  const p2 = docsA4.find((d) => d.id === "doc-SMOKEP2") || {};
  const p3 = docsA4.find((d) => d.id === "doc-SMOKEP3") || {};
  report(p1.extracted?.documentType === "biome_tax_invoice" && p1.reference?.canonical === "BDC/912/AAT/338",
    "image document via the WhatsApp path: phone photo of our invoice read (type + reference from a table cell)",
    `${p1.extracted?.documentType || "unread"} ${p1.reference?.canonical || "no reference"} via ${p1.extracted?.readMethod || "?"} (OCR ${p1.extracted?.ocrConfidence ?? "?"}%)`);
  report(p2.bucket === "filed" && p2.reference?.canonical === "BDC/912/AAT/338",
    "vendor photo with the reference in its caption joins that supply set",
    `${p2.extracted?.documentType || "unread"} → ${p2.bucket || "?"} ${p2.reference?.canonical || ""}`);
  const why = await call("GET", `/why?id=${encodeURIComponent("doc-SMOKEP2")}`);
  report(why.status === 200 && Array.isArray(why.json?.reasons) && typeof why.json?.transcription === "string" && why.json.transcription.length > 40,
    "Why? explains a document (text read, reasons, fields, candidates)",
    why.json ? `${why.json.status} · ${(why.json.reasons || []).length} reason(s) · ${(why.json.candidates || []).length} candidate(s)` : `HTTP ${why.status}`);

  // ---- A5. an invalid Gemini key is reported clearly, never a crash ----
  const st5 = (await call("GET", "/status")).json || {};
  const hc = (await call("GET", "/health-check?force=1")).json || {};
  const gCheck = (hc.checks || []).find((c) => c.key === "gemini");
  const clear = (t) => /rejected|not valid|not allowed|cannot reach|could not reach|blocked|limit/i.test(String(t || ""));
  const aiErrDoc = [p1, p2, p3].find((d) => d.extracted?.aiError);
  report(Boolean(gCheck) && gCheck.ok === false && clear(gCheck.detail) && child.exitCode === null,
    "invalid Gemini key → clear error in the health check (agent still running)",
    gCheck ? `${gCheck.detail}`.slice(0, 220) : "no gemini check");
  report(clear(st5.aiHealth?.lastError) || Boolean(aiErrDoc),
    "invalid Gemini key → error shown on status / document, offline result kept",
    `${st5.aiHealth?.lastErrorCode || "-"}: ${String(st5.aiHealth?.lastError || aiErrDoc?.extracted?.aiError || "none recorded").slice(0, 200)} · dark photo read as ${p3.extracted?.documentType || "unread"}`);
  const okChecks = (hc.checks || []).filter((c) => ["ocr", "disk"].includes(c.key) && c.ok).length;
  report(okChecks === 2, "health check: offline OCR engine and document folder OK", (hc.checks || []).filter((c) => ["ocr", "disk"].includes(c.key)).map((c) => `${c.key}: ${c.detail}`).join(" | ").slice(0, 300));

  // ---- D. supply sets on synthetic look-alikes (not real documents) ----
  await supplySetChecks();

  // ---- C. the app server: OCR scanner API on a phone photo ----
  await scannerCheck();

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

/**
 * Supply sets built from synthetic look-alike papers (tools/smoke/syn_*,
 * made by make_set_fixtures.py — no real document is in the repository):
 * trading set via BDC/<our>/<vendor code>/<vendor no>, a merged vendor PDF
 * split page-wise, Bill T joined through the LR number on OUR invoice, a
 * Rewari manufacturing set with its weight slip, the Gangakhed 400–500 kg
 * tolerance, a screenshot in a sales chat and a chat set to Ignore both
 * skipped with a reason, and Verify & finalise freezing a set.
 */
async function supplySetChecks() {
  const SALES2 = "120363000000000002@g.us";
  const IGN = "120363000000000003@g.us";
  const r0 = await call("POST", "/chats", { chatPurposes: { [SALES2]: "sales", [IGN]: "ignore" } });
  const purposes = (r0.json && r0.json.chatPurposes) || {};
  report(purposes[SALES2] === "sales" && purposes[IGN] === "ignore" && purposes["120363000000000001@g.us"] === "sales",
    "chat purposes saved (Sales / Ignore); a chat chosen the old way counts as Sales", JSON.stringify(purposes).slice(0, 200));

  const b64 = (f) => fs.readFileSync(path.join(__dirname, f)).toString("base64");
  const before = (await call("GET", "/status")).json?.diag || {};
  const sendTo = (chat, id, f, fromMe, extra = {}) => {
    const pdf = /\.pdf$/i.test(f);
    return call("POST", "/test/web-message", { id, chat, fromMe, author: fromMe ? undefined : "919800000009@c.us", type: pdf ? "document" : "image", mimetype: pdf ? "application/pdf" : "image/jpeg", filename: pdf ? f : undefined, base64: b64(f), sender: fromMe ? "Biome Accounts" : "Coordinator", ...extra });
  };
  const idle = async (minMore) => {
    let quiet = 0;
    for (let i = 0; i < 150; i++) {
      await sleep(2000);
      const st = (await call("GET", "/status")).json || {};
      const d = st.diag || {};
      const done = (d.processed || 0) + (d.failed || 0) >= (before.processed || 0) + (before.failed || 0) + minMore;
      quiet = !st.processing && !st.queueDepth ? quiet + 1 : 0;
      if (done && quiet >= 2) return;
    }
  };
  // Vendor papers and plant slips first, then our invoices — the order they really arrive in.
  await sendTo(SALES2, "SYNV1", "syn_vendor_merged_mhi61.pdf", false);
  await sendTo(SALES2, "SYNR1", "syn_rew_slip_960.pdf", false);
  await sendTo(SALES2, "SYNG1", "syn_gkd_slip_71.pdf", false);
  await sendTo(SALES2, "SYNS1", "syn_chat_screenshot.jpg", false);
  await sendTo(IGN, "SYNI1", "syn_our_invoice_rew960.pdf", false);
  await sendTo(SALES2, "SYNO1", "syn_our_invoice_951.pdf", true);
  await sendTo(SALES2, "SYNO2", "syn_our_invoice_rew960.pdf", true);
  await sendTo(SALES2, "SYNO3", "syn_our_challan_gkd71.pdf", true);
  await idle(7);
  await call("POST", "/staged/sweep");

  const docs = ((await call("GET", "/documents?limit=1000")).json || {}).documents || [];
  const sets = ((await call("GET", "/sets")).json || {}).sets || [];
  const setOf = (ref) => sets.find((s) => s.reference === ref);
  const types = (s) => (s ? s.documents.map((d) => d.extracted?.documentType).sort() : []);
  const trading = setOf("BDC/951/MHI/61");
  const tt = types(trading);
  report(Boolean(trading) && ["vendor_tax_invoice", "vendor_eway_bill", "biome_tax_invoice", "biome_eway_bill"].every((t) => tt.includes(t)),
    "trading set via BDC/951/MHI/61: vendor invoice + vendor e-way + our invoice + our e-way", trading ? tt.join(", ") : sets.map((s) => s.reference).join(", "));
  const parts = docs.filter((d) => /^doc-SYNV1_p/.test(d.id));
  report(parts.length === 3 && parts.every((d) => d.reference?.canonical === "BDC/951/MHI/61"),
    "merged vendor PDF split page-wise; every page joins its set", parts.map((d) => `${d.id.replace("doc-SYNV1_", "")}:${d.extracted?.documentType}→${d.reference?.canonical || d.bucket}`).join(", ") || "not split");
  const billT = parts.find((d) => d.extracted?.documentType === "bilty_lr");
  report(Boolean(billT) && billT.reference?.canonical === "BDC/951/MHI/61",
    "Bill T (blank, LR 77) joins through the LR number on OUR invoice", billT ? `${billT.reference?.canonical || billT.bucket} · ${(billT.autoFiledReasons || [billT.needsCheckReason || ""]).join("; ").slice(0, 160)}` : "no Bill T page");
  const rew = setOf("BDC/960/REW/960");
  const rewSlip = docs.find((d) => d.id === "doc-SYNR1") || {};
  report(Boolean(rew) && rewSlip.reference?.canonical === "BDC/960/REW/960" && !rewSlip.needsCheck,
    "REW manufacturing set: plant weight slip matched by vehicle + weight", `${rew ? types(rew).join(", ") : "no set"} · slip → ${rewSlip.reference?.canonical || rewSlip.bucket || "?"}`);
  const gkd = setOf("BDC/71/GKD/71");
  const gkdSlip = docs.find((d) => d.id === "doc-SYNG1") || {};
  const gkdWeight = gkd && (gkd.checks || []).find((c) => c.key === "weight");
  report(Boolean(gkd) && gkdSlip.reference?.canonical === "BDC/71/GKD/71" && gkdWeight && gkdWeight.ok === true,
    "GKD set: slip 450 kg under our challan accepted (400–500 kg rule)", `${gkdSlip.reference?.canonical || gkdSlip.bucket || "?"} · ${gkdWeight ? `${gkdWeight.ok} ${gkdWeight.detail}` : "no weight check"}`.slice(0, 240));
  const ourInv = docs.find((d) => /^doc-SYNO1/.test(d.id) && d.extracted?.documentType === "biome_tax_invoice") || {};
  report(/^August-2026[\\/]Jhajjar Power Limited[\\/]03-08-2026[\\/]BDC_951_MHI_61 - /.test(ourInv.relativePath || ""),
    "folder layout Month / Client / our document date, names prefixed with the reference", ourInv.relativePath || "not filed");
  const shot = docs.find((d) => d.id === "doc-SYNS1") || {};
  const skipped = ((await call("GET", "/skipped")).json || {}).items || [];
  report(shot.bucket !== "filed" && Boolean(shot.skipReason) && skipped.some((s) => s.id === "doc-SYNS1"),
    "screenshot in a sales chat skipped with a reason", `${shot.bucket || "?"}: ${shot.skipReason || "no reason"}`);
  report(!docs.some((d) => /^doc-SYNI1/.test(d.id)) && skipped.some((s) => s.chatJid === IGN && /Ignore/.test(s.reason)),
    "document in a chat whose purpose is Ignore is not saved, and listed as skipped", skipped.filter((s) => s.chatJid === IGN).map((s) => s.reason).join(" | ") || "not listed");

  // Verify & finalise → frozen.
  const by = { id: "smoke", name: "Smoke Coordinator", role: "coordinator" };
  const noNote = trading && trading.status !== "ready" ? await call("POST", "/sets/finalise", { reference: "BDC/951/MHI/61", by }) : { status: 400 };
  const fin = await call("POST", "/sets/finalise", { reference: "BDC/951/MHI/61", by, note: "Smoke test: papers checked by hand" });
  const vInv = parts.find((d) => d.extracted?.documentType === "vendor_tax_invoice");
  const moveOut = vInv ? await call("POST", "/classify", { id: vInv.id, referenceNo: "BDC/960/REW/960" }) : { status: 0 };
  const del = vInv ? await call("DELETE", "/documents", { ids: [vInv.id] }) : { status: 0 };
  const countBefore = (setOf("BDC/951/MHI/61") || { documents: [] }).documents.length;
  const b2 = (await call("GET", "/status")).json?.diag || {};
  await sendTo(SALES2, "SYNL1", "syn_late_eway_mhi61.pdf", false);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    const st = (await call("GET", "/status")).json || {};
    if ((st.diag?.processed || 0) + (st.diag?.failed || 0) > (b2.processed || 0) + (b2.failed || 0) && !st.processing && !st.queueDepth) break;
  }
  await call("POST", "/staged/sweep");
  const after = ((await call("GET", "/sets")).json || {}).sets || [];
  const frozen = after.find((s) => s.reference === "BDC/951/MHI/61");
  const late = (((await call("GET", "/documents?limit=1000")).json || {}).documents || []).find((d) => d.id === "doc-SYNL1") || {};
  report(noNote.status === 400 && fin.status === 200 && frozen && frozen.status === "final" && moveOut.status === 409 && del.status === 409 &&
    frozen.documents.length === countBefore && late.bucket !== "filed" && late.reference?.canonical !== "BDC/951/MHI/61",
    "Verify & finalise freezes the set (no auto additions, papers cannot be moved or removed)",
    `final=${frozen && frozen.status} note-required=${noNote.status} move=${moveOut.status} delete=${del.status} docs ${countBefore}→${frozen ? frozen.documents.length : "?"} late paper → ${late.bucket || "?"}${late.needsCheck ? " (Needs check)" : ""}`);
  const re1 = await call("POST", "/sets/reopen", { reference: "BDC/951/MHI/61", by });
  const re2 = await call("POST", "/sets/reopen", { reference: "BDC/951/MHI/61", by, reason: "Smoke: reopen check" });
  report(re1.status === 400 && re2.status === 200, "reopening a final set needs a reason", `${re1.status}/${re2.status}`);
}

/**
 * Start the packaged app's Next server (Electron's Node, as the installed
 * app does), sign in as the developer from the "server PC", and run the
 * OCR scanner's offline reader (/api/ocr-read) on a WhatsApp-sized phone
 * photo; also save an invalid Gemini key through Settings → AI, which must
 * be refused with Google's reason.
 */
async function scannerCheck() {
  const crypto = require("crypto");
  const nextBin = path.join(appDir, "node_modules", "next", "dist", "bin", "next");
  if (!fs.existsSync(path.join(appDir, ".next"))) {
    report(false, "OCR scanner API in the packaged app", `no .next build in ${appDir}`);
    return;
  }
  const port2 = PORT + 1000;
  const serverEnv = { ...env, PORT: String(port2), BIOME_AUTH_SECRET: SMOKE_SECRET };
  delete serverEnv.BIOME_WA_AGENT_PORT;
  const srv = exe
    ? spawn(exe, [nextBin, "start", "-p", String(port2)], { cwd: appDir, env: { ...serverEnv, ELECTRON_RUN_AS_NODE: "1" }, stdio: ["ignore", "pipe", "pipe"] })
    : spawn(process.execPath, [nextBin, "start", "-p", String(port2)], { cwd: appDir, env: serverEnv, stdio: ["ignore", "pipe", "pipe"] });
  const srvLog = [];
  for (const st of [srv.stdout, srv.stderr]) st.on("data", (d) => srvLog.push(d.toString()));
  const base = `http://127.0.0.1:${port2}`;
  try {
    let up = false;
    for (let i = 0; i < 90 && !up; i++) {
      await sleep(1000);
      try { up = (await fetch(`${base}/api/health`)).ok; } catch { /* starting */ }
    }
    if (!up) { report(false, "OCR scanner API in the packaged app", `server did not start: ${srvLog.join("").slice(-300)}`); return; }
    const pc = crypto.createHmac("sha256", SMOKE_SECRET).update("biome-server-pc-v1").digest("base64url");
    const H = { "content-type": "application/json", "x-biome-server-pc": pc };
    const cookieOf = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get("set-cookie")]).filter(Boolean).map((c) => c.split(";")[0]).join("; ");
    let r = await fetch(`${base}/api/auth/login`, { method: "POST", headers: H, body: JSON.stringify({ username: "developer", password: "biome-admin" }) });
    let cookie = cookieOf(r);
    const lj = await r.json().catch(() => ({}));
    if (lj.mustChangePassword || lj.user?.mustChangePassword) {
      const r2 = await fetch(`${base}/api/auth/password`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ currentPassword: "biome-admin", newPassword: "Smoke-Test-2026!" }) });
      cookie = cookieOf(r2) || cookie;
    }
    const t0 = Date.now();
    r = await fetch(`${base}/api/ocr-read`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ fileBase64: fs.readFileSync(path.join(__dirname, "wa_photo_invoice_912.jpg")).toString("base64"), fileName: "IMG-20261003-WA0007.jpg", mimeType: "image/jpeg" }) });
    const j = await r.json().catch(() => ({}));
    const f = Object.fromEntries((j.fields || []).map((x) => [x.label, x.value]));
    report(r.ok && j.documentType === "biome_tax_invoice" && f["Reference No"] === "BDC/912/AAT/338",
      "OCR scanner API (packaged app server) reads a WhatsApp phone photo",
      r.ok ? `${j.documentType} · ${f["Reference No"] || "no ref"} · ${f["Our Invoice / Challan No"] || "no inv"} · ${j.method} ${j.confidence}% · ${Date.now() - t0} ms` : `HTTP ${r.status} ${j.error || ""}`);
    r = await fetch(`${base}/api/ai-status`, { method: "POST", headers: { ...H, cookie }, body: JSON.stringify({ gemini: BAD_GEMINI_KEY }) });
    const k = await r.json().catch(() => ({}));
    // Refused with Google's reason; when Google is unreachable the key is
    // saved with a clear warning instead. Either way: no crash, plain words.
    const said = String(k.error || k.warning || "");
    report((r.status === 400 && /rejected|not valid|not allowed/i.test(said)) || (r.ok && /reach|blocked/i.test(said)),
      "Settings → AI: an invalid Gemini key is refused with a clear reason", `HTTP ${r.status}: ${said.slice(0, 200)}`);
  } catch (err) {
    report(false, "OCR scanner API in the packaged app", err.message);
  } finally {
    try { srv.kill(); } catch {}
    if (process.platform === "win32" && srv.pid) { try { spawn("taskkill", ["/PID", String(srv.pid), "/T", "/F"]); } catch {} }
  }
}

function finish() {
  if (finished) return;
  finished = true;
  if (CI) {
    const passed = results.filter((r) => r.ok).map((r) => r.name);
    console.log(`::notice title=WhatsApp smoke — ${passed.length}/${results.length} passed::PASS: ${passed.join(" · ").slice(0, 3500)}`);
  }
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
