# Sprachkatalog-Addon

Stremio-/Nuvio-Katalog, der bekannte Reihen spiegelt (Gerade angesagt, Netflix, HBO Max,
Disney+, Apple TV+, Prime Video, Beliebt, Top bewertet), aber **nur Titel zeigt, für die eine
Fassung in der Zielsprache verfügbar ist**. Gestartet mit Deutsch, Struktur mehrsprachig.

## So funktioniert es

1. Jede Stunde läuft ein GitHub-Actions-Job. Die Reihen holt er alle 6 Stunden aus deinem
   AIOMetadata (dieselben Listen wie auf deiner Startseite); ohne AIOMetadata direkt von TMDB (Region CH).
2. Für jeden Titel fragt er die eigene AIOStreams-Konfiguration ab, ob ein gecachter
   Stream mit deutscher Tonspur existiert. Serien: zuerst Folge 1 der neuesten Staffel
   (am ehesten gecacht), sonst zusätzlich S01E01.
   Ungecachte Streams zählen nur mit mindestens 20 Seedern (`check.minSeedersUncached`); solche
   Titel werden alle 5 Tage nachgeprüft und fallen raus, sobald die Seeder fehlen.
3. Ergebnisse werden zwischengespeichert: bestätigte Titel werden alle 30 Tage erneut
   geprüft, Titel ohne deutsche Fassung täglich (ältere wöchentlich). Pro Lauf höchstens
   55 Prüfungen: Die öffentliche AIOStreams-Instanz erlaubt 100 Abfragen auf Vorrat und
   danach 1 pro Minute. Erreicht ein Lauf das Limit, bricht er ohne falsche Ergebnisse ab.
4. Die fertigen JSON-Kataloge liefert GitHub Pages statisch aus.

## Einrichtung

1. **Secrets** unter *Settings → Secrets and variables → Actions → New repository secret*:
   - `TMDB_KEY`: TMDB-API-Key (v3) oder Lese-Token (v4)
   - `AIOSTREAMS_URL`: die AIOStreams-Manifest-URL (endet auf `/manifest.json`).
     Sie enthält den Debrid-Zugang und ist geheim.
   - `AIOMETADATA_URL` (optional): die AIOMetadata-Manifest-URL. Enthält deine Einstellungen
     und ggf. deinen Trakt-Zugang, ist ebenfalls geheim. Poster (mit Bewertungen) werden nur übernommen,
     wenn der Link keinen privaten Schlüssel und keinen Teil dieser Adresse enthält.
2. **Pages** unter *Settings → Pages → Source*: **GitHub Actions**.
3. *Actions → Katalog bauen → Run workflow* einmal manuell starten, mit Haken bei
   **„Erstinstallation“** (prüft 95 Titel). Danach füllen sich die Reihen stündlich weiter;
   bei rund 900 Titeln sind nach etwa 15 Stunden alle einmal geprüft.
4. In Stremio/Nuvio als Addon einfügen: `https://<benutzer>.github.io/sprachkatalog-addon/de/manifest.json`

## Anpassen

Alles steht in `config/settings.json`: Reihen hinzufügen oder entfernen, Sprachen
aktivieren, Prüfintervalle. TMDB-Anbieter-IDs: Netflix 8, Disney+ 337, Apple TV+ 350,
Prime Video 119, HBO Max 1899.

## Auswertung

*Actions → Auswertung (nur lesend) → Run workflow*: zeigt, welche Titel Deutsch nur über
Real-Debrid haben, und prüft eine Stichprobe bekannter Titel ohne Deutsch (Cache- oder
Quellen-Lücke, oder gar keine Synchro). Ändert weder Prüfstand noch Kataloge.

## Sicherheit

- Schlüssel nur als GitHub Secrets; nie in Dateien, Logs oder Ausgaben.
- Nur offizielle `actions/*`, auf Commit-Stände gepinnt; minimale Workflow-Rechte;
  kein `pull_request_target`.
- Der Ablauf „Aktiv halten“ ändert einmal im Monat nur `.github/keepalive.txt`, damit GitHub die
  stündliche Prüfung nicht nach 60 Tagen ohne Änderung abschaltet. Nur er darf ins Repo schreiben.
- Keine Torrent-Scraper im Code: geprüft wird ausschliesslich über die eigene AIOStreams-URL.
- Notfall: TorBox-Key im TorBox-Konto neu erzeugen und AIOStreams-Konfiguration neu anlegen.
