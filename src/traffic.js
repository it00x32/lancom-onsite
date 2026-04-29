// ── Traffic cache (in-memory, wird bei Neustart zurückgesetzt) ────────────────
const trafficPrev = {}; // ip → { ts, ifaces: { idx: { in, out } } }
const TRAFFIC_TTL = 2 * 3600 * 1000; // 2 Stunden
setInterval(() => {
  const cutoff = Date.now() - TRAFFIC_TTL;
  for (const ip of Object.keys(trafficPrev)) {
    if (trafficPrev[ip].ts < cutoff) delete trafficPrev[ip];
  }
}, TRAFFIC_TTL / 2);

module.exports = { trafficPrev, TRAFFIC_TTL };
