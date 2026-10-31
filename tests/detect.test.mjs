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
