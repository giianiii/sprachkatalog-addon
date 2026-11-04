// Erkennt, ob unter den Streams von AIOStreams einer mit Tonspur in der Zielsprache ist.
//
// Grundlage ist die Anzeige der AIOStreams-Konfiguration:
//  - Zeile mit 🔊 listet Tonsprachen als Flaggen; danach folgen Untertitel als "sᴜʙ (…)".
//    Flaggen nach "sᴜʙ" zählen nicht (nur Untertitel).
//  - Gecachte Streams tragen ⚡ im Namen.
// Zusätzlich: Dateinamen mit kyrillischen Zeichen werden nie als Zielsprache gezählt
// (russische Releases sind oft falsch als Deutsch markiert), und als Rückfall wird der
// Dateiname auf typische Sprachkürzel geprüft.

const CYRILLIC = /[Ѐ-ӿ]/;
const SUB_MARKER = /s[ᴜu][ʙb]\s*\(/i;

export function streamHasLanguage(stream, lang, { strict = true } = {}) {
  const filename = stream.behaviorHints?.filename || "";
  const folder = stream.behaviorHints?.folderName || "";
  if (CYRILLIC.test(filename) || CYRILLIC.test(folder)) return false;

  const description = stream.description || stream.title || "";
  const audioLine = description.split("\n").find((l) => l.includes("🔊"));
  if (audioLine) {
    const audioPart = audioLine.split(SUB_MARKER)[0];
    // ⛿ = Sprache nur aus dem Dateinamen geraten (unsicher). Dann nur zählen, wenn der Name
    // eindeutig nach deutscher Tonspur aussieht – nicht bei Sammel-Listen wie „English + French + German“.
    const guessed = strict && audioPart.includes("⛿");
    if (audioPart.includes(lang.flag) && (!guessed || strongFilename(filename || folder, lang))) return true;
    if (guessed) return false;
  }

  if (lang.filenamePattern) {
    const re = new RegExp(lang.filenamePattern, "i");
    // "German Subs" o.ä. ist kein Ton
    const withoutSubs = filename.replace(/(german|ger|deutsch|italian|ita)[ ._-]*(subs?|subbed)/gi, "");
    if (re.test(withoutSubs)) return true;
  }
  return false;
}

// ElfHosted ersetzt bei erreichtem Limit die Liste durch einen einzelnen Hinweis-Eintrag.
// Geratene Sprache (⛿) aus dem Dateinamen: zählt, wenn die Sprache im Namen steht – ausser der Name
// ist eine Sprach-Liste („English + French + German“, „Eng, Ger, Fra“) oder meint nur Untertitel.
const LIST_LIKE = / \+ |\b[a-z]{2,10}\s*,\s*[a-z]{2,10}\s*,|\bmulti[ ._-]?subs?\b/i;
function strongFilename(name, lang) {
  if (!name || LIST_LIKE.test(name) || !lang.filenamePattern) return false;
  const withoutSubs = name.replace(/(german|ger|deutsch|italian|ita)[ ._-]*(subs?|subbed|subtitles?)/gi, "");
  return new RegExp(lang.filenamePattern, "i").test(withoutSubs);
}

// Fehlermeldungen einzelner Quellen („[❌] Comet …“) und Statistik-Einträge von AIOStreams
// (🔍/🚫/🧩/⏱️/📅/📊) sind kein Limit der Instanz und dürfen den Lauf nicht abbrechen.
const INFO_ENTRY = /^\s*(\[❌\]|🔍|🚫|🧩|⏱|📅|📊)/u;
export function isInfoEntry(stream) {
  return INFO_ENTRY.test(stream.name || "");
}

export function isRateLimited(streams) {
  return streams.some((s) => !isInfoEntry(s) && /rate.?limit/i.test(`${s.name || ""} ${s.description || ""} ${s.title || ""}`));
}

export function isCached(stream) {
  return (stream.name || "").includes("⚡");
}

export function isUncached(stream) {
  return (stream.name || "").includes("⏳");
}

// Seeder-Zahl ungecachter Streams: die Anzeige schreibt sie als „⇄ 1239❦“ (auch „⇄ 1.2k❦“)
export function seeders(stream) {
  const m = /⇄\s*([\d.,]+)\s*(k?)\s*❦/i.exec(stream.description || stream.title || "");
  if (!m) return 0;
  const n = m[2] ? parseFloat(m[1].replace(",", ".")) * 1000 : Number(m[1].replace(/[.,]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

// Zählt ein Stream? Gecacht immer; ungecacht nur mit genug Seedern (lädt dann schnell nach)
export function isUsable(stream, { onlyCached = true, minSeeders = 0 } = {}) {
  if (!onlyCached || isCached(stream)) return true;
  return minSeeders > 0 && isUncached(stream) && seeders(stream) >= minSeeders;
}

export function detectLanguage(streams, lang, opts = {}) {
  return streams.some((s) => isUsable(s, opts) && streamHasLanguage(s, lang));
}

// Für die Auswertung: welcher Debrid-Dienst liefert die Zielsprache, und hätte die alte,
// lockere Regel (geratenes ⛿ immer zählen) ein anderes Ergebnis ergeben?
// uncachedOnly: Zielsprache nur ungecacht (mit genug Seedern) vorhanden; seeds = beste Seeder-Zahl davon.
export function languageInfo(streams, lang, opts = {}) {
  const usable = streams.filter((s) => isUsable(s, opts));
  const hits = usable.filter((s) => streamHasLanguage(s, lang));
  const services = [...new Set(hits.map((s) => /\[([A-Z]{2,3})\]/.exec(s.description || "")?.[1] || "?"))].sort();
  const looseOk = usable.some((s) => streamHasLanguage(s, lang, { strict: false }));
  const uncachedOnly = hits.length > 0 && !hits.some(isCached);
  return {
    ok: hits.length > 0, services, onlyByLooseRule: !hits.length && looseOk,
    uncachedOnly, seeds: uncachedOnly ? Math.max(...hits.map(seeders)) : undefined,
  };
}
