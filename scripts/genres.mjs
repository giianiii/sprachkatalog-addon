// Genre-Filter für die statischen Kataloge.
// Nuvio/Stremio fragen eine gefilterte Reihe als  catalog/<typ>/<id>/genre=<Genre>.json  an.
// GitHub Pages liefert nur fertige Dateien aus, darum wird pro Genre eine Datei geschrieben.

// Nur Genres, die sich gefahrlos als Dateiname verwenden lassen
export function usableGenre(g) {
  return typeof g === "string" && g.trim() !== "" && g.length <= 40 && !/[\/\\\0?#%]/.test(g) && g !== "." && g !== "..";
}

// Gruppiert die Titel einer Reihe nach Genre (Reihenfolge der Titel bleibt erhalten)
export function groupByGenre(metas) {
  const groups = new Map();
  for (const m of metas) {
    for (const g of new Set(Array.isArray(m.genres) ? m.genres : [])) {
      if (!usableGenre(g)) continue;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b, "de")));
}

// Dateiname, wie ihn GitHub Pages nach dem Dekodieren der Anfrage-URL sucht
export function genreFileName(g) {
  return `genre=${g}.json`;
}
