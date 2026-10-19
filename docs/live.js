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

  window.BilantLive = { BROKERS, ROOT, SESSION_RE, ID_RE, randomId, connectOne, connectFirst };
})();
