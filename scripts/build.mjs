// Baut den statischen Stremio-Katalog: Reihen von TMDB holen, pro Titel über
// AIOStreams prüfen, ob eine Fassung in der Zielsprache existiert, und nur diese
// Titel als JSON-Kataloge nach public/ schreiben (wird von GitHub Pages ausgeliefert).
//
// Sicherheit: TMDB_KEY, AIOSTREAMS_URL und AIOMETADATA_URL kommen nur aus Umgebungsvariablen
// (GitHub Secrets). Sie werden nie geloggt und nie in Ausgabedateien geschrieben.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { detectLanguage, isRateLimited, isCached, streamHasLanguage } from "./detect.mjs";
import { safePoster } from "./poster.mjs";
import { groupByGenre, genreFileName } from "./genres.mjs";

// Öffentliche AIOStreams-Instanz: 100 Abfragen auf Vorrat, dann 1 pro Minute.
class RateLimitError extends Error {
  constructor() { super("AIOStreams-Limit erreicht"); this.name = "RateLimitError"; }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT_DIR || join(ROOT, "public");
const TMDB_KEY = process.env.TMDB_KEY || "";
const AIO_URL = process.env.AIOSTREAMS_URL || "";
const PAGES_URL = (process.env.PAGES_URL || "").replace(/\/+$/, "");
// Optional: Reihen 1:1 aus deinem AIOMetadata übernehmen (sonst Rückfall auf TMDB)
const AIOM_URL = /^https:\/\/.+\/manifest\.json$/.test(process.env.AIOMETADATA_URL || "") ? process.env.AIOMETADATA_URL : "";
const AIOM_BASE = AIOM_URL ? AIOM_URL.slice(0, -"manifest.json".length) : "";

const settings = JSON.parse(await readFile(join(ROOT, "config", "settings.json"), "utf8"));
const now = Date.now();
const HOUR = 3600e3;
const DAY = 24 * HOUR;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

if (!TMDB_KEY) throw new Error("TMDB_KEY fehlt (GitHub Secret).");
if (!/^https:\/\/.+\/manifest\.json$/.test(AIO_URL)) {
  throw new Error("AIOSTREAMS_URL fehlt oder endet nicht auf /manifest.json (GitHub Secret).");
}
const AIO_BASE = AIO_URL.slice(0, -"manifest.json".length);

// ---------- TMDB ----------
async function tmdb(path, params = {}) {
  const url = new URL("https://api.themoviedb.org/3" + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const headers = { accept: "application/json" };
  // v4-Token (JWT) als Bearer, sonst klassischer v3-Key als Parameter
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

async function fetchRow(row, lang) {
  const kind = row.type === "movie" ? "movie" : "tv";
  const items = [];
  for (let page = 1; page <= (settings.pagesPerRow || 3); page++) {
    let data;
    if (row.source.discover) {
      data = await tmdb(`/discover/${kind}`, {
        language: lang.tmdbLanguage,
        watch_region: lang.watchRegion,
        with_watch_providers: row.source.providers,
        with_watch_monetization_types: "flatrate",
        sort_by: "popularity.desc",
        page,
      });
    } else {
      data = await tmdb(row.source.path, { language: lang.tmdbLanguage, region: lang.watchRegion, page });
    }
    for (const r of data.results || []) {
      items.push({
        key: `${row.type}:${r.id}`,
        tmdbId: r.id,
        type: row.type,
        name: r.title || r.name,
        poster: r.poster_path ? `https://image.tmdb.org/t/p/w342${r.poster_path}` : undefined,
        description: r.overview || undefined,
        releaseDate: r.release_date || r.first_air_date || "",
      });
    }
    if (page >= (data.total_pages || 1)) break;
  }
  return items;
}

// ---------- AIOMetadata (deine eigenen Reihen) ----------
let aiomCatalogs = null;
async function aiomManifest() {
  if (aiomCatalogs) return aiomCatalogs;
  const res = await fetch(AIOM_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`AIOMetadata HTTP ${res.status}`);
  aiomCatalogs = (await res.json()).catalogs || [];
  return aiomCatalogs;
}

// Nur harmlose Anzeigefelder übernehmen; Bild-Links nur, wenn sie nichts Geheimes enthalten
function pickExtra(m) {
  const out = {};
  for (const k of ["releaseInfo", "year", "imdbRating", "runtime"]) {
    if (typeof m[k] === "string" || typeof m[k] === "number") out[k] = String(m[k]).slice(0, 40);
  }
  if (Array.isArray(m.genres)) out.genres = m.genres.filter((g) => typeof g === "string").slice(0, 6);
  for (const k of ["background", "logo"]) {
    const safe = safePoster(m[k], AIOM_URL);
    if (safe) out[k] = safe;
  }
  return out;
}

// Reihe über Typ und Namen finden (die internen IDs ändern sich, wenn du AIOMetadata umbaust)
async function fetchRowAiom(row, state) {
  const wanted = row.source.aiometadata;
  const cat = (await aiomManifest()).find((c) => c.type === row.type && c.name === wanted);
  if (!cat) throw new Error(`AIOMetadata-Reihe „${wanted}“ (${row.type}) nicht gefunden`);
  const reverse = {};
  for (const [k, v] of Object.entries(state.imdb)) if (v) reverse[v] = k;
  const items = [];
  const limit = settings.itemsPerRow || 60;
  while (items.length < limit) {
    const extra = items.length ? `/skip=${items.length}` : "";
    const res = await fetch(`${AIOM_BASE}catalog/${row.type}/${encodeURIComponent(cat.id)}${extra}.json`);
    if (!res.ok) throw new Error(`AIOMetadata HTTP ${res.status}`);
    const metas = (await res.json()).metas || [];
    if (!metas.length) break;
    for (const m of metas) {
      let key, tmdbId;
      const tmdbMatch = /^tmdb:(\d+)$/.exec(m.id || "");
      if (tmdbMatch) { tmdbId = Number(tmdbMatch[1]); key = `${row.type}:${tmdbId}`; }
      else if (/^tt\d+$/.test(m.id || "")) {
        key = reverse[m.id] || `${row.type}:${m.id}`;
        if (state.imdb[key] === undefined) state.imdb[key] = m.id;
      } else continue;
      items.push({
        // Rating-Poster nur übernehmen, wenn der Link nichts Geheimes enthält (siehe safePoster)
        key, tmdbId, type: row.type, name: m.name, poster: safePoster(m.poster, AIOM_URL),
        description: m.description || undefined,
        // Anzeige-Infos wie in deinen normalen Reihen (Jahr, Genres, Bewertung, Hintergrund, Logo)
        extra: pickExtra(m),
        releaseDate: m.released || ((m.year || m.releaseInfo) ? `${String(m.year || m.releaseInfo).slice(0, 4)}-01-01` : ""),
      });
    }
    if (metas.length < 10) break;
    await sleep(300);
  }
  return items.slice(0, limit);
}

// Reihen nur alle paar Stunden neu holen (schont das ElfHosted-Limit), dazwischen aus dem Zwischenspeicher
async function getRowItems(row, lang, state) {
  state.rows ||= {};
  const cached = state.rows[row.id];
  const fresh = cached && now - cached.at < (settings.rowRefreshHours || 6) * HOUR;
  // Zwischenspeicher aus älteren Versionen (ohne Jahr/Genres) nicht weiterverwenden
  const complete = sourceKind(row) !== "aiometadata" || (cached?.items || []).every((it) => it.extra);
  if (fresh && complete && cached.source === sourceKind(row)) return cached.items;
  try {
    const items = sourceKind(row) === "aiometadata" ? await fetchRowAiom(row, state) : await fetchRow(row, lang);
    state.rows[row.id] = { at: now, source: sourceKind(row), items };
    return items;
  } catch (e) {
    log(`Reihe ${row.name} (${row.type}) nicht geladen: ${e.message}`);
    if (cached) return cached.items;
    if (row.source.path || row.source.discover) return fetchRow(row, lang); // Rückfall auf TMDB
    return [];
  }
}

function sourceKind(row) {
  return row.source.aiometadata && AIOM_URL ? "aiometadata" : "tmdb";
}

async function imdbIdFor(item, state) {
  if (state.imdb[item.key] !== undefined) return state.imdb[item.key];
  if (!item.tmdbId) return null;
  const kind = item.type === "movie" ? "movie" : "tv";
  const ext = await tmdb(`/${kind}/${item.tmdbId}/external_ids`);
  const id = ext.imdb_id && /^tt\d+$/.test(ext.imdb_id) ? ext.imdb_id : null;
  state.imdb[item.key] = id;
  await sleep(40);
  return id;
}

// ---------- AIOStreams ----------
async function checkStream(type, id, lang) {
  const url = `${AIO_BASE}stream/${type}/${encodeURIComponent(id)}.json`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90e3);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
    // Fehlermeldungen bewusst ohne URL, damit nichts Geheimes im Log landet
    if (!res.ok) throw new Error(`AIOStreams HTTP ${res.status}`);
    const data = await res.json();
    if (isRateLimited(data.streams || [])) throw new RateLimitError();
    return detectLanguage(data.streams || [], lang, { onlyCached: settings.check.onlyCached });
  } catch (e) {
    if (e instanceof RateLimitError) throw e;
    throw new Error(e.name === "AbortError" ? "AIOStreams Zeitüberschreitung" : e.message);
  } finally {
    clearTimeout(timer);
  }
}

// Neueste ausgestrahlte Staffel von TMDB (zählt nicht zum AIOStreams-Limit), 7 Tage zwischengespeichert
async function latestSeason(item, imdbId, state) {
  state.seasons ||= {};
  const cached = state.seasons[imdbId];
  if (cached && now - cached.at < 7 * DAY) return cached.season;
  let season = 1;
  try {
    let tmdbId = item.tmdbId;
    if (!tmdbId) {
      const found = await tmdb(`/find/${imdbId}`, { external_source: "imdb_id" });
      tmdbId = found.tv_results?.[0]?.id;
    }
    if (tmdbId) {
      const tv = await tmdb(`/tv/${tmdbId}`);
      const s = tv.last_episode_to_air?.season_number;
      if (Number.isInteger(s) && s >= 1) season = s;
    }
  } catch (e) {
    log(`Staffel für ${item.name} nicht ermittelt: ${e.message}`);
  }
  state.seasons[imdbId] = { season, at: now };
  return season;
}

// Filme: eine Abfrage. Serien: erst Folge 1 der neuesten Staffel (am ehesten gecacht),
// nur wenn dort nichts Deutsches ist zusätzlich S01E01. Gibt Ergebnis und verbrauchte Abfragen zurück.
async function checkTitle(item, imdbId, lang, state, budget) {
  if (item.type !== "series") return { ok: await checkStream("movie", imdbId, lang), used: 1 };
  const latest = await latestSeason(item, imdbId, state);
  const candidates = [...new Set([`${imdbId}:${latest}:1`, `${imdbId}:1:1`])];
  let used = 0;
  for (const id of candidates) {
    if (used >= budget) return { ok: false, used, incomplete: true };
    if (used > 0) await sleep(settings.check.delayMs);
    used++;
    if (await checkStream("series", id, lang)) return { ok: true, used };
  }
  return { ok: false, used };
}

// ---------- Zustand (Cache) ----------
async function loadState() {
  const empty = { version: 1, imdb: {}, results: {} };
  if (PAGES_URL) {
    try {
      const res = await fetch(`${PAGES_URL}/state.json`, { headers: { "cache-control": "no-cache" } });
      if (res.ok) return { ...empty, ...(await res.json()) };
    } catch { /* erster Lauf oder Seite noch nicht online */ }
  }
  try {
    return { ...empty, ...JSON.parse(await readFile(join(OUT, "state.json"), "utf8")) };
  } catch {
    return empty;
  }
}

function isDue(result, item) {
  if (!result) return true;
  const c = settings.check;
  const age = now - result.at;
  if (result.ok) return age > c.recheckPositiveDays * DAY;
  const released = Date.parse(item.releaseDate);
  const isOld = Number.isFinite(released) && now - released > c.oldTitleDays * DAY;
  return age > (isOld ? c.recheckNegativeOldDays * DAY : c.recheckNegativeHours * HOUR);
}

// ---------- Ausgabe ----------
async function writeJson(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data));
}

