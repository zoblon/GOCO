'use strict';
// Guards for the embedded web app: template-literal escaping, version consistency, ICS parsing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const sourcePath = path.join(root, 'src', 'goco-standalone.js');
const source = fs.readFileSync(sourcePath, 'utf8');
const { APP_HTML, parseICS } = require(sourcePath);

test('APP_HTML: every backslash escape meant for the browser is doubled in the source', () => {
  const start = source.indexOf('const APP_HTML = `') + 'const APP_HTML = `'.length;
  const end = source.indexOf('</html>`;');
  const template = source.slice(start, end);
  // A single backslash before s, S, d, D, w, W, b, B, n, r or t inside the template
  // is consumed by the template literal and never reaches the browser (e.g. /\s+/ becomes /s+/).
  const offenders = [...template.matchAll(/(?<!\\)(?:\\\\)*\\([sSdDwWbBnrt])/g)].map(m => template.slice(m.index, m.index + 24));
  assert.deepEqual(offenders, []);
});

test('APP_HTML: regex escapes survive in the HTML sent to the browser', () => {
  assert.ok(/split\(\/\\s\+\//.test(APP_HTML), 'search split regex /\\s+/ must reach the browser');
  assert.ok(/\\b/.test(APP_HTML));
});

test('APP_HTML: every inline script parses', () => {
  const scripts = [...APP_HTML.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  assert.ok(scripts.length >= 1);
  for (const code of scripts) assert.doesNotThrow(() => new vm.Script(code));
});

test('APP_HTML: references the shared scripts the server serves', () => {
  assert.match(APP_HTML, /\/assets\/goco-sync-core\.js/);
  assert.match(APP_HTML, /\/assets\/goco-workflow\.js/);
});

test('APP_HTML: offers the configurable exclusion setting', () => {
  assert.match(APP_HTML, /set-ai-exclude/);
  assert.match(APP_HTML, /aiExcludeTerms/);
});

test('version in Info.plist matches APP_VERSION', () => {
  const plist = fs.readFileSync(path.join(root, 'app', 'Info.plist'), 'utf8');
  const plistVersion = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)[1];
  assert.equal(source.match(/const APP_VERSION = '([^']+)'/)[1], plistVersion);
});

test('version in package.json matches Info.plist', () => {
  const plist = fs.readFileSync(path.join(root, 'app', 'Info.plist'), 'utf8');
  const plistVersion = plist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)[1];
  assert.equal(require(path.join(root, 'package.json')).version, plistVersion);
});

test('CLAUDE.md and AGENTS.md are identical', () => {
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'));
});

test('applet and server agree on the port', () => {
  const applet = fs.readFileSync(path.join(root, 'app', 'main.applescript'), 'utf8');
  const appletPort = applet.match(/localhost:(\d+)/)[1];
  assert.equal(source.match(/process\.env\.PORT \|\| (\d+)/)[1], appletPort);
});

test('parseICS: single event with duration', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:one@example.invalid', 'SUMMARY:Konzept',
    'DTSTART:20260302T090000', 'DTEND:20260302T093000', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const events = parseICS(ics, '2026-03-02');
  assert.equal(events.length, 1);
  assert.equal(events[0].summary, 'Konzept');
  assert.equal(events[0].durationMinutes, 30);
  assert.equal(parseICS(ics, '2026-03-03').length, 0);
});

test('parseICS: weekly recurrence with EXDATE', () => {
  const ics = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:weekly@example.invalid', 'SUMMARY:Jour fixe',
    'DTSTART:20260302T100000', 'DTEND:20260302T110000', 'RRULE:FREQ=WEEKLY;COUNT=4',
    'EXDATE:20260316T100000', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  assert.equal(parseICS(ics, '2026-03-09').length, 1);
  assert.equal(parseICS(ics, '2026-03-16').length, 0);
  assert.equal(parseICS(ics, '2026-03-23').length, 1);
  assert.equal(parseICS(ics, '2026-03-30').length, 0);
});
