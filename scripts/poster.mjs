// Entscheidet, ob ein Poster-Link aus AIOMetadata veröffentlicht werden darf.
// Die Kataloge sind öffentlich, darum darf kein Link einen privaten Schlüssel oder
// einen Teil der geheimen AIOMetadata-Adresse enthalten. Sonst: undefined
// (der Build setzt dann ein neutrales Poster ein).

// Öffentlich dokumentierte Gratis-Schlüssel, die jeder benutzen darf
const PUBLIC_KEYS = new Set(["t0-free-rpdb"]);
const KEY_PARAMS = /^(key|api_?key|apikey|token|access_token|auth|password|uuid)$/i;

export function safePoster(poster, secretUrl = "") {
  if (!poster) return undefined;
  let url;
  try { url = new URL(poster); } catch { return undefined; }
  if (url.protocol !== "https:" || url.username || url.password) return undefined;

  // Kein langer Teil der geheimen Adresse (z.B. Konfigurations-ID) darf im Link vorkommen
  if (secretUrl) {
    let secretParts = [];
    try {
      const s = new URL(secretUrl);
      secretParts = [...s.pathname.split("/"), ...s.searchParams.values()].filter((p) => p.length >= 16);
    } catch { /* ungültige Adresse: nichts zu vergleichen */ }
    const decoded = decodeURIComponent(poster);
    if (secretParts.some((p) => decoded.includes(p))) return undefined;
  }

  // Schlüssel-Parameter nur, wenn es ein bekannter öffentlicher Gratis-Schlüssel ist
  for (const [name, value] of url.searchParams) {
    if (KEY_PARAMS.test(name) && !PUBLIC_KEYS.has(value)) return undefined;
  }
  // RPDB-Schlüssel stehen teils im Pfad (/<key>/imdb/...)
  const rpdbPathKey = url.hostname.includes("ratingposterdb") ? url.pathname.split("/")[1] : null;
  if (rpdbPathKey && !PUBLIC_KEYS.has(rpdbPathKey)) return undefined;

  return poster;
}
