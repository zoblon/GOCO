# Privacy / Datenschutz

🇬🇧 English first, 🇩🇪 [deutsche Fassung weiter unten](#datenschutz-deutsch).

GOCO runs on your Mac. There is no GOCO server, no account, no telemetry and no analytics. This document lists what data exists, where it is stored and what leaves your computer.

## Where the app listens

The bundled server listens **only on `127.0.0.1`** (port 3457 by default). It is not reachable from other computers. It has no login of its own, so any program running on your Mac under any user account can reach it while it runs.

## What is stored on your Mac

| What | Where | Notes |
| --- | --- | --- |
| Secret iCal address, MOCO subdomain, **MOCO API key**, MOCO user, optional **OpenAI API key**, theme, AI exclusion terms | Browser local storage for `http://localhost:3457` (`goco-settings`) | **Plain text**, readable by anyone with access to your browser profile. Only local; never written to a file by GOCO. |
| Project assignments, drafts, booking ledger, AI suggestion cache | Browser local storage (`goco-mappings`, `goco-drafts`, `goco-sync-ledger`, `goco-ai-cache`, `goco-operation-*`) | Calendar titles and project/task names. |
| Booking journal | `~/Library/Application Support/GOCO-Desktop/sync-journal.json` (folder mode 0700, file 0600) | MOCO account name, user id, date, activity ids and hashes of booked positions. It lets GOCO recover safely after an unclear MOCO answer. No keys, no titles. |
| Server log | `GOCO-Desktop.log` in the system temp folder | Status messages. Calendar titles are only logged if you start the server with `GOCO_DEBUG=1`. |

"Disconnect" in the app clears the saved settings in the browser. To remove everything, also clear the site data of `localhost:3457` in your browser and delete the journal folder.

## What leaves your Mac

- **Google (calendar):** the local server downloads your calendar from the secret iCal address you entered, at most every five minutes. Google sees the request like any calendar subscription.
- **MOCO (`<your subdomain>.mocoapp.com`):** the server reads your MOCO session, users, assigned projects and the activities of the selected day, and — only when you click *In MOCO eintragen* — creates activities (date, project, task, duration, description). The API key is sent in the request header to MOCO only.
- **OpenAI (`api.openai.com`), only if you enable the AI assignment:** for calendar entries that have no saved assignment, GOCO sends the entry titles, the names of your MOCO customers, projects and tasks (without the projects you excluded), up to 30 of your earlier title→project assignments and your OpenAI API key. Requests set `store: false`. The excluded terms themselves, your calendar address and your MOCO key are not sent. Without an OpenAI key nothing is sent to OpenAI.
- **Google Fonts:** the web interface loads the "DM Sans" font from `fonts.googleapis.com` / `fonts.gstatic.com`, so your browser contacts Google when the page opens (your IP address is visible to Google).

Between your browser and the local server, keys travel as request headers over the loopback interface.

GOCO does not send data anywhere else. The authors do not receive any data.

## Your responsibility

Use a browser profile only you can access, and an API key with the lowest rights that work for you. If you suspect a key leaked, revoke it in MOCO or at OpenAI.

---

## Datenschutz (Deutsch)

GOCO läuft auf deinem Mac. Es gibt keinen GOCO-Server, kein Konto, keine Telemetrie und keine Analyse. Dieses Dokument nennt, welche Daten existieren, wo sie liegen und was deinen Rechner verlässt.

### Wo die App lauscht

Der mitgelieferte Server lauscht **ausschließlich auf `127.0.0.1`** (Standard-Port 3457) und ist von anderen Rechnern nicht erreichbar. Er hat keine eigene Anmeldung; solange er läuft, kann jedes Programm auf deinem Mac ihn erreichen.

### Was auf deinem Mac gespeichert wird

| Was | Wo | Hinweis |
| --- | --- | --- |
| Geheime iCal-Adresse, MOCO-Subdomain, **MOCO-API-Key**, MOCO-Benutzer, optional **OpenAI-API-Key**, Erscheinungsbild, Ausschlussbegriffe der KI-Zuordnung | Lokaler Speicher des Browsers für `http://localhost:3457` (`goco-settings`) | **Klartext**, lesbar für jeden mit Zugriff auf dein Browserprofil. Nur lokal; GOCO schreibt sie in keine Datei. |
| Zuordnungen, Entwürfe, Buchungsnachweise, KI-Cache | Lokaler Speicher des Browsers (`goco-mappings`, `goco-drafts`, `goco-sync-ledger`, `goco-ai-cache`, `goco-operation-*`) | Kalendertitel sowie Projekt- und Teilschrittnamen. |
| Buchungsjournal | `~/Library/Application Support/GOCO-Desktop/sync-journal.json` (Ordner 0700, Datei 0600) | MOCO-Kontoname, Nutzer-ID, Datum, Aktivitäts-IDs und Hashes gebuchter Positionen. Es erlaubt die sichere Wiederaufnahme nach einer unklaren MOCO-Antwort. Keine Schlüssel, keine Titel. |
| Server-Protokoll | `GOCO-Desktop.log` im temporären Ordner des Systems | Statusmeldungen. Kalendertitel werden nur mit `GOCO_DEBUG=1` protokolliert. |

»Verbindung trennen« löscht die gespeicherten Einstellungen im Browser. Zum vollständigen Entfernen zusätzlich die Websitedaten von `localhost:3457` im Browser löschen und den Journal-Ordner entfernen.

### Was deinen Mac verlässt

- **Google (Kalender):** Der lokale Server lädt deinen Kalender von der eingegebenen geheimen iCal-Adresse, höchstens alle fünf Minuten.
- **MOCO (`<deine Subdomain>.mocoapp.com`):** Der Server liest Sitzung, Benutzer, zugewiesene Projekte und die Aktivitäten des gewählten Tages. Nur wenn du *In MOCO eintragen* klickst, legt er Aktivitäten an (Datum, Projekt, Teilschritt, Dauer, Beschreibung). Der API-Key geht im Anfrage-Header ausschließlich an MOCO.
- **OpenAI (`api.openai.com`), nur bei aktivierter KI-Zuordnung:** Für Kalendereinträge ohne gespeicherte Zuordnung sendet GOCO die **Kalendertitel**, die **Namen deiner MOCO-Kunden, Projekte und Teilschritte** (ohne die ausgeschlossenen Projekte), bis zu 30 frühere Zuordnungen (Titel → Projekt) und deinen OpenAI-API-Key. Die Anfragen setzen `store: false`. Die Ausschlussbegriffe selbst, deine Kalenderadresse und dein MOCO-Key werden nicht übertragen. Ohne OpenAI-Key geht nichts an OpenAI.
- **Google Fonts:** Die Weboberfläche lädt die Schrift »DM Sans« von `fonts.googleapis.com` / `fonts.gstatic.com`; dein Browser kontaktiert beim Öffnen der Seite also Google (die IP-Adresse ist für Google sichtbar).

Zwischen Browser und lokalem Server laufen die Schlüssel als Anfrage-Header über die Loopback-Schnittstelle.

GOCO sendet keine Daten an andere Stellen. Die Autoren erhalten keine Daten.

### Deine Verantwortung

Nutze ein Browserprofil, auf das nur du Zugriff hast, und API-Keys mit möglichst geringen Rechten. Bei Verdacht auf Verlust eines Schlüssels widerrufe ihn bei MOCO bzw. OpenAI.
