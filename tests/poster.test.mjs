import { test } from "node:test";
import assert from "node:assert/strict";
import { safePoster } from "../scripts/poster.mjs";

const SECRET = "https://aiometadata.elfhosted.com/stremio/0f8a2c4e-1111-2222-3333-444455556666/manifest.json";

test("AIOMetadata-Poster mit öffentlichem RPDB-Gratisschlüssel wird übernommen", () => {
  const p = "https://aiometadata.elfhosted.com/poster-cache/proxy/poster/movie/tt0816692?fallback=https%3A%2F%2Fimage.tmdb.org%2Ft%2Fp%2Fw500%2Fa.jpg&lang=de-DE&key=t0-free-rpdb";
  assert.equal(safePoster(p, SECRET), p);
});

test("privater Schlüssel wird nicht veröffentlicht", () => {
  assert.equal(safePoster("https://aiometadata.elfhosted.com/poster/movie/tt1?key=t1-abcdefghijkl", SECRET), undefined);
  assert.equal(safePoster("https://api.ratingposterdb.com/t2-privat123/imdb/poster-default/tt1.jpg", SECRET), undefined);
});

test("Link mit Teil der geheimen Adresse wird nicht veröffentlicht", () => {
  assert.equal(safePoster("https://aiometadata.elfhosted.com/stremio/0f8a2c4e-1111-2222-3333-444455556666/poster/tt1.jpg", SECRET), undefined);
});

test("normales TMDB-Poster ist ok, kaputte Links nicht", () => {
  assert.equal(safePoster("https://image.tmdb.org/t/p/w342/a.jpg", SECRET), "https://image.tmdb.org/t/p/w342/a.jpg");
  assert.equal(safePoster("kein-link", SECRET), undefined);
  assert.equal(safePoster("http://unsicher.example/a.jpg", SECRET), undefined);
});
