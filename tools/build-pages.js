// Builds the GitHub Pages version (docs/) from the server version (public/).
// The form and the host screen stay identical; only the live transport changes:
// server endpoints -> public MQTT relay (docs/live.js). Run: node tools/build-pages.js
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const read = f => fs.readFileSync(path.join(root, f), "utf8");
const write = (f, s) => fs.writeFileSync(path.join(root, f), s);

function replaceOnce(s, from, to, label) {
  const n = s.split(from).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1 match, found ${n}`);
  return s.replace(from, to);
}
function replaceBetween(s, start, end, to, label) {
  const a = s.indexOf(start), b = s.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error(`${label}: markers not found`);
  return s.slice(0, a) + to + s.slice(b);
}

const LIBS = `<script src="https://cdnjs.cloudflare.com/ajax/libs/mqtt/5.10.1/mqtt.min.js"></script>
<script src="live.js"></script>
`;

/* ---------- participant form ---------- */
let form = read("public/index.html");
form = replaceOnce(form, "</head>", LIBS + "</head>", "form libs");
form = replaceOnce(form, "bye(); setPid(newId()); hello();", "bye(); setPid(newId()); connectLive();", "form new participant");
form = replaceBetween(form, "  /* ---------- live session", "  const KEY = ", `  /* ---------- live session (GitHub Pages): one anonymous id per phone, presence and result over MQTT ---------- */
  var usingSample = false;
  const L = window.BilantLive || null;
  const PID_KEY = "bilant-pid";
  const SESS_KEY = "bilant-session";
  const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;
  function newId(){ return (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(36) + Math.random().toString(36).slice(2))).replace(/[^a-zA-Z0-9_-]/g,""); }
  function readCookie(){ const m = document.cookie.match(/(?:^|;\\s*)bilant_pid=([a-zA-Z0-9_-]{8,64})/); return m ? m[1] : null; }
  function setPid(id){
    pid = id;
    try{ localStorage.setItem(PID_KEY, id); }catch(e){}
    document.cookie = "bilant_pid=" + id + "; Max-Age=31536000; Path=/; SameSite=Lax" + (location.protocol === "https:" ? "; Secure" : "");
  }
  // Same phone, same id: scanning the QR again continues as the same participant.
  let pid = null;
  try{ pid = localStorage.getItem(PID_KEY); }catch(e){}
  if (!pid || !ID_RE.test(pid)) pid = readCookie();
  if (!pid || !ID_RE.test(pid)) pid = newId();
  setPid(pid);

  // The session comes from the QR (?s=…&b=…) and is remembered, so a reload stays in the same session.
  let session = null, brokerIx = 0;
  (function(){
    if (!L) return;
    const q = new URLSearchParams(location.search);
    let s = q.get("s"), b = parseInt(q.get("b"), 10);
    if (!(s && L.SESSION_RE.test(s))){
      s = null;
      try{ const st = JSON.parse(localStorage.getItem(SESS_KEY) || "null"); if (st && L.SESSION_RE.test(st.s)){ s = st.s; b = st.b; } }catch(e){}
    }
    if (!s) return;
    if (!(b >= 0 && b < L.BROKERS.length)) b = 0;
    try{ localStorage.setItem(SESS_KEY, JSON.stringify({s, b})); }catch(e){}
    session = s; brokerIx = b;
  })();
  const isLive = !!(session && L && window.mqtt);
  const base = session && L ? L.ROOT + session : null;
  const presenceTopic = () => base + "/p/" + pid;

  let client = null;
  let active = true; // false while another tab of this phone holds the form
  function connectLive(){
    if (!isLive) return;
    if (client){ try{ client.end(true); }catch(e){} }
    client = window.mqtt.connect(L.BROKERS[brokerIx], {
      clientId: "bilant_p_" + L.randomId(10), connectTimeout: 8000, reconnectPeriod: 3000, keepalive: 30, clean: true, queueQoSZero: false,
      will: { topic: presenceTopic(), payload: "0", qos: 0, retain: false } // the relay says "left" if the phone drops
    });
    client.on("connect", hello);
    client.on("error", () => {});
  }
  function hello(){ if (isLive && active && client && client.connected && document.visibilityState === "visible") client.publish(presenceTopic(), "1", {qos: 0}); }
  function bye(){ if (client && client.connected) client.publish(presenceTopic(), "0", {qos: 0}); }
  connectLive();
  setInterval(hello, 10000);
  document.addEventListener("visibilitychange", hello);
  window.addEventListener("pagehide", e => { if (!e.persisted && active) bye(); });
  window.addEventListener("pageshow", e => { if (e.persisted) hello(); });

  // A second scan opens a new tab: the newest tab takes over, older ones step aside and disconnect.
  const TAB = newId();
  let channel = null;
  try{ channel = new BroadcastChannel("bilant-form"); }catch(e){}
  function claim(){ active = true; $("#otherTab").hidden = true; if (channel) channel.postMessage({type:"claim", tab: TAB}); hello(); }
  if (channel) channel.onmessage = ev => {
    if (!ev.data || ev.data.type !== "claim" || ev.data.tab === TAB) return;
    active = false; $("#otherTab").hidden = false;
    if (client){ try{ client.end(); }catch(e){} client = null; } // graceful: no "left" message, the new tab carries on
  };
  $("#takeOver").addEventListener("click", () => { claim(); location.reload(); });
  claim();

  async function submitResult(){
    const note = $("#sentNote"), txt = $("#sentTxt");
    const c = compute();
    if (!c.ready) return;
    note.hidden = false; note.className = "sent";
    if (usingSample){ txt.textContent = "Acesta este exemplul din prezentare. Nu se trimite."; return; }
    if (!session){ txt.textContent = "Rezultatul este doar pe acest telefon. Ca să fie numărat, scanează codul QR de pe ecranul prezentatorului."; return; }
    if (!isLive || !client){ note.className = "sent bad"; txt.textContent = "Nu ne-am putut conecta la sesiune. Verifică internetul și reîncarcă pagina."; return; }
    txt.textContent = "Se trimite…";
    const payload = JSON.stringify({verdict: c.acc ? "acc" : "spend", bracket: BRACKETS.indexOf(c.br), at: Date.now()});
    const ok = await new Promise(resolve => {
      const timer = setTimeout(() => resolve(false), 15000);
      client.publish(base + "/r/" + pid, payload, {qos: 1, retain: true}, err => { clearTimeout(timer); resolve(!err); });
    });
    if (ok){ note.className = "sent ok"; txt.textContent = "Răspunsul tău a fost trimis, anonim."; }
    else { note.className = "sent bad"; txt.textContent = "Rezultatul nu a putut fi trimis. Verifică internetul, apasă „Modifică datele”, apoi trimite din nou."; }
  }

