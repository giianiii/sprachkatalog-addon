// Einmalige Auswertung, nur lesend: ändert weder den Prüfstand (state.json) noch die Kataloge.
//
// Teil A – Probelauf ohne Real-Debrid: Welche Titel mit Deutsch kamen nur über RD?
//          Rechnet nur mit gespeicherten Ergebnissen, keine AIOStreams-Abfragen.
// Teil B – Stichprobe: bekannte englisch-, deutsch- oder französischsprachige Titel, bei denen
//          kein Deutsch gefunden wurde. Pro Titel: Gibt es offiziell eine deutsche Fassung
//          (Kino- oder Streaming-Start in DE/CH/AT laut TMDB)? Und liefert AIOStreams Deutsch,
//          das nur nicht gecacht ist?
//
// Ausgabe nur ins Log und in die Zusammenfassung des Laufs. Geheimnisse werden nie ausgegeben.

import { appendFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isCached, isInfoEntry, isRateLimited, streamHasLanguage } from "./detect.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const settings = JSON.parse(await readFile(join(ROOT, "config", "settings.json"), "utf8"));
const TMDB_KEY = process.env.TMDB_KEY || "";
const AIO_URL = process.env.AIOSTREAMS_URL || "";
const PAGES_URL = (process.env.PAGES_URL || "").replace(/\/+$/, "");
const SAMPLE = Math.min(Number(process.env.SAMPLE || 50), 60);
const LANGS = ["en", "de", "fr"]; // „logische“ Titel: Synchro auf Deutsch ist hier üblich
const lang = { ...settings.languages.de, code: "de" };
const DAY = 864e5;
const now = Date.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!TMDB_KEY) throw new Error("TMDB_KEY fehlt (GitHub Secret).");
if (!/^https:\/\/.+\/manifest\.json$/.test(AIO_URL)) throw new Error("AIOSTREAMS_URL fehlt (GitHub Secret).");
if (!PAGES_URL) throw new Error("PAGES_URL fehlt.");
const AIO_BASE = AIO_URL.slice(0, -"manifest.json".length);

const out = [];
const say = (s = "") => { console.log(s); out.push(s); };

