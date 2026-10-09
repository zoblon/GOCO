# GOCO – Anleitung

GOCO überträgt ausgewählte Google-Kalendereinträge in die MOCO-Zeiterfassung. Überblick, Installation und Bauanleitung: [README](../README.de.md). Datenschutz: [PRIVACY.md](../PRIVACY.md).

## Start

Kopiere `GOCO.app` auf deinen Mac und öffne sie per Doppelklick. Die App öffnet sich im Browser. Node.js ist enthalten; eine zusätzliche Installation ist nicht erforderlich.

Beim allerersten Start warnt macOS, weil die App nicht von Apple notarisiert ist: Rechtsklick auf `GOCO.app` → **Öffnen** → **Öffnen**. Alternativ unter *Systemeinstellungen → Datenschutz & Sicherheit* auf **Trotzdem öffnen** klicken.

## Einrichtung

Hinterlege beim ersten Start den geheimen iCal-Link deines Google Kalenders, deine MOCO-Subdomain und deinen MOCO-API-Key. Wähle anschließend deinen Benutzer. Optional kannst du einen OpenAI-API-Key für die automatische Projektzuordnung hinterlegen.

- iCal-Link: Google Kalender → Einstellungen → dein Kalender → *Geheime Adresse im iCal-Format*.
- MOCO-API-Key: MOCO → Profil → Integrationen.

## Zeiterfassung

Prüfe die Kalendereinträge und ihre Projektzuordnungen. Mit »In MOCO eintragen« überträgst du die ausgewählten Einträge. Vorhandene MOCO-Buchungen werden beim Laden und beim Tageswechsel eingelesen und vor einer Buchung erneut geprüft. »Kalender aktualisieren« lädt Änderungen aus deinem Kalender. Neu angelegte Projekte kannst du bei Bedarf in den Einstellungen über »Projekte aktualisieren« sofort laden.

## KI-Zuordnung und Ausschluss von Projekten

Ist die KI-Zuordnung aktiv (Einstellungen → KI-Zuordnung → OpenAI), schlägt GOCO für Einträge ohne gespeicherte Zuordnung ein Projekt vor. Unter **Von der KI-Zuordnung ausschließen** kannst du Begriffe eintragen, getrennt durch Kommas. Projekte, deren Name einen dieser Begriffe enthält (Groß-/Kleinschreibung egal), werden der KI nicht angeboten und nie automatisch zugeordnet. Das Feld ist standardmäßig leer. Manuell kannst du diese Projekte weiterhin wählen.

## Daten und Beenden

Einstellungen und Zuordnungen werden lokal im verwendeten Browser gespeichert. Verwende GOCO deshalb möglichst immer im selben Browser.

Der lokale Server läuft nach dem Start im Hintergrund, bis du dich abmeldest oder den Mac neu startest. Um ihn früher zu beenden, gib im Terminal ein:

```bash
launchctl remove io.github.zoblon.goco.server
```
