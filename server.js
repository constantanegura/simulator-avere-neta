// Simulator Avere Netă — server live pentru sesiuni de grup.
// Fără dependințe: rulează cu `node server.js` (Node 18+).
//   /             formularul pentru participanți (se deschide din codul QR)
//   /prezentare   ecranul pentru proiector: QR, participanți activi, procente live
// Variabile opționale: PORT, PUBLIC_URL (adresa publică, dacă e găzduit online), ADMIN_KEY,
// TUNNEL=0 (nu deschide linkul public Cloudflare).

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_URL = (process.env.PUBLIC_URL || "").replace(/\/+$/, "");
const KEY_FILE = path.join(__dirname, "admin-key.txt");
function loadKey() {
  if (process.env.ADMIN_KEY) return process.env.ADMIN_KEY;
  try { const k = fs.readFileSync(KEY_FILE, "utf8").trim(); if (k) return k; } catch (e) {}
  const k = crypto.randomBytes(3).toString("hex");
  try { fs.writeFileSync(KEY_FILE, k); } catch (e) {}
  return k;
}
const ADMIN_KEY = loadKey(); // kept in admin-key.txt so the host link survives restarts
// Changes on every start: added to the QR link so phones never reuse an old copy of the page.
const BUILD = Date.now().toString(36);
const DATA_FILE = path.join(__dirname, "data.json");
const PUBLIC_DIR = path.join(__dirname, "public");

// Age brackets, same order as in the participant page.
const BRACKETS = ["Până în 25 ani", "26–30 ani", "31–40 ani", "41–60 ani", "Peste 60 ani"];

/* ---------- state ---------- */
// submissions: participantId -> { verdict: "acc" | "spend", bracket: 0..4, pct: number, at: ms }
let submissions = {};
try { submissions = JSON.parse(fs.readFileSync(DATA_FILE, "utf8")).submissions || {}; } catch (e) {}

let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DATA_FILE, JSON.stringify({ submissions }, null, 1), () => {});
  }, 300);
}

// Presence. One entry per phone (its anonymous id), kept alive by a heartbeat from the visible page.
// Counting heartbeats instead of open connections means a second scan, a forgotten background tab
// or a connection the tunnel has not closed yet never counts the same person twice.
const PRESENCE_TTL = 30000;    // ms without a heartbeat before a phone stops counting as active
const participants = new Map(); // id -> last heartbeat (ms)
const presenters = new Set();   // res

function touch(id) {
  const isNew = !participants.has(id);
  participants.set(id, Date.now());
  if (isNew) broadcast();
}
function leave(id) {
  if (participants.delete(id)) broadcast();
}
setInterval(() => {
  const cutoff = Date.now() - PRESENCE_TTL;
  let changed = false;
  for (const [id, seen] of participants) if (seen < cutoff) { participants.delete(id); changed = true; }
  if (changed) broadcast();
}, 5000);

// The phone's id also lives in a cookie, so it survives when the page's own storage is unavailable.
const COOKIE = "bilant_pid";
function cookieId(req) {
  const m = (req.headers.cookie || "").match(/(?:^|;\s*)bilant_pid=([a-zA-Z0-9_-]{8,64})/);
  return m ? m[1] : null;
}

function stats() {
  const subs = Object.values(submissions);
  const acc = subs.filter(s => s.verdict === "acc").length;
  const spend = subs.length - acc;
  const activeIds = [...participants.keys()];
  const filling = activeIds.filter(id => !submissions[id]).length;
  const byBracket = BRACKETS.map((label, i) => ({
    label,
    acc: subs.filter(s => s.bracket === i && s.verdict === "acc").length,
    spend: subs.filter(s => s.bracket === i && s.verdict === "spend").length
  }));
  return { active: activeIds.length, filling, submitted: subs.length, acc, spend, byBracket, at: Date.now() };
}

let broadcastTimer = null;
function broadcast() {
  // Coalesce bursts (many phones connecting at once) into one update every 250 ms.
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    const msg = `event: stats\ndata: ${JSON.stringify(stats())}\n\n`;
    for (const res of presenters) res.write(msg);
  }, 250);
}

/* ---------- helpers ---------- */
function lanAddress() {
  const all = Object.values(os.networkInterfaces()).flat().filter(a => a && a.family === "IPv4" && !a.internal && !a.address.startsWith("169.254."));
  const pref = all.find(a => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address));
  return (pref || all[0] || { address: "localhost" }).address;
}

function participantUrl(req) {
  if (PUBLIC_URL) return PUBLIC_URL + "/";
  if (tunnelUrl) return tunnelUrl + "/";
  const host = (req.headers["x-forwarded-host"] || req.headers.host || "").split(",")[0].trim();
  const hostname = host.replace(/:\d+$/, "");
  if (!host || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]") {
    return `http://${lanAddress()}:${PORT}/`;
  }
  const proto = (req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  return `${proto}://${host}/`;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", c => { body += c; if (body.length > 10_000) { reject(new Error("too large")); req.destroy(); } });
    req.on("end", () => { try { resolve(JSON.parse(body || "{}")); } catch (e) { reject(e); } });
  });
}

function send(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}

function serveFile(res, file, extraHeaders) {
  fs.readFile(path.join(PUBLIC_DIR, file), (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0", "Pragma": "no-cache", ...(extraHeaders || {}) });
    res.end(buf);
  });
}

const validId = id => typeof id === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(id);