// Sammelreihen „Alle – <Sprache>“: alle bestätigten Titel aus allen Reihen, ohne Doppelte
const ALL_ROWS = [
  { id: "all-movie", type: "movie", name: "Alle" },
  { id: "all-series", type: "series", name: "Alle" },
];

function manifestFor(code, lang, rows, genresByRow = {}) {
  return {
    id: `community.sprachkatalog.${code}`,
    version: "1.2.0",
    name: `Sprachkatalog ${lang.label}`,
    description: `Bekannte Reihen, aber nur Titel, für die eine Fassung auf ${lang.label} verfügbar ist.`,
    resources: ["catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs: rows.map((r) => ({
      type: r.type,
      id: `${r.id}-${code}`,
      name: `${r.name}${lang.suffix}`,
      // Genre-Auswahl in Nuvio/Stremio (nur Genres, die in dieser Reihe vorkommen)
      ...(genresByRow[r.id]?.length
        ? { extra: [{ name: "genre", options: genresByRow[r.id], isRequired: false }] }
        : {}),
    })),
    behaviorHints: { configurable: false, configurationRequired: false },
  };
}

// ---------- Fehlersuche (nur wenn in settings.json "debugIds" gesetzt) ----------
// Gibt pro Titel nur Anzeige-Infos aus: Anzahl Streams, ⚡ ja/nein, Tonspur-Zeile, Sprachtreffer.
// Keine Links, keine Dateinamen (die Logs sind öffentlich).
async function debugStreams(ids, lang) {
  for (const id of ids) {
    const type = id.includes(":") ? "series" : "movie";
    try {
      const res = await fetch(`${AIO_BASE}stream/${type}/${encodeURIComponent(id)}.json`);
      const streams = res.ok ? (await res.json()).streams || [] : [];
      log(`DEBUG ${id}: HTTP ${res.status}, ${streams.length} Streams, ${streams.filter(isCached).length} gecacht, Ergebnis ${detectLanguage(streams, lang, { onlyCached: true })}`);
      for (const st of streams.slice(0, 12)) {
        const desc = (st.description || st.title || "").split("\n");
        const audio = desc.find((l) => l.includes("🔊")) || "(keine 🔊-Zeile)";
        const nameLine = (st.name || "").split("\n").join(" | ").slice(0, 60);
        log(`  ${isCached(st) ? "⚡" : "·"} ${streamHasLanguage(st, lang) ? "DE" : "--"} [${nameLine}] ${audio.slice(0, 80)} (Zeilen: ${desc.length})`);
      }
    } catch (e) {
      log(`DEBUG ${id}: Fehler ${e.message}`);
    }
    await sleep(1500);
  }
}

