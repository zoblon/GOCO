<p align="center"><img src="assets/app-icon_gold.png" width="128" alt="GOCO App-Icon"></p>

# GOCO

[![CI](https://github.com/zoblon/GOCO/actions/workflows/ci.yml/badge.svg)](https://github.com/zoblon/GOCO/actions/workflows/ci.yml)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue.svg)](LICENSE)

🇬🇧 [English version](README.md)

GOCO ist eine kleine macOS-App, die ausgewählte Google-Kalendereinträge in die [MOCO](https://www.mocoapp.com)-Zeiterfassung überträgt. Alles läuft auf deinem Mac: ein lokaler Node.js-Server mit Weboberfläche, die sich im Browser öffnet.

> **Unabhängiges Projekt.** GOCO steht in keiner Verbindung zu MOCO, Google oder OpenAI und wird von diesen weder unterstützt noch empfohlen. Alle genannten Produktnamen sind Marken ihrer jeweiligen Inhaber.

## Was GOCO tut

- Liest deinen Kalender über die geheime iCal-Adresse (keine Google-Anmeldung, kein OAuth).
- Zeigt die Einträge eines Tages, fasst gleiche Titel zusammen und lässt dich jeden Eintrag einem MOCO-Projekt und Teilschritt zuordnen.
- Gleicht den Tag mit den bereits vorhandenen MOCO-Buchungen ab und bucht nur, was fehlt. Laufende Timer, geänderte Buchungen oder unklare Treffer werden gemeldet statt blind gebucht.
- Schlägt auf Wunsch mit OpenAI Projektzuordnungen vor. Projekte, deren Name bestimmte Begriffe enthält, kannst du von der KI-Zuordnung ausschließen.
- Merkt sich deine manuellen Zuordnungen und verwendet sie wieder.

![Tagesansicht mit einem Kalendereintrag und Projektzuordnung](docs/images/dashboard.jpg)
![Einstellungen mit dem Feld zum Ausschluss von der KI-Zuordnung](docs/images/settings.jpg)

*Die Screenshots zeigen synthetische Beispieldaten.*

## Voraussetzungen

- Ein Mac mit macOS 13.5 oder neuer (Apple Silicon; zu jedem Release gibt es zusätzlich eine Intel-Version).
- Ein Google-Kalender mit **geheimer Adresse im iCal-Format** (Google Kalender → Einstellungen → dein Kalender → *Geheime Adresse im iCal-Format*).
- Ein MOCO-Konto mit persönlichem **API-Key** (MOCO → Profil → Integrationen).
- Optional: ein OpenAI-API-Key für die KI-Zuordnung.

Node.js ist in der App enthalten; weitere Installationen sind nicht nötig.

## Installation

1. `GOCO-<Version>.zip` (Apple Silicon) oder `GOCO-<Version>-x64.zip` (Intel) aus dem [neuesten Release](https://github.com/zoblon/GOCO/releases/latest) laden.
2. Optional: Prüfsumme mit der beiliegenden `.sha256`-Datei vergleichen: `shasum -a 256 -c GOCO-<Version>.zip.sha256`.
3. Entpacken und `GOCO.app` ins Programme-Verzeichnis (oder an einen anderen Ort) verschieben.

### Erster Start

GOCO ist ad hoc signiert und **nicht von Apple notarisiert**. Gatekeeper warnt deshalb beim ersten Start:

- Rechtsklick (oder Control-Klick) auf `GOCO.app` → **Öffnen** → mit **Öffnen** bestätigen, oder
- die App einmal normal öffnen, dann in den *Systemeinstellungen → Datenschutz & Sicherheit* auf **Trotzdem öffnen** klicken.

Danach startet GOCO einen lokalen Server und öffnet `http://localhost:3457` im Standardbrowser. Die Einrichtung fragt Kalenderadresse, MOCO-Subdomain und API-Key, den MOCO-Benutzer und optional den OpenAI-Key ab.

## Bedienung

`GOCO.app` öffnen, wenn du Zeit buchen willst. Einträge des Tages und ihre Projektzuordnungen prüfen, dann **In MOCO eintragen** klicken. *Kalender aktualisieren* lädt den Kalender neu, *Projekte aktualisieren* (Einstellungen) die MOCO-Projekte. Der Server läuft im Hintergrund bis zur Abmeldung oder zum Neustart; ein erneutes Öffnen der App öffnet nur den Browser. Zum früheren Beenden:

```bash
launchctl remove io.github.zoblon.goco.server
```

Einstellungen und Zuordnungen liegen im lokalen Speicher des Browsers; verwende deshalb immer denselben Browser. Ausführliche Anleitung: [docs/GOCO-Anleitung.md](docs/GOCO-Anleitung.md).

## Grenzen

- Nur macOS; ein Benutzer pro Browserprofil.
- Nicht notarisiert (siehe oben). Die Oberfläche wird unverschlüsselt über HTTP auf der Loopback-Schnittstelle ausgeliefert.
- Zeitzonen: Die `TZID` von Kalendereinträgen wird ignoriert; Zeiten gelten in der Zeitzone deines Macs.
- Wiederkehrende Termine mit Kombination aus `BYDAY` und `INTERVAL` können in Randfällen ungenau sein.
- Die KI-Zuordnung ist ein Vorschlag; prüfe das Ergebnis vor dem Buchen.
- Schlüssel liegen unverschlüsselt im lokalen Speicher des Browsers. Siehe [PRIVACY.md](PRIVACY.md).

## Aus dem Quellcode bauen

Voraussetzung: macOS mit Kommandozeilenwerkzeugen (`osacompile` und `codesign` gehören zu macOS) und Internetzugang.

```bash
git clone https://github.com/zoblon/GOCO.git
cd GOCO
scripts/build-app.sh              # Apple Silicon -> dist/GOCO-<Version>.zip
scripts/build-app.sh --arch x64   # Intel         -> dist/GOCO-<Version>-x64.zip
```

Das Skript kompiliert das Applet, kopiert die Scripts, lädt die aktuelle offizielle Node.js-LTS von nodejs.org (überschreibbar mit `NODE_VERSION=24.21.0`), prüft sie gegen `SHASUMS256.txt`, legt die Lizenzen bei, signiert das Bundle ad hoc, führt `codesign --verify` aus und packt das Ergebnis als ZIP. Die gebaute App liegt in `build/GOCO.app`.

Tests (Node.js 20 oder neuer, keine Abhängigkeiten):

```bash
npm run check   # node --check für alle Scripts
npm test        # node --test
```

Server ohne App-Bau starten (Port 3457, anderer Port über `PORT`):

```bash
GOCO_FOREGROUND=1 node src/goco-standalone.js
```

### Icon und Social-Preview

Das App-Icon wird aus `assets/app-icon_gold.png` (1024 × 1024) erzeugt. Zum Neuerzeugen von `app/applet.icns` (macOS):

```bash
mkdir GOCO.iconset
for s in 16 32 128 256 512; do
  sips -z $s $s assets/app-icon_gold.png --out GOCO.iconset/icon_${s}x${s}.png
  sips -z $((s*2)) $((s*2)) assets/app-icon_gold.png --out GOCO.iconset/icon_${s}x${s}@2x.png
done
iconutil -c icns GOCO.iconset -o app/applet.icns && rm -r GOCO.iconset
```

Favicon und Header-Icons der Oberfläche sind als Base64-PNG in `src/goco-standalone.js` eingebettet und müssen separat ersetzt werden. `assets/social-preview.png` (1280 × 640) erzeugt `scripts/make-social-preview.py` (benötigt Pillow); GitHub nimmt es nur als manuellen Upload unter *Settings → Social preview* an.

## Aufbau

```
src/      Server und Web-App (goco-standalone.js), Abgleichslogik (goco-sync-core.js),
          MOCO-Adapter und Buchungsjournal (goco-sync-server.js), Browser-Workflow (goco-workflow.js)
app/      AppleScript-Starter, Info.plist, App-Icon (.icns)
assets/   Icon-Vorlagen, Social-Preview
scripts/  build-app.sh, make-social-preview.py
test/     node:test-Tests
docs/     Anleitung (Deutsch), Release-Notes
```

## Lizenz

[MIT](LICENSE) © 2026 Tobi Rehkopf. Die App enthält eine unveränderte offizielle Node.js-Binärdatei; deren Lizenz liegt im Bundle (`Contents/Resources/licenses`).