/* ---------- routes ---------- */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    // Issue the phone's anonymous id on its first visit; later scans reuse it.
    if (cookieId(req)) return serveFile(res, "index.html");
    const secure = (req.headers["x-forwarded-proto"] || "").includes("https") ? "; Secure" : "";
    const id = crypto.randomUUID().replace(/-/g, "");
    return serveFile(res, "index.html", { "Set-Cookie": `${COOKIE}=${id}; Max-Age=31536000; Path=/; SameSite=Lax${secure}` });
  }
  if (req.method === "GET" && (p === "/prezentare" || p === "/prezentare.html")) return serveFile(res, "prezentare.html");

  if (req.method === "GET" && p === "/api/info") {
    return send(res, 200, { participantUrl: participantUrl(req) + "?v=" + BUILD, stats: stats() });
  }

  if (req.method === "GET" && p === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no"
    });
    res.write("retry: 3000\n\n");
    const role = url.searchParams.get("role");
    const id = url.searchParams.get("id");
    const ping = setInterval(() => res.write(": ping\n\n"), 20000);

    if (role === "presenter") {
      presenters.add(res);
      res.write(`event: stats\ndata: ${JSON.stringify(stats())}\n\n`);
      req.on("close", () => { clearInterval(ping); presenters.delete(res); });
    } else {
      // Participants report presence through /api/hello; the stream is for the host screen only.
      clearInterval(ping);
      res.end();
    }
    return;
  }

  // Heartbeat from the visible form (every ~10 s) and goodbye when the page is closed.
  if (req.method === "POST" && (p === "/api/hello" || p === "/api/bye")) {
    try {
      const b = await readJson(req);
      if (!validId(b.id)) return send(res, 400, { error: "Date incomplete." });
      if (p === "/api/hello") touch(b.id); else leave(b.id);
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: "Cerere invalidă." }); }
  }

  if (req.method === "POST" && p === "/api/submit") {
    try {
      const b = await readJson(req);
      if (!validId(b.id) || !["acc", "spend"].includes(b.verdict) || !Number.isInteger(b.bracket) || b.bracket < 0 || b.bracket >= BRACKETS.length) {
        return send(res, 400, { error: "Date incomplete." });
      }
      // Only the verdict, age bracket and ratio are kept: no names, no amounts.
      const pct = Number.isFinite(b.pct) ? Math.max(-1000, Math.min(10000, Math.round(b.pct))) : null;
      submissions[b.id] = { verdict: b.verdict, bracket: b.bracket, pct, at: Date.now() };
      persist(); broadcast();
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: "Cerere invalidă." }); }
  }

  if (req.method === "POST" && p === "/api/reset") {
    try {
      const b = await readJson(req);
      if (b.key !== ADMIN_KEY) return send(res, 403, { error: "Cheie de prezentator greșită." });
      submissions = {};
      persist(); broadcast();
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 400, { error: "Cerere invalidă." }); }
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Pagina nu există.");
});

/* ---------- public link (Cloudflare quick tunnel) ---------- */
// Opens a free https://….trycloudflare.com address that works from any network, mobile data included.
// The address changes on every start; the host screen picks it up and redraws the QR by itself.
let tunnelUrl = null;
let tunnelProc = null;

function findCloudflared() {
  const exe = process.platform === "win32" ? "cloudflared.exe" : "cloudflared";
  const local = path.join(__dirname, "bin", exe);
  if (fs.existsSync(local)) return local;
  const known = ["C:\\Program Files (x86)\\cloudflared\\cloudflared.exe", "C:\\Program Files\\cloudflared\\cloudflared.exe"];
  return known.find(p => fs.existsSync(p)) || "cloudflared"; // last resort: whatever is on PATH
}

let tunnelMissing = false;
function startTunnel() {
  // Hosted platforms (Render) already give the app a public https address.
  if (PUBLIC_URL || process.env.TUNNEL === "0" || process.env.RENDER || tunnelMissing) return;
  try {
    tunnelProc = spawn(findCloudflared(), ["tunnel", "--no-autoupdate", "--url", `http://localhost:${PORT}`], { windowsHide: true });
  } catch (e) { console.log("  Linkul public nu a putut porni: " + e.message); return; }
  const onOutput = chunk => {
    const m = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (m && m[0] !== tunnelUrl) {
      tunnelUrl = m[0];
      console.log(`\n  LINK PUBLIC (merge de oriunde): ${tunnelUrl}/`);
      console.log(`  Ecran prezentare public:        ${tunnelUrl}/prezentare?key=${ADMIN_KEY}\n`);
    }
  };
  tunnelProc.stdout.on("data", onOutput);
  tunnelProc.stderr.on("data", onOutput);
  tunnelProc.on("error", () => {
    tunnelMissing = true; // not installed: stay on the local network, don't retry
    console.log("  Cloudflare Tunnel nu este instalat: QR-ul folosește rețeaua locală.");
  });
  tunnelProc.on("exit", code => {
    tunnelUrl = null; tunnelProc = null;
    if (!shuttingDown && !tunnelMissing) { console.log(`  Linkul public s-a oprit (cod ${code}). Repornesc în 5 secunde…`); setTimeout(startTunnel, 5000); }
  });
}

let shuttingDown = false;
function shutdown() { shuttingDown = true; if (tunnelProc) tunnelProc.kill(); process.exit(0); }
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
process.on("exit", () => { if (tunnelProc) tunnelProc.kill(); });

server.listen(PORT, () => {
  const base = PUBLIC_URL || `http://${lanAddress()}:${PORT}`;
  console.log("\n  Simulator Avere Netă rulează.\n");
  console.log(`  Ecran prezentare (proiector):  http://localhost:${PORT}/prezentare?key=${ADMIN_KEY}`);
  console.log(`  Link participanți (rețea locală): ${base}/`);
  console.log(`  Cheie prezentator (resetare):  ${ADMIN_KEY}`);
  if (!PUBLIC_URL && process.env.TUNNEL !== "0" && !process.env.RENDER) console.log("  Se deschide linkul public…");
  console.log("");
  startTunnel();
});