`, "form live block");
write("docs/formular.html", form); // opened only from the QR

/* ---------- host screen ---------- */
let host = read("public/prezentare.html");
host = replaceOnce(host, "</head>", LIBS + "</head>", "host libs");
host = replaceOnce(host, `<button type="button" class="btn danger" id="reset" hidden>Sesiune nouă</button>`, `<button type="button" class="btn danger" id="reset">Sesiune nouă</button>`, "host reset");
host = replaceOnce(host, `Ștergi toate rezultatele?`, `Pornești o sesiune nouă, cu cod QR nou?`, "host confirm");
host = replaceOnce(host, `<button type="button" class="btn danger" id="yes">Da, șterge</button>`, `<button type="button" class="btn danger" id="yes">Da, sesiune nouă</button>`, "host yes");
host = host.replace(/\s*<button type="button" class="link-btn" id="editUrlBtn">[\s\S]*?<\/form>/, "");
host = replaceBetween(host, "  const params = new URLSearchParams(location.search);", "  /* ---------- live stats ---------- */", `  const L = window.BilantLive;
  const nf = new Intl.NumberFormat("ro-RO");
  const BRACKETS = ["Până în 25 ani", "26–30 ani", "31–40 ani", "41–60 ani", "Peste 60 ani"];
  const HOST_KEY = "bilant-host-session";
  const TTL = 30000; // ms without a heartbeat before a phone stops counting as active

  /* ---------- QR ---------- */
  function drawQR(text){
    $("#url").textContent = text.replace(/^https?:\\/\\//,"").replace(/\\?.*$/,"").replace(/\\/(formular\\.html)?$/,"");
    const box = $("#qr");
    if (typeof window.qrcode !== "function"){ box.innerHTML = '<span class="fallback"></span>'; box.firstChild.textContent = "Deschide în browser: " + text; return; }
    const qr = window.qrcode(0, "M"); qr.addData(text); qr.make();
    const n = qr.getModuleCount(); let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r,c)) d += \`M\${c} \${r}h1v1h-1z\`;
    box.innerHTML = \`<svg viewBox="0 0 \${n} \${n}" shape-rendering="crispEdges" role="img" aria-label="Cod QR pentru \${text.replace(/"/g,"")}"><rect width="\${n}" height="\${n}" fill="#FFFFFF"/><path d="\${d}" fill="#0B1F45"/></svg>\`;
  }

  /* ---------- session ---------- */
  let session = null;
  try{ session = localStorage.getItem(HOST_KEY); }catch(e){}
  if (!session || !L.SESSION_RE.test(session)) newSession();
  function newSession(){ session = L.randomId(10); try{ localStorage.setItem(HOST_KEY, session); }catch(e){} }
  let client = null, brokerIx = 0;
  const participantLink = () => new URL("formular.html", location.href).href + "?s=" + session + "&b=" + brokerIx;

  const results = new Map(); // phone id -> {verdict, bracket}
  const seen = new Map();    // phone id -> last heartbeat (ms)

`, "host setup");
host = replaceBetween(host, "  function connect(){", "  /* ---------- controls ---------- */", `  function stats(){
    const subs = [...results.values()];
    const acc = subs.filter(s => s.verdict === "acc").length;
    const ids = [...seen.keys()];
    return {
      active: ids.length, filling: ids.filter(id => !results.has(id)).length,
      submitted: subs.length, acc, spend: subs.length - acc,
      byBracket: BRACKETS.map((label, i) => ({ label,
        acc: subs.filter(s => s.bracket === i && s.verdict === "acc").length,
        spend: subs.filter(s => s.bracket === i && s.verdict === "spend").length }))
    };
  }
  let queued = false;
  function schedule(){ if (queued) return; queued = true; setTimeout(() => { queued = false; render(stats()); }, 250); }
  setInterval(() => {
    const cutoff = Date.now() - TTL; let changed = false;
    for (const [id, t] of seen) if (t < cutoff){ seen.delete(id); changed = true; }
    if (changed) schedule();
  }, 5000);

  function onMessage(topic, buf){
    const prefix = L.ROOT + session + "/";
    if (!topic.startsWith(prefix)) return;
    const [kind, id] = topic.slice(prefix.length).split("/");
    if (!L.ID_RE.test(id || "")) return;
    const text = buf.toString();
    if (kind === "r"){
      if (!text) results.delete(id);
      else try{
        const d = JSON.parse(text); // untrusted: keep only well-formed results
        if ((d.verdict === "acc" || d.verdict === "spend") && Number.isInteger(d.bracket) && d.bracket >= 0 && d.bracket < BRACKETS.length) results.set(id, {verdict: d.verdict, bracket: d.bracket});
      }catch(e){}
    } else if (kind === "p"){
      if (text === "1") seen.set(id, Date.now()); else seen.delete(id);
    }
    schedule();
  }

  function setConn(on, txt){ $("#conn").classList.toggle("on", on); $("#connTxt").textContent = txt; }
  const subscribe = () => client.subscribe(L.ROOT + session + "/#", {qos: 1});

  async function start(){
    setConn(false, "Se conectează…");
    try{
      const r = await L.connectFirst({ clientId: "bilant_h_" + L.randomId(10), queueQoSZero: false });
      client = r.client; brokerIx = r.index;
    }catch(e){
      setConn(false, "Fără conexiune live. Reîncerc…"); drawQR(participantLink());
      setTimeout(start, 5000); return;
    }
    client.on("message", onMessage);
    client.on("error", () => {});
    client.on("connect", () => { setConn(true, "Live"); subscribe(); });
    client.on("offline", () => setConn(false, "Reconectare…"));
    client.on("reconnect", () => setConn(false, "Reconectare…"));
    setConn(true, "Live"); subscribe(); drawQR(participantLink());
  }
  render(stats());
  drawQR(participantLink());
  start();

`, "host transport");
host = replaceOnce(host, `  if (key) $("#reset").hidden = false;\n`, "", "host key");
host = replaceBetween(host, `  $("#yes").addEventListener("click", async ()=>{`, "})();\n</script>", `  $("#yes").addEventListener("click", ()=>{
    // A new session gets new topics and a new QR; the previous session's phones are no longer counted.
    if (client) client.unsubscribe(L.ROOT + session + "/#");
    newSession(); results.clear(); seen.clear(); render(stats());
    if (client) subscribe();
    drawQR(participantLink());
    $("#confirm").hidden = true; $("#reset").hidden = false;
  });
`, "host reset handler");
write("docs/index.html", host); // the short link: …/simulator-avere-neta/
// Old bookmarks to prezentare.html land on the host screen.
write("docs/prezentare.html", `<!doctype html><meta charset="utf-8"><title>Simulator Avere Netă</title><meta http-equiv="refresh" content="0; url=./"><a href="./">Deschide ecranul de prezentare</a>\n`);

console.log("docs/ generat: index.html, prezentare.html");
