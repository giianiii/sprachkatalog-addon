import { test } from "node:test";
import assert from "node:assert/strict";
import { detectLanguage, streamHasLanguage } from "../scripts/detect.mjs";

const de = { flag: "🇩🇪", filenamePattern: "(^|[^a-z])(german|ger|deutsch)([^a-z]|$)" };

test("russisches Release mit falscher DE-Flagge zählt nicht", () => {
  const s = {
    name: "1080P ⚡",
    description: "✎  Eternity (2025) \n🔊 ⛿ 🇩🇪 · 🇬🇧 · ᴅᴜʙ · sᴜʙ  \n◈ 9.59 GB",
    behaviorHints: { filename: "Вечность / Eternity [2025 WEB-DL 1080p] Dub (Мосфильм-Мастер) + Original (Eng) + Sub (Rus Eng Deu)" },
  };
  assert.equal(streamHasLanguage(s, de), false);
});

test("nur deutsche Untertitel zählen nicht", () => {
  const s = {
    name: "4K ⚡",
    description: "✎ Eternity\n🔊 🇬🇧 · sᴜʙ (🇬🇧 · 🇬🇧ᶜᶜ · 🇩🇪)",
    behaviorHints: { filename: "Eternity.2025.2160p.ATVP.WEB-DL.DV.HDR.H.265-FLUX.mkv" },
  };
  assert.equal(streamHasLanguage(s, de), false);
});

test("deutsche Tonspur in der Anzeige zählt", () => {
  const s = {
    name: "1080P ⚡",
    description: "✎ Oppenheimer\n🔊 🇩🇪 · 🇬🇧 · ᴅʟ",
    behaviorHints: { filename: "Oppenheimer.2023.German.DL.1080p.BluRay.x264-GROUP.mkv" },
  };
  assert.equal(streamHasLanguage(s, de), true);
});

test("Rückfall über Dateinamen", () => {
  const s = { name: "1080P ⚡", description: "", behaviorHints: { filename: "Film.2025.German.DL.1080p.WEB.h264-WvF.mkv" } };
  assert.equal(streamHasLanguage(s, de), true);
});

test("German Subs im Dateinamen ist kein Ton", () => {
  const s = { name: "1080P ⚡", description: "", behaviorHints: { filename: "Film.2025.1080p.German.Subs.WEB.mkv" } };
  assert.equal(streamHasLanguage(s, de), false);
});

test("ungecacht zählt nur, wenn onlyCached aus ist", () => {
  const s = { name: "1080P ⏳", description: "🔊 🇩🇪", behaviorHints: { filename: "Film.German.DL.mkv" } };
  assert.equal(detectLanguage([s], de, { onlyCached: true }), false);
  assert.equal(detectLanguage([s], de, { onlyCached: false }), true);
});

import { isRateLimited } from "../scripts/detect.mjs";

test("Limit-Hinweis von ElfHosted wird erkannt", () => {
  assert.equal(isRateLimited([{ name: "🐢 AIOStreams", description: "public rate-limit exceeded" }]), true);
  assert.equal(isRateLimited([{ name: "1080P ⚡", description: "🔊 🇩🇪" }]), false);
});

test("⛿ (nur aus Dateinamen geraten): Sammel-Liste zählt nicht, „German DL“ schon", () => {
  const de = { flag: "🇩🇪", filenamePattern: "(^|[^a-z])(german|ger|deutsch)([^a-z]|$)" };
  const qxr = { name: "4K ⚡", description: "🔊 ⛿ 🇩🇪 · 🇬🇧", behaviorHints: { filename: "Barbarian (2022) (2160p UHD BluRay x265 10bit DV HDR DTS-HD MA 5.1 English + French + German + Italian r00t) [QxR]" } };
  const dl = { name: "1080p ⚡", description: "🔊 ⛿ 🇩🇪 · 🇬🇧", behaviorHints: { filename: "Film.2022.German.DL.1080p.BluRay.x264-GRP.mkv" } };
  const checked = { name: "1080p ⚡", description: "🔊 ✓ 🇬🇧 · 🇩🇪", behaviorHints: { filename: "Film.2022.MULTi.1080p.mkv" } };
  assert.equal(streamHasLanguage(qxr, de), false);
  assert.equal(streamHasLanguage(dl, de), true);
  assert.equal(streamHasLanguage(checked, de), true);
  const only = { name: "1080p ⚡", description: "🔊 ⛿ 🇩🇪", behaviorHints: { filename: "Film.2022.German.1080p.BluRay.x264-DETAiLS.mkv" } };
  const subs = { name: "1080p ⚡", description: "🔊 ⛿ 🇩🇪 · 🇬🇧", behaviorHints: { filename: "Film.2022.1080p.WEB.German.Subs.mkv" } };
  const commas = { name: "1080p ⚡", description: "🔊 ⛿ 🇩🇪 · 🇬🇧", behaviorHints: { filename: "Film (2022) 1080p [Eng, Ger, Fra, Spa] x265" } };
  assert.equal(streamHasLanguage(only, de), true);
  assert.equal(streamHasLanguage(subs, de), false);
  assert.equal(streamHasLanguage(commas, de), false);
});

test("Fehler einer Quelle oder Statistik ist kein Instanz-Limit", () => {
  assert.equal(isRateLimited([{ name: "[❌] Comet", description: "429: rate limit exceeded" }, { name: "1080P ⚡", description: "🔊 🇬🇧" }]), false);
  assert.equal(isRateLimited([{ name: "🔍 Removal Reasons", description: "Rate limited addons: 0" }]), false);
});

import { seeders, isUsable, languageInfo } from "../scripts/detect.mjs";

const unc = (seeds, file = "Twilight 2008 German DVDRip [720p] DiAMOND") => ({
  name: "720P ⏳ 〈Dvdrip〉",
  description: `✎ Twilight (2008) ⏐ 🔊 ✓ 🇩🇪 ⏐ ◈ 792 MB · 866 ᴷᵇᵖˢ⇄ ${seeds}❦ · 297d ⏐ ⛉ [TB] ComeTorz`,
  behaviorHints: { filename: file },
});

test("Seeder-Zahl wird aus der Anzeige gelesen", () => {
  assert.equal(seeders(unc(1239)), 1239);
  assert.equal(seeders(unc("1.2k")), 1200);
  assert.equal(seeders({ name: "1080P ⚡", description: "🔊 🇩🇪" }), 0);
});

test("Ungecacht zählt nur mit genug Seedern", () => {
  const opts = { onlyCached: true, minSeeders: 20 };
  assert.equal(isUsable(unc(1239), opts), true);
  assert.equal(isUsable(unc(3), opts), false);
  assert.equal(isUsable(unc(1239), { onlyCached: true, minSeeders: 0 }), false);
  const info = languageInfo([unc(1239)], de, opts);
  assert.equal(info.ok, true);
  assert.equal(info.uncachedOnly, true);
  assert.equal(info.seeds, 1239);
  assert.equal(languageInfo([unc(3)], de, opts).ok, false);
});
