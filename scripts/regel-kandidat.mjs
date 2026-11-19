// Kandidat für eine strengere Deutsch-Erkennung – wird NUR vom Regeltest benutzt,
// der Katalog-Bau (build.mjs) verwendet weiterhin unverändert detect.mjs.
//
// Problem: AIOStreams liest ein „De“ im Titel nicht-deutscher Releases als Sprachkürzel
// („Una Historia De Gorilas 2026 MULTi“) und zeigt dann 🇩🇪 an, obwohl kein Deutsch drin ist.
//
// Regel: Ein Stream, den die heutige Regel als deutsch zählt, zählt NICHT mehr, wenn
//   1. im Datei-/Ordnernamen nirgends German, GER, Deutsch oder DL steht,
//   2. ein „de“ als eigenes Wort nur im Titelteil vorkommt (vor der Jahreszahl) und
//   3. nach der Jahreszahl kein „DE“ mehr steht.
// Ohne Jahreszahl oder ohne Namen bleibt alles wie bisher (im Zweifel zählen).

import { streamHasLanguage } from "./detect.mjs";

// „DL“ (Dual Language) zählt, aber nicht als Teil von „WEB-DL“
const STRONG = /(^|[^a-z])(german|ger|deutsch)([^a-z]|$)|(?<!web[ ._-]?)(^|[^a-z])dl([^a-z]|$)/i;
const YEAR = /(?:^|[ ._\-([])((?:19|20)\d{2})(?=[ ._\-)\]]|$)/g;
const DE_WORD = /(^|[ ._\-([])de(?=[ ._\-)\]]|$)/gi;

// Liefert true, wenn der Name nur wegen eines „de“ im Titel als deutsch gelten würde.
export function onlyTitleDe(name) {
  if (!name || STRONG.test(name)) return false;
  // letzte Jahreszahl nach mindestens einem Titelwort (Titel wie „1917“ am Anfang überspringen)
  let yearEnd = -1;
  for (const m of name.matchAll(YEAR)) {
    if (m.index > 0) { yearEnd = m.index + m[0].length; break; }
  }
  if (yearEnd < 0) return false;
  const before = [...name.slice(0, yearEnd).matchAll(DE_WORD)].length;
  const after = [...name.slice(yearEnd).matchAll(DE_WORD)].length;
  return before > 0 && after === 0;
}

export function streamHasLanguageNeu(stream, lang) {
  if (!streamHasLanguage(stream, lang)) return false;
  if (lang.flag !== "🇩🇪") return true;
  const file = stream.behaviorHints?.filename || "";
  const folder = stream.behaviorHints?.folderName || "";
  const names = [file, folder].filter(Boolean);
  if (!names.length) return true;
  // zählt weiter, sobald einer der Namen nicht nur ein Titel-„de“ hat
  return !names.every(onlyTitleDe);
}
