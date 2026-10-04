/**
 * Biome — finding the server without anyone typing an address.
 *
 *   1. LAN discovery: the server answers a UDP broadcast on port 4175, so a
 *      PC or phone in the office finds it in about a second.
 *   2. The office static IP is built into the app (server-address.json),
 *      so a PC anywhere on the internet finds the same server.
 *   3. The server asks the office router to open its port by itself
 *      (UPnP), so in most offices nobody has to touch the router.
 *
 * Every candidate is checked with /api/health, which must answer as a Biome
 * server ({ ok, startedAt, id }). Nothing here stores business data.
 */
const dgram = require("dgram");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const fs = require("fs");

const DISCOVERY_PORT = 4175;
const DISCOVERY_ASK = "BIOME_DISCOVER_V1";

/** The office addresses built into this build of the app. */
function bakedAddresses() {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "server-address.json"), "utf8"));
    return (Array.isArray(raw.addresses) ? raw.addresses : [])
      .map((a) => String(a || "").trim().replace(/\/+$/, ""))
      .filter((a) => /^https?:\/\//.test(a));
  } catch (_) {
    return [];
  }
}

/** GET <url>/api/health — resolves { ok, url, id, owned } or { ok:false }. */
function probe(url, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => { if (!done) { done = true; resolve(r); } };
    try {
      const lib = url.startsWith("https:") ? https : http;
      const req = lib.get(`${url}/api/health`, { timeout: timeoutMs }, (res) => {
        let body = "";
        res.on("data", (d) => { body += d; if (body.length > 4096) req.destroy(); });
        res.on("end", () => {
          try {
            const j = JSON.parse(body);
            if (j && j.ok && j.startedAt) return finish({ ok: true, url, id: j.id || null, owned: j.owned !== false, ownerSince: j.ownerSince || null, established: j.established !== false });
          } catch (_) {}
          finish({ ok: false, url });
        });
      });
      req.on("timeout", () => { req.destroy(); finish({ ok: false, url }); });
      req.on("error", () => finish({ ok: false, url }));
    } catch (_) {
      finish({ ok: false, url });
    }
    setTimeout(() => finish({ ok: false, url }), timeoutMs + 500);
  });
}

/** Broadcast addresses for every IPv4 network this PC is on. */
function broadcastTargets() {
  const out = new Set(["255.255.255.255"]);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family !== "IPv4" || n.internal || !n.netmask) continue;
      const ip = n.address.split(".").map(Number);
      const mask = n.netmask.split(".").map(Number);
      out.add(ip.map((b, i) => (b | (~mask[i] & 255)) >>> 0).join("."));
    }
  }
  return [...out];
}

/** Asks the office network "is there a Biome server?" — resolves a list of URLs. */
function discoverLan(waitMs = 1500) {
  return new Promise((resolve) => {
    const found = new Map();
    let sock;
    try {
      sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    } catch (_) {
      return resolve([]);
    }
    const finish = () => {
      try { sock.close(); } catch (_) {}
      resolve([...found.values()]);
    };
    sock.on("error", finish);
    sock.on("message", (buf, rinfo) => {
      try {
        const j = JSON.parse(buf.toString("utf8"));
        if (j && j.biome === true && j.port) found.set(rinfo.address, `http://${rinfo.address}:${j.port}`);
      } catch (_) {}
    });
    sock.bind(0, () => {
      try { sock.setBroadcast(true); } catch (_) {}
      const msg = Buffer.from(DISCOVERY_ASK);
      for (const t of broadcastTargets()) sock.send(msg, DISCOVERY_PORT, t, () => {});
      setTimeout(finish, waitMs);
    });
  });
}

/** Server side: answer discovery broadcasts. */
function startDiscoveryResponder({ port, id }) {
  try {
    const sock = dgram.createSocket({ type: "udp4", reuseAddr: true });
    sock.on("error", (e) => console.error("Discovery responder:", e.message));
    sock.on("message", (buf, rinfo) => {
      if (buf.toString("utf8").trim() !== DISCOVERY_ASK) return;
      const reply = Buffer.from(JSON.stringify({ biome: true, port, id }));
      sock.send(reply, rinfo.port, rinfo.address, () => {});
    });
    sock.bind(DISCOVERY_PORT);
    return sock;
  } catch (e) {
    console.error("Discovery responder:", e.message);
    return null;
  }
}

/**
 * Finds the server. Order of preference among those that answer:
 * office network (fastest, works without the router) → the last address
 * that worked → the office static IP(s).
 *
 * `excludeId` skips this PC's own server; `ownedOnly` keeps only a server
 * where the developer is signed in.
 */
async function findServer({ saved = "", excludeId = null, ownedOnly = false } = {}) {
  const lan = await discoverLan();
  // Found on the office network and ready? Use it at once — no need to wait
  // on the internet addresses.
  if (lan.length) {
    const near = (await Promise.all(lan.map((u) => probe(u, 2500)))).find(
      (r) => r.ok && r.owned && !(excludeId && r.id && r.id === excludeId)
    );
    if (near) return near;
  }
  const ordered = [...lan, saved, ...bakedAddresses()].filter(Boolean);
  const unique = [...new Set(ordered)];
  if (!unique.length) return null;
  const results = (await Promise.all(unique.map((u) => probe(u)))).filter(
    (r) => r.ok && !(excludeId && r.id && r.id === excludeId)
  );
  // A server where the developer is signed in beats one where they are not
  // (an old PC that once ran as a server by mistake must never win).
  const owned = results.find((r) => r.owned);
  if (owned) return owned;
  return ownedOnly ? null : results[0] || null;
}