// ---------- Ablauf ----------
if (Array.isArray(settings.debugIds) && settings.debugIds.length) {
  await debugStreams(settings.debugIds.slice(0, 6), settings.languages.de);
}
const state = await loadState();
// Erstinstallation: volles Kontingent nutzen (bei vollem Vorrat 100 Abfragen)
const CHECK_ALL = process.env.CHECK_ALL === "true";
let checksLeft = CHECK_ALL ? settings.check.maxChecksFirstRun : settings.check.maxChecksPerRun;
if (CHECK_ALL) log("Modus: Erstinstallation");
let failuresInRow = 0;
const summary = [];

for (const [code, lang] of Object.entries(settings.languages)) {
  if (!lang.active) continue;
  state.results[code] ||= {};
  const results = state.results[code];

  // 1) Reihen holen
  const rowItems = [];
  for (const row of settings.rows) {
    const items = await getRowItems(row, lang, state);
    rowItems.push({ row, items });
    log(`Reihe ${row.name} (${row.type}): ${items.length} Titel`);
  }

  // 2) Prüfreihenfolge: zuerst nie geprüfte Titel, dann fällige Wiederholungen
  const seen = new Set();
  const queue = [];
  for (const { items } of rowItems) for (const it of items) {
    if (seen.has(it.key)) continue;
    seen.add(it.key);
    if (isDue(results[it.key], it)) queue.push(it);
  }
  queue.sort((a, b) => (results[a.key] ? 1 : 0) - (results[b.key] ? 1 : 0));

  // 3) Prüfen (begrenzt pro Lauf, Rest folgt in den nächsten Läufen)
  let checked = 0, found = 0;
  for (const it of queue) {
    if (checksLeft <= 0 || failuresInRow >= 5) break;
    const imdbId = await imdbIdFor(it, state);
    if (!imdbId) continue;
    try {
      const { ok, used, incomplete } = await checkTitle(it, imdbId, lang, state, checksLeft);
      if (incomplete) { checksLeft -= used; break; } // Kontingent erschöpft: nicht als „kein Deutsch“ werten
      results[it.key] = { ok, at: now };
      checked++; checksLeft -= used; failuresInRow = 0;
      if (ok) found++;
    } catch (e) {
      if (e instanceof RateLimitError) {
        log("AIOStreams-Limit erreicht, Rest beim nächsten Lauf.");
        checksLeft = 0;
        break;
      }
      failuresInRow++;
      log(`Prüfung fehlgeschlagen (${it.name}): ${e.message}`);
    }
    await sleep(settings.check.delayMs);
  }
  if (failuresInRow >= 5) log("Abbruch nach 5 Fehlern in Folge, Rest beim nächsten Lauf.");

  // Übersicht pro Reihe (öffentlich, enthält nur Titelnamen): status-<sprache>.json
  const status = { updatedAt: new Date(now).toISOString(), rows: [] };
  for (const { row, items } of rowItems) {
    const r = { id: row.id, name: row.name, type: row.type, total: items.length, ja: 0, nein: [], offen: [], ohneImdb: [] };
    for (const it of items) {
      const res = results[it.key];
      if (state.imdb[it.key] === null) r.ohneImdb.push(it.name);
      else if (!res) r.offen.push(it.name);
      else if (res.ok) r.ja++;
      else r.nein.push(it.name);
    }
    status.rows.push(r);
  }
  await writeJson(join(OUT, `status-${code}.json`), status);

  // 4) Kataloge schreiben: Originalreihenfolge, nur bestätigte Titel
  const genresByRow = {};
  const allByType = { movie: [], series: [] };
  const inAll = new Set();
  for (const { row, items } of rowItems) {
    const metas = [];
    const used = new Set();
    for (const it of items) {
      const id = state.imdb[it.key];
      if (!id || used.has(id) || !results[it.key]?.ok) continue;
      used.add(id);
      const poster = it.poster || `https://images.metahub.space/poster/medium/${id}/img`;
      const meta = { id, type: it.type, name: it.name, poster, description: it.description, ...(it.extra || {}) };
      metas.push(meta);
      if (!inAll.has(id) && allByType[it.type]) { inAll.add(id); allByType[it.type].push(meta); }
    }
    await writeJson(join(OUT, code, "catalog", row.type, `${row.id}-${code}.json`), { metas });
    // Pro Genre eine gefilterte Fassung derselben Reihe
    const groups = groupByGenre(metas);
    for (const [genre, list] of groups) {
      await writeJson(join(OUT, code, "catalog", row.type, `${row.id}-${code}`, genreFileName(genre)), { metas: list });
    }
    genresByRow[row.id] = [...groups.keys()];
  }
  // Sammelreihen: alles in einer Datei (die Apps fragen danach mit skip nach, bekommen 404 und hören auf)
  for (const row of ALL_ROWS) {
    const metas = allByType[row.type];
    await writeJson(join(OUT, code, "catalog", row.type, `${row.id}-${code}.json`), { metas });
    const groups = groupByGenre(metas);
    for (const [genre, list] of groups) {
      await writeJson(join(OUT, code, "catalog", row.type, `${row.id}-${code}`, genreFileName(genre)), { metas: list });
    }
    genresByRow[row.id] = [...groups.keys()];
  }
  await writeJson(join(OUT, code, "manifest.json"), manifestFor(code, lang, [...settings.rows, ...ALL_ROWS], genresByRow));

  const pending = queue.length - checked;
  summary.push(`${lang.label}: ${checked} geprüft, ${found} mit ${lang.label}, ${Math.max(pending, 0)} noch offen`);
}

state.updatedAt = new Date(now).toISOString();
await writeJson(join(OUT, "state.json"), state);
await writeFile(join(OUT, ".nojekyll"), "");
await writeFile(join(OUT, "index.html"), indexHtml());
log(summary.join("\n"));

function indexHtml() {
  const langs = Object.entries(settings.languages).filter(([, l]) => l.active);
  const links = langs.map(([code, l]) =>
    `<li>${l.flag} ${l.label}: <code>${PAGES_URL || "."}/${code}/manifest.json</code></li>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Sprachkatalog</title>
<body style="font-family:system-ui;max-width:640px;margin:40px auto;padding:0 16px">
<h1>Sprachkatalog</h1><p>Stremio/Nuvio-Addon-Links (in der App unter Addons einfügen):</p>
<ul>${links}</ul><p>Stand: ${new Date(now).toLocaleString("de-CH")}</p></body>`;
}
