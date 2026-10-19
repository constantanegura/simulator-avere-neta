// Live session transport for the GitHub Pages version: a free public MQTT relay, no server, no account.
// Only anonymous data travels here: the profile (acumulator / cheltuitor) and the age bracket.
//
// Topics, per session:
//   bilant-avere/v1/<session>/r/<phoneId>   result, retained (the host sees it even after a reload)
//   bilant-avere/v1/<session>/p/<phoneId>   presence: "1" heartbeat every ~10 s, "0" when the page leaves
(function () {
  "use strict";

  // Tried in order by the host screen; the QR tells phones which one the host picked.
  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt"
  ];
  const ROOT = "bilant-avere/v1/";
  const SESSION_RE = /^[a-z0-9]{6,16}$/;
  const ID_RE = /^[a-zA-Z0-9_-]{8,64}$/;

  function randomId(len) {
    const a = new Uint8Array(len);
    crypto.getRandomValues(a);
    return Array.from(a, b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  }

  // Connect to one broker. Resolves with the client once connected, rejects on timeout/error.
  function connectOne(index, options) {
    return new Promise((resolve, reject) => {
      if (!window.mqtt) return reject(new Error("lib"));
      const client = window.mqtt.connect(BROKERS[index], Object.assign({
        clientId: "bilant_" + randomId(12),
        connectTimeout: 8000,
        reconnectPeriod: 3000,
        keepalive: 30,
        clean: true
      }, options || {}));
      const timer = setTimeout(() => { client.end(true); reject(new Error("timeout")); }, 9000);
      client.once("connect", () => { clearTimeout(timer); resolve(client); });
      client.once("error", e => { clearTimeout(timer); client.end(true); reject(e); });
    });
  }

  // Host: first broker that answers.
  async function connectFirst(options) {
    for (let i = 0; i < BROKERS.length; i++) {
      try { return { client: await connectOne(i, options), index: i }; } catch (e) { /* try next */ }
    }
    throw new Error("Niciun releu live nu răspunde.");
  }

  // The QR holds one fixed, name-free link, so it cannot carry the session. Instead the host screen
  // announces its current session here (retained, refreshed every minute) and the form looks it up.
  const ROOM_TOPIC = ROOT + "room/main";
  const FORM_LINK = "https://tinyurl.com/formular-avere-neta"; // redirects to formular.html

  function announceSession(client, session, brokerIndex) {
    client.publish(ROOM_TOPIC, JSON.stringify({ s: session, b: brokerIndex, at: Date.now() }), { qos: 1, retain: true });
  }

  // Asks every relay at once and keeps the freshest announcement: if the host had to switch relays,
  // an older announcement left on another relay loses on its timestamp.
  function discoverSession(waitMs) {
    const one = index => new Promise(resolve => {
      let client = null, done = false;
      const finish = v => { if (done) return; done = true; clearTimeout(timer); try { client && client.end(true); } catch (e) {} resolve(v); };
      const timer = setTimeout(() => finish(null), waitMs || 7000);
      try {
        client = window.mqtt.connect(BROKERS[index], { clientId: "bilant_d_" + randomId(10), connectTimeout: 6000, reconnectPeriod: 0, clean: true });
      } catch (e) { return finish(null); }
      client.on("error", () => finish(null));
      // A retained announcement arrives right after subscribing; silence for 2 s means this relay has none.
      client.on("connect", () => client.subscribe(ROOM_TOPIC, { qos: 1 }, () => setTimeout(() => finish(null), 2000)));
      client.on("message", (topic, buf) => {
        try {
          const d = JSON.parse(buf.toString());
          if (SESSION_RE.test(d.s) && d.b === index && Number.isFinite(d.at)) return finish({ s: d.s, b: d.b, at: d.at });
        } catch (e) {}
        finish(null);
      });
    });
    if (!window.mqtt) return Promise.resolve(null);
    return Promise.all(BROKERS.map((_, i) => one(i))).then(list =>
      list.filter(Boolean).sort((x, y) => y.at - x.at)[0] || null);
  }

  window.BilantLive = { BROKERS, ROOT, SESSION_RE, ID_RE, FORM_LINK, randomId, connectOne, connectFirst, announceSession, discoverSession };
})();