async function tmdb(path, params = {}) {
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers = { accept: "application/json" };
  if (TMDB_KEY.startsWith("eyJ")) headers.authorization = `Bearer ${TMDB_KEY}`;
  else url.searchParams.set("api_key", TMDB_KEY);
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
    if (!res.ok) throw new Error(`TMDB ${path}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`TMDB ${path}: zu viele Anfragen`);
}

// ---------- Prüfstand lesen (nur lesen) ----------
const state = await (await fetch(`${PAGES_URL}/state.json`, { headers: { "cache-control": "no-cache" } })).json();
const results = state.results?.de || {};
const items = new Map();
const inRows = new Map(); // key → Reihennamen
for (const row of settings.rows) {
  for (const it of state.rows?.[row.id]?.items || []) {
    items.set(it.key, it);
    if (!inRows.has(it.key)) inRows.set(it.key, new Set());
    inRows.get(it.key).add(`${row.name} (${row.type === "movie" ? "Filme" : "Serien"})`);
  }
}
for (const it of state.pool?.[lang.tmdbLanguage]?.items || []) if (!items.has(it.key)) items.set(it.key, it);
const nameOf = (key) => items.get(key)?.name || key;

// ---------- Teil A: ohne Real-Debrid ----------
say("## A) Probelauf ohne Real-Debrid");
say("Nur gespeicherte Ergebnisse, keine neuen Abfragen. Stand jeweils zum Zeitpunkt der letzten Prüfung.");
let withSvc = 0, rdOnly = [], noSvc = 0;
for (const [key, res] of Object.entries(results)) {
  if (!res.ok) continue;
  if (!res.svc) { noSvc++; continue; }
  withSvc++;
  if (res.svc.includes("RD") && !res.svc.includes("TB")) rdOnly.push(key);
}
say(`Titel mit Deutsch und bekanntem Dienst: ${withSvc}. Davon nur über RD: ${rdOnly.length}.`);
say(`Ohne Dienst-Angabe (vor Einführung der Auswertung geprüft): ${noSvc}.`);
const rdByRow = {};
for (const key of rdOnly) for (const r of inRows.get(key) || ["nur Bestand („Alle – Deutsch“)"]) (rdByRow[r] ||= []).push(nameOf(key));
for (const [r, list] of Object.entries(rdByRow).sort((a, b) => b[1].length - a[1].length)) {
  say(`- ${r}: ${list.length} – ${list.slice(0, 12).join(", ")}${list.length > 12 ? " …" : ""}`);
}

// ---------- Diagnose: komplette Stream-Liste für einige bekannte Titel ----------
// Zeigt, welche Quellen SELection nutzt, wie viele Ergebnisse kommen und welche Sprachen angezeigt werden.
// Gibt nur Name, Beschreibung und Dateiname aus – nie die Abspiel-Links (enthalten Zugangsdaten).
const DIAG = (process.env.DIAG || "").split(",").map((x) => x.trim()).filter((x) => /^tt\d+(:\d+:\d+)?$/.test(x)).slice(0, 8);
async function diagnose() {
  if (!DIAG.length) return;
  say("## Diagnose: vollständige Stream-Listen");
  for (const id of DIAG) {
    const type = id.includes(":") ? "series" : "movie";
    try {
      const list = await streams(type, id);
      say("");
      say(`### ${id} – ${list.length} Streams`);
      for (const s of list) {
        // Statistik- und Fehler-Einträge von AIOStreams vollständig ausgeben (zeigen, was welche Quelle lieferte und was gefiltert wurde)
        if (isInfoEntry(s)) {
          say(`- **${(s.name || "").replace(/\n+/g, " ")}**`);
          for (const line of (s.description || "").split("\n").slice(0, 60)) say(`    ${line.slice(0, 200)}`);
          continue;
        }
        const desc = (s.description || s.title || "").replace(/\n+/g, " ⏐ ").slice(0, 400);
        const file = (s.behaviorHints?.filename || "").slice(0, 160);
        say(`- **${(s.name || "").replace(/\n+/g, " ")}** ⏐ ${desc}${file ? ` ⏐ 📄 ${file}` : ""}`);
      }
    } catch (e) { say(`### ${id}: ${e.message}`); }
    await sleep(settings.check.delayMs);
  }
  say("");
}

// ---------- Teil B: Stichprobe ----------
say("");
say(`## B) Stichprobe: ${SAMPLE} bekannte Titel ohne gefundenes Deutsch (Originalsprache ${LANGS.join("/")})`);

const candidates = [];
for (const [key, res] of Object.entries(results)) {
  if (res.ok) continue;
  const it = items.get(key);
  if (!it) continue;
  const released = Date.parse(it.releaseDate);
  // ganz neue Titel: Synchro oft noch unterwegs
  if (Number.isFinite(released) && now - released < 60 * DAY) continue;
  if (it.origLang && !LANGS.includes(it.origLang)) continue;
  candidates.push({ ...it, imdb: state.imdb?.[key] || (/tt\d+$/.exec(key) || [])[0] });
}
// TMDB-Details: Sprache, Bekanntheit, offizielle deutsche Veröffentlichung.
// Titel aus AIOMetadata haben oft nur eine IMDb-ID → TMDB-ID über /find nachschlagen.
const detailed = [];
for (const it of candidates.slice(0, 1500)) {
  const kind = it.type === "movie" ? "movie" : "tv";
  try {
    let tmdbId = it.tmdbId;
    if (!tmdbId && it.imdb) {
      const f = await tmdb(`/find/${it.imdb}`, { external_source: "imdb_id" });
      tmdbId = (kind === "movie" ? f.movie_results : f.tv_results)?.[0]?.id;
    }
    if (!tmdbId) continue;
    const d = await tmdb(`/${kind}/${tmdbId}`, { append_to_response: `watch/providers,external_ids${kind === "movie" ? ",release_dates" : ""}` });
    const date = Date.parse(d.release_date || d.first_air_date || "");
    if (!LANGS.includes(d.original_language) || (d.vote_count || 0) < 300) continue;
    if (Number.isFinite(date) && now - date < 60 * DAY) continue;
    detailed.push({ it, d });
  } catch (e) { console.log(`TMDB ${it.name}: ${e.message}`); }
  await sleep(30);
}
detailed.sort((a, b) => (b.d.popularity || 0) - (a.d.popularity || 0));
const movies = detailed.filter((x) => x.it.type === "movie").slice(0, Math.round(SAMPLE * 0.7));
const series = detailed.filter((x) => x.it.type === "series").slice(0, SAMPLE - movies.length);
const sample = [...movies, ...series];
say(`Kandidaten: ${candidates.length}, davon bekannt genug: ${detailed.length}. Stichprobe: ${movies.length} Filme, ${series.length} Serien.`);

