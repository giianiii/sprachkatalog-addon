import { test } from "node:test";
import assert from "node:assert/strict";
import { groupByGenre, usableGenre, genreFileName } from "../scripts/genres.mjs";

test("Titel werden pro Genre gruppiert, Reihenfolge bleibt", () => {
  const metas = [
    { id: "tt1", genres: ["Drama", "Krimi"] },
    { id: "tt2", genres: ["Action"] },
    { id: "tt3", genres: ["Drama", "Drama"] },
    { id: "tt4" },
  ];
  const g = groupByGenre(metas);
  assert.deepEqual([...g.keys()], ["Action", "Drama", "Krimi"]);
  assert.deepEqual(g.get("Drama").map((m) => m.id), ["tt1", "tt3"]);
});

test("unsichere Genre-Namen werden nicht als Datei verwendet", () => {
  assert.equal(usableGenre("Action & Adventure"), true);
  assert.equal(usableGenre("Komödie"), true);
  assert.equal(usableGenre("../x"), false);
  assert.equal(usableGenre("a/b"), false);
  assert.equal(usableGenre(""), false);
  assert.equal(genreFileName("Krimi"), "genre=Krimi.json");
});