/* ------------------------------------------------------------------ */
/* UPnP — ask the office router to forward the port to this PC          */
/* ------------------------------------------------------------------ */

function httpGet(url, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let body = "";
      res.on("data", (d) => (body += d));
      res.on("end", () => resolve(body));
    });
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
  });
}

function soap(controlUrl, service, action, argsXml) {
  return new Promise((resolve, reject) => {
    const body =
      `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">` +
      `<s:Body><u:${action} xmlns:u="${service}">${argsXml}</u:${action}></s:Body></s:Envelope>`;
    const u = new URL(controlUrl);
    const req = http.request(
      {
        hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: "POST", timeout: 5000,
        headers: { "Content-Type": 'text/xml; charset="utf-8"', SOAPAction: `"${service}#${action}"`, "Content-Length": Buffer.byteLength(body) },
      },
      (res) => {
        let out = "";
        res.on("data", (d) => (out += d));
        res.on("end", () => (res.statusCode === 200 ? resolve(out) : reject(new Error(`router said ${res.statusCode}`))));
      }
    );
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.on("error", reject);
    req.end(body);
  });
}

/** SSDP search for the router's port-mapping service. */
function findGateway(waitMs = 2500) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket("udp4");
    const locations = new Set();
    const finish = () => { try { sock.close(); } catch (_) {} resolve([...locations]); };
    sock.on("error", finish);
    sock.on("message", (buf) => {
      const m = /^location:\s*(.+)$/im.exec(buf.toString());
      if (m) locations.add(m[1].trim());
    });
    sock.bind(0, () => {
      for (const st of ["urn:schemas-upnp-org:service:WANIPConnection:1", "urn:schemas-upnp-org:service:WANPPPConnection:1", "urn:schemas-upnp-org:device:InternetGatewayDevice:1"]) {
        const msg = Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`);
        sock.send(msg, 1900, "239.255.255.250", () => {});
      }
      setTimeout(finish, waitMs);
    });
  });
}

async function controlEndpoint() {
  for (const loc of await findGateway()) {
    try {
      const xml = await httpGet(loc);
      const re = /<service>([\s\S]*?)<\/service>/gi;
      let m;
      while ((m = re.exec(xml))) {
        const block = m[1];
        const type = (/<serviceType>([^<]+)<\/serviceType>/i.exec(block) || [])[1] || "";
        if (!/WAN(IP|PPP)Connection/i.test(type)) continue;
        const ctrl = (/<controlURL>([^<]+)<\/controlURL>/i.exec(block) || [])[1];
        if (!ctrl) continue;
        return { controlUrl: new URL(ctrl, loc).toString(), service: type.trim(), gateway: new URL(loc).hostname };
      }
    } catch (_) {}
  }
  return null;
}

/** The LAN address of this PC that sits on the router's network. */
function localAddressFor(gateway) {
  const g = gateway.split(".").slice(0, 3).join(".");
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === "IPv4" && !n.internal && n.address.startsWith(g + ".")) return n.address;
    }
  }
  return null;
}

/**
 * Opens `port` on the router to this PC. Resolves
 * { ok, externalIp?, internal?, error? } — never throws.
 */
async function openRouterPort(port) {
  try {
    const ep = await controlEndpoint();
    if (!ep) return { ok: false, error: "No router answered (UPnP is off on the router, or not supported)." };
    const internal = localAddressFor(ep.gateway);
    if (!internal) return { ok: false, error: "Could not tell which address of this PC the router sees." };
    const args =
      `<NewRemoteHost></NewRemoteHost><NewExternalPort>${port}</NewExternalPort><NewProtocol>TCP</NewProtocol>` +
      `<NewInternalPort>${port}</NewInternalPort><NewInternalClient>${internal}</NewInternalClient><NewEnabled>1</NewEnabled>` +
      `<NewPortMappingDescription>Biome server</NewPortMappingDescription><NewLeaseDuration>0</NewLeaseDuration>`;
    await soap(ep.controlUrl, ep.service, "AddPortMapping", args);
    let externalIp = null;
    try {
      const r = await soap(ep.controlUrl, ep.service, "GetExternalIPAddress", "");
      externalIp = (/<NewExternalIPAddress>([^<]*)</i.exec(r) || [])[1] || null;
    } catch (_) {}
    return { ok: true, internal, externalIp, gateway: ep.gateway };
  } catch (e) {
    return { ok: false, error: `The router refused to open the port automatically (${e.message}).` };
  }
}

module.exports = {
  DISCOVERY_PORT,
  bakedAddresses,
  probe,
  discoverLan,
  startDiscoveryResponder,
  findServer,
  openRouterPort,
};