function officialGerman(d, type) {
  const prov = d["watch/providers"]?.results || {};
  const where = [];
  for (const c of ["CH", "DE", "AT"]) {
    const p = prov[c];
    if (!p) continue;
    const names = [...(p.flatrate || []), ...(p.rent || []), ...(p.buy || [])].map((x) => x.provider_name);
    if (names.length) where.push(`${c}: ${[...new Set(names)].slice(0, 2).join("/")}`);
  }
  if (type === "movie") {
    for (const r of d.release_dates?.results || []) {
      if (["DE", "AT", "CH"].includes(r.iso_3166_1) && (r.release_dates || []).some((x) => x.type === 3)) {
        where.push(`Kino ${r.iso_3166_1}`);
        break;
      }
    }
  }
  return where;
}

// Eine AIOStreams-Abfrage pro Titel; beim Limit warten statt abbrechen (1 Abfrage pro Minute)
async function streams(type, id) {
  const url = `${AIO_BASE}stream/${type}/${encodeURIComponent(id)}.json`;
  for (let attempt = 0; attempt < 4; attempt++) {
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

await diagnose();

const groups = { nunGecacht: [], nurUngecacht: [], offiziellAberKeineQuelle: [], keineOffizielleFassung: [], fehler: [] };
for (const { it, d } of sample) {
  const imdb = d.external_ids?.imdb_id || d.imdb_id;
  const year = (d.release_date || d.first_air_date || "").slice(0, 4);
  const label = `${d.title || d.name} (${year}, ${d.original_language})`;
  const official = officialGerman(d, it.type);
  if (!imdb) { groups.fehler.push(`${label}: keine IMDb-ID`); continue; }
  let id = imdb, type = "movie";
  if (it.type === "series") {
    type = "series";
    const s = d.last_episode_to_air?.season_number;
    id = `${imdb}:${Number.isInteger(s) && s >= 1 ? s : 1}:1`;
  }
  try {
    const list = await streams(type, id);
    const de = list.filter((s) => streamHasLanguage(s, lang));
    const deCached = de.filter(isCached);
    const info = `${label} – ${list.length} Streams, ${list.filter(isCached).length} gecacht, Deutsch: ${deCached.length} gecacht / ${de.length - deCached.length} ungecacht · ${official.join(", ") || "keine DE/CH/AT-Veröffentlichung bei TMDB"}`;
    if (deCached.length) groups.nunGecacht.push(info);
    else if (de.length) groups.nurUngecacht.push(info);
    else if (official.length) groups.offiziellAberKeineQuelle.push(info);
    else groups.keineOffizielleFassung.push(info);
  } catch (e) {
    groups.fehler.push(`${label}: ${e.message}`);
  }
  await sleep(settings.check.delayMs);
}

const titles = {
  nunGecacht: "Jetzt doch gecacht mit Deutsch (war nur zeitweise nicht verfügbar)",
  nurUngecacht: "Deutsch vorhanden, aber nicht gecacht (Cache-Lücke)",
  offiziellAberKeineQuelle: "Offiziell auf Deutsch erschienen, aber keine Quelle mit Deutsch (Quellen-Lücke → Usenet/weitere Scraper)",
  keineOffizielleFassung: "Keine deutsche Veröffentlichung gefunden (vermutlich keine Synchro)",
  fehler: "Nicht prüfbar",
};
say("");
say("| Ergebnis | Anzahl |");
say("|---|---|");
for (const k of Object.keys(groups)) say(`| ${titles[k]} | ${groups[k].length} |`);
for (const k of Object.keys(groups)) {
  if (!groups[k].length) continue;
  say("");
  say(`### ${titles[k]}`);
  for (const line of groups[k]) say(`- ${line}`);
}

if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, out.join("\n") + "\n");
