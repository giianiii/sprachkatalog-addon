// Regeltest, nur lesend: vergleicht die heutige Deutsch-Erkennung (detect.mjs) mit dem
// Kandidaten aus regel-kandidat.mjs an einer Stichprobe von Titeln, die heute als deutsch gelten.
// Ändert weder Prüfstand (state.json) noch Kataloge. Gibt nie Abspiel-Links aus.

import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isInfoEntry, isRateLimited, isUsable, streamHasLanguage } from "./detect.mjs";
import { streamHasLanguageNeu } from "./regel-kandidat.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const settings = JSON.parse(await readFile(join(ROOT, "config", "settings.json"), "utf8"));
const AIO_URL = process.env.AIOSTREAMS_URL || "";
const PAGES_URL = (process.env.PAGES_URL || "").replace(/\/+$/, "");
const SAMPLE = Math.max(5, Math.min(Number(process.env.SAMPLE || 40), 60));
const EXTRA = (process.env.EXTRA || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 10);
const lang = { ...settings.languages.de, code: "de" };
const opts = { onlyCached: settings.check.onlyCached, minSeeders: settings.check.minSeedersUncached || 0 };
const RISK_LANGS = ["es", "pt", "fr", "it", "ca", "nl"]; // Sprachen mit „de“ als gewöhnlichem Wort
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!/^https:\/\/.+\/manifest\.json$/.test(AIO_URL)) throw new Error("AIOSTREAMS_URL fehlt (GitHub Secret).");
if (!PAGES_URL) throw new Error("PAGES_URL fehlt.");
const AIO_BASE = AIO_URL.slice(0, -"manifest.json".length);

const out = [];
const say = (s = "") => { console.log(s); out.push(s); };

const state = await (await fetch(`${PAGES_URL}/state.json`, { headers: { "cache-control": "no-cache" } })).json();
const results = state.results?.de || {};

// Titel der Hauptreihen (sichtbar auf der Startseite) und Bestand
const rowItems = new Map();
for (const row of settings.rows) for (const it of state.rows?.[row.id]?.items || []) if (!rowItems.has(it.key)) rowItems.set(it.key, it);
const poolItems = new Map();
for (const it of state.pool?.[lang.tmdbLanguage]?.items || []) if (!rowItems.has(it.key)) poolItems.set(it.key, it);
const all = new Map([...rowItems, ...poolItems]);

const positives = [...all.values()].filter((it) => results[it.key]?.ok);
const imdbOf = (it) => state.imdb?.[it.key] || (/tt\d+$/.exec(it.key) || [])[0];

// Stichprobe: 1) bekannte Fälle per Namen, 2) Hälfte Risiko-Sprachen, 3) Rest zufällig aus den Hauptreihen
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const chosen = new Map();
for (const word of EXTRA) for (const it of positives) if ((it.name || "").toLowerCase().includes(word) && chosen.size < SAMPLE) chosen.set(it.key, { it, grund: `gesucht „${word}“` });
const risk = shuffle(positives.filter((it) => RISK_LANGS.includes(it.origLang) && !chosen.has(it.key)));
for (const it of risk.slice(0, Math.floor((SAMPLE - chosen.size) / 2))) chosen.set(it.key, { it, grund: `Original ${it.origLang}` });
const rest = shuffle(positives.filter((it) => rowItems.has(it.key) && !chosen.has(it.key)));
for (const it of rest) { if (chosen.size >= SAMPLE) break; chosen.set(it.key, { it, grund: "Hauptreihe, zufällig" }); }

say(`## Regeltest: neue Regel gegen „de“ im Titel`);
say(`Titel mit Deutsch: ${positives.length} (davon Original ${RISK_LANGS.join("/")}: ${positives.filter((it) => RISK_LANGS.includes(it.origLang)).length}). Stichprobe: ${chosen.size}.`);
say(`Nur lesend – Prüfstand und Listen bleiben unverändert.`);

async function streams(type, id) {
  const url = `${AIO_BASE}stream/${type}/${encodeURIComponent(id)}.json`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 90e3);
    try {
      const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`AIOStreams HTTP ${res.status}`);
      const list = (await res.json()).streams || [];
      if (!isRateLimited(list)) return list;
      console.log("Limit erreicht, warte 65 s …");
      await sleep(65e3);
    } catch (e) {
      throw new Error(e.name === "AbortError" ? "AIOStreams Zeitüberschreitung" : e.message);
    } finally { clearTimeout(timer); }
  }
  throw new Error("AIOStreams-Limit");
}

const g = { faellt: [], bleibtWeniger: [], gleich: [], heuteNichtMehr: [], fehler: [] };
for (const { it, grund } of chosen.values()) {
  const imdb = imdbOf(it);
  const label = `${it.name}${it.releaseDate ? ` (${String(it.releaseDate).slice(0, 4)})` : ""} · ${it.type === "movie" ? "Film" : "Serie"} · ${grund}`;
  if (!imdb) { g.fehler.push(`${label}: keine IMDb-ID`); continue; }
  const type = it.type === "series" ? "series" : "movie";
  const id = type === "series" ? `${imdb}:${state.seasons?.[imdb]?.season || 1}:1` : imdb;
  try {
    const list = (await streams(type, id)).filter((s) => !isInfoEntry(s) && isUsable(s, opts));
    const alt = list.filter((s) => streamHasLanguage(s, lang));
    const neu = alt.filter((s) => streamHasLanguageNeu(s, lang));
    const weg = alt.filter((s) => !neu.includes(s)).map((s) => `    📄 ${(s.behaviorHints?.filename || s.behaviorHints?.folderName || "(ohne Dateiname)").slice(0, 160)}`);
    const zeile = `${label} – deutsche Streams heute ${alt.length}, neu ${neu.length}`;
    if (!alt.length) g.heuteNichtMehr.push(zeile);
    else if (!neu.length) g.faellt.push([zeile, ...weg].join("\n"));
    else if (weg.length) g.bleibtWeniger.push([zeile, ...weg].join("\n"));
    else g.gleich.push(zeile);
  } catch (e) { g.fehler.push(`${label}: ${e.message}`); }
  await sleep(settings.check.delayMs);
}

const titel = {
  faellt: "❌ Würde aus den Listen fallen (bitte prüfen: echtes Deutsch oder Fehltreffer?)",
  bleibtWeniger: "⚠️ Bleibt drin, verliert aber einzelne Streams",
  gleich: "✅ Keine Änderung",
  heuteNichtMehr: "ℹ️ Schon heute kein Deutsch mehr (Cache geändert, unabhängig von der Regel)",
  fehler: "Nicht prüfbar",
};
say("");
say("| Ergebnis | Anzahl |");
say("|---|---|");
for (const k of Object.keys(g)) say(`| ${titel[k]} | ${g[k].length} |`);
for (const k of ["faellt", "bleibtWeniger", "heuteNichtMehr", "fehler", "gleich"]) {
  if (!g[k].length) continue;
  say("");
  say(`### ${titel[k]}`);
  for (const line of g[k]) say(`- ${line}`);
}

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
