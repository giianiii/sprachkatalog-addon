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

export function streamHasLanguage(stream, lang) {
  const filename = stream.behaviorHints?.filename || "";
  const folder = stream.behaviorHints?.folderName || "";
  if (CYRILLIC.test(filename) || CYRILLIC.test(folder)) return false;

  const description = stream.description || stream.title || "";
  const audioLine = description.split("\n").find((l) => l.includes("🔊"));
  if (audioLine) {
    const audioPart = audioLine.split(SUB_MARKER)[0];
    // ⛿ = Sprache nur aus dem Dateinamen geraten (unsicher). Dann nur zählen, wenn der Name
    // eindeutig nach deutscher Tonspur aussieht – nicht bei Sammel-Listen wie „English + French + German“.
    const guessed = audioPart.includes("⛿");
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
// Eindeutige Hinweise auf eine Tonspur im Dateinamen, z. B. „German.DL“, „Ger.Eng“, „GERMAN.AC3“
function strongFilename(name, lang) {
  if (!lang.strongPattern || / \+ /.test(name)) return false;
  return new RegExp(lang.strongPattern, "i").test(name);
}

export function isRateLimited(streams) {
  return streams.some((s) => /rate.?limit/i.test(`${s.name || ""} ${s.description || ""} ${s.title || ""}`));
}

export function isCached(stream) {
  return (stream.name || "").includes("⚡");
}

export function detectLanguage(streams, lang, { onlyCached = true } = {}) {
  return streams.some((s) => (!onlyCached || isCached(s)) && streamHasLanguage(s, lang));
}
