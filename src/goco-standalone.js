#!/usr/bin/env node

/**
 * GOCO – standalone server
 *
 * Transfers Google Calendar entries to MOCO time tracking.
 *
 * Run:  node goco-standalone.js
 * Open: http://localhost:3457
 *
 * No npm install needed – plain Node.js, no dependencies.
 *
 * Theme system: light/dark via CSS `light-dark()` + `color-scheme`. "System"
 * follows the OS; the manual override lives in `goco-settings.theme`
 * ('system' | 'light' | 'dark') and is applied by `applyTheme()` as a
 * `data-theme` attribute on <html>. The sync bar and the status pills
 * (AI / grouped / in MOCO) have dedicated variables because their background
 * colors deliberately do not follow the system scheme (the sync bar stays dark,
 * pills are inverted in dark mode).
 *
 * Template-literal trap: everything between `const APP_HTML = \`` and the closing
 * backtick is a JS template literal, so every backslash escape that must reach
 * the browser has to be doubled (`\\s`, `\\b`, `\\d`, `\\n`, ...).
 */

const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { URL } = require('url');
const syncCore = require('./goco-sync-core.js');
const {createSyncService,createMocoAdapter} = require('./goco-sync-server.js');
const syncService = createSyncService({journalDir:process.env.GOCO_JOURNAL_DIR || path.join(os.homedir(),'Library/Application Support/GOCO-Desktop')});
const projectCache = new Map();
const testFixtures = process.env.GOCO_TEST_FIXTURES === '1';
const testCounters = {calendar:0,mocoReads:0,projects:0,commits:0,ai:0};

const LAUNCHD_LABEL = 'io.github.zoblon.goco.server';
const LAUNCHD_CHILD_ARG = '--goco-launchd-child';

function handoffToLaunchd() {
  if (process.env.GOCO_FOREGROUND === '1' || process.argv.includes(LAUNCHD_CHILD_ARG)) return false;

  const serviceTarget = `gui/${process.getuid()}/${LAUNCHD_LABEL}`;
  const existingJob = spawnSync('/bin/launchctl', ['print', serviceTarget], { stdio: 'ignore' });
  if (existingJob.status === 0) {
    return true;
  }

  const logPath = path.join(os.tmpdir(), 'GOCO-Desktop.log');
  const result = spawnSync('/bin/launchctl', [
    'submit', '-l', LAUNCHD_LABEL,
    '-o', logPath,
    '-e', logPath,
    '--', process.execPath, __filename, LAUNCHD_CHILD_ARG,
  ], { stdio: 'ignore' });

  if (result.status !== 0) {
    console.error('[Launcher] Übergabe an launchd fehlgeschlagen; starte im aktuellen Prozess.');
    return false;
  }

  return true;
}

if (require.main === module && handoffToLaunchd()) process.exit(0);

const APP_VERSION = '1.9.0';
const PORT = process.env.PORT || 3457;
const UPSTREAM_TIMEOUT_MS = Math.max(100, Number(process.env.GOCO_UPSTREAM_TIMEOUT_MS) || 20000);
const DEBUG = process.env.GOCO_DEBUG === '1';
const debugLog = (...args) => { if (DEBUG) console.log(...args); };

// ─── ICS Cache (avoid re-fetching on every date navigation) ───
let icsCache = { url: null, text: null, time: 0 };
const parsedCalendarCache = new Map();
const ICS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ─── Embedded HTML/CSS/JS App ───

const APP_HTML = `<!DOCTYPE html>
<html lang="de">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>GOCO</title>
<link rel="icon" type="image/png" href="data:image/png;base64,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">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet">
<style>
/* ─── Reset & Base ─── */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  color-scheme: light dark;
  --navy:     light-dark(#0d1d2b, #e8e2d4);
  --navy-50:  light-dark(#f0f4f8, #1a2632);
  --navy-100: light-dark(#d9e2ec, #243340);
  --navy-200: light-dark(#bcccdc, #3a4856);
  --navy-300: light-dark(#9fb3c8, #5a6878);
  --navy-400: light-dark(#829ab1, #7a8898);
  --navy-600: light-dark(#486581, #9ba8b8);
  --navy-700: light-dark(#334e68, #c5cdd6);
  --navy-800: light-dark(#243b53, #dde3ea);
  --cream:     light-dark(#f5f2ec, #0f1822);
  --cream-50:  light-dark(#fdfcfa, #10192a);
  --cream-100: light-dark(#faf8f4, #141f2a);
  --cream-300: light-dark(#ebe6db, #243340);
  --cream-400: light-dark(#ddd5c5, #3a4856);
  --gold:       light-dark(#c49a52, #c9a364);
  --gold-light: light-dark(#f7f0e0, rgba(196,154,82,0.12));
  --gold-dark:  light-dark(#9a7b3a, #d4b478);
  --gold-muted: light-dark(#d4b87c, #b89a64);
  --gold-btn:   light-dark(#d4b478, #d4b478);
  --gold-pill-bg:   light-dark(#f7f0e0, #bea065);
  --gold-pill-text: light-dark(#9a7b3a, #2a1f10);
  --neutral-pill-bg:   light-dark(#f0f4f8, #aebac6);
  --neutral-pill-text: light-dark(#486581, #1a2a3a);
  --ink:       light-dark(#1a1a1a, #e8e2d4);
  --ink-sec:   light-dark(#4a4a4a, #b8b0a0);
  --ink-muted: light-dark(#7a7a7a, #88817a);
  --ink-faint: light-dark(#a0a0a0, #5a564f);
  --border:  light-dark(#ddd5c5, #3a4856);
  --surface: light-dark(#ece8e0, #1a2632);
  --shadow-card:     light-dark(0 1px 3px rgba(13,29,43,0.04), 0 1px 3px rgba(0,0,0,0.35));
  --shadow-hover:    light-dark(0 8px 24px rgba(13,29,43,0.08), 0 8px 24px rgba(0,0,0,0.45));
  --shadow-elevated: light-dark(0 12px 36px rgba(13,29,43,0.12), 0 12px 36px rgba(0,0,0,0.55));
  --shadow-dropdown: light-dark(0 16px 48px rgba(13,29,43,0.14), 0 16px 48px rgba(0,0,0,0.6));
  /* Surfaces & overlays */
  --card-bg:           light-dark(#ffffff, #1c2a3a);
  --card-border:       light-dark(rgba(221,213,197,0.6), rgba(255,255,255,0.08));
  --strip-bg:          light-dark(rgba(245,242,236,0.5), rgba(255,255,255,0.03));
  --hover-tint:        light-dark(rgba(176,168,152,0.12), rgba(255,255,255,0.06));
  --btn-secondary-bg:  light-dark(rgba(235,230,219,0.5), rgba(255,255,255,0.04));
  --btn-ghost-hover:   light-dark(rgba(235,230,219,0.6), rgba(255,255,255,0.06));
  --btn-primary-shadow: light-dark(rgba(13,29,43,0.2), rgba(0,0,0,0.5));
  --checkbox-synced:   light-dark(rgba(13,29,43,0.3), rgba(232,226,212,0.25));
  --unassigned-bg:       light-dark(rgba(245,240,232,0.8), rgba(196,154,82,0.08));
  --unassigned-bg-hover: light-dark(rgba(240,235,225,0.9), rgba(196,154,82,0.14));
  --trigger-ring:      light-dark(rgba(13,29,43,0.1), rgba(232,226,212,0.18));
  --header-bg:         light-dark(rgba(245,242,236,0.8), rgba(15,24,34,0.85));
  --header-border:     light-dark(rgba(221,213,197,0.5), rgba(255,255,255,0.06));
  --input-suffix-bg:   light-dark(rgba(235,230,219,0.6), rgba(255,255,255,0.04));
  --modal-overlay-bg:  light-dark(rgba(13,29,43,0.3), rgba(0,0,0,0.55));
  --picker-sel-bg:     light-dark(rgba(13,29,43,0.05), rgba(232,226,212,0.08));
  --spinner-bg:        light-dark(rgba(13,29,43,0.05), rgba(232,226,212,0.08));
  --wordmark-faint:    light-dark(rgba(13,29,43,0.4), rgba(232,226,212,0.5));
  /* Sync bar (solid, no gradient) */
  --sync-bar-bg:     light-dark(#334e68, #3d5066);
  --sync-bar-border: light-dark(rgba(0,0,0,0.35), rgba(255,255,255,0.18));
  /* Status colors */
  --error:           light-dark(#dc2626, #f87171);
  --disconnect:      light-dark(#ef5350, #f87171);
  --disconnect-hover: light-dark(#e53935, #ef5350);
  --scrollbar-thumb: light-dark(#c8c0b4, #3a4856);
  /* Status callouts (Error / Warning / Success / MOCO-Synced) */
  --err-bg:        light-dark(#fef2f2, rgba(248,113,113,0.08));
  --err-border:    light-dark(#fecaca, rgba(248,113,113,0.28));
  --err-text:      light-dark(#b91c1c, #fca5a5);
  --warn-bg:       light-dark(#fffbeb, rgba(251,191,36,0.08));
  --warn-border:   light-dark(#fde68a, rgba(251,191,36,0.28));
  --warn-text:     light-dark(#92400e, #fbbf24);
  --ok-bg:         light-dark(#eef9f2, rgba(74,222,128,0.06));
  --ok-border:     light-dark(#a7f3d0, rgba(74,222,128,0.28));
  --ok-text:       light-dark(#15613e, #4ade80);
  --moco-bg:       light-dark(rgba(240,249,244,0.5), rgba(74,222,128,0.05));
  --moco-border:   light-dark(rgba(22,163,74,0.12), rgba(74,222,128,0.18));
  --moco-icon-bg:  light-dark(rgba(22,163,74,0.1), rgba(74,222,128,0.18));
  --moco-divider:  light-dark(rgba(22,163,74,0.2), rgba(74,222,128,0.28));
  --moco-text:     light-dark(#16a34a, #4ade80);
}
:root[data-theme="light"] { color-scheme: light; }
:root[data-theme="dark"]  { color-scheme: dark; }

body {
  font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
  background: var(--cream);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  min-height: 100vh;
  font-feature-settings: 'ss01', 'ss02';
}
::selection { background-color: rgba(196,154,82,0.25); color: var(--navy); }
::-webkit-scrollbar { width: 5px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 3px; }

.font-display { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; font-weight: 600; }
.font-body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, system-ui, sans-serif; }

/* ─── Animations ─── */
@keyframes fadeUp { 0% { opacity: 0; transform: translateY(16px); } 100% { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { 0% { opacity: 0; } 100% { opacity: 1; } }
@keyframes slideDown { 0% { opacity: 0; transform: translateY(-8px) scale(0.96); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes pulseSoft { 0%, 100% { opacity: 1; } 50% { opacity: 0.7; } }
@keyframes spin { to { transform: rotate(360deg); } }
.anim-fade-up { animation: fadeUp 0.5s ease-out both; }
.anim-fade-in { animation: fadeIn 0.3s ease-out forwards; }
.anim-slide-down { animation: slideDown 0.2s ease-out forwards; }
.anim-pulse { animation: pulseSoft 2s ease-in-out infinite; }
.anim-spin { animation: spin 1s linear infinite; }
.delay-1 { animation-delay: 0.05s; } .delay-2 { animation-delay: 0.1s; }
.delay-3 { animation-delay: 0.15s; } .delay-4 { animation-delay: 0.2s; }
.delay-5 { animation-delay: 0.25s; } .delay-6 { animation-delay: 0.3s; }

/* ─── Components ─── */
.card {
  background: var(--card-bg); border-radius: 1.25rem; box-shadow: var(--shadow-card);
  border: 1px solid var(--card-border); padding: 1.5rem;
  transition: all 0.3s ease-out, max-height 0.15s ease;
  position: relative; overflow: hidden; max-height: 600px;
}
.onboarding-card, .settings-card { max-height: none; overflow: visible; }
.card:hover { box-shadow: var(--shadow-hover); transform: translateY(-1px); }
.card.is-hidden { max-height: 3rem; padding: 0; border-style: dashed; border-color: var(--border); background: var(--strip-bg); box-shadow: none; transform: none !important; }
.card-body { position: relative; transition: opacity 0.2s ease; }
.card.is-hidden .card-body { opacity: 0; pointer-events: none; }
.card-hidden-strip { position: absolute; inset: 0; display: flex; align-items: center; padding: 0 1.25rem; gap: 0.75rem; opacity: 0; pointer-events: none; transition: opacity 0.1s ease 0.05s; }
.card.is-hidden .card-hidden-strip { opacity: 1; pointer-events: auto; }
.card-hidden-title { font-family: 'Instrument Serif', Georgia, 'Times New Roman', serif; font-style: italic; font-size: 0.9375rem; color: var(--ink-faint); flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hide-btn { background: none; border: none; cursor: pointer; padding: 0.3125rem; color: var(--ink-faint); border-radius: 0.5rem; display: flex; align-items: center; justify-content: center; opacity: 0; transition: opacity 0.15s, color 0.15s, background 0.15s; }
.card:not(.is-hidden):hover .hide-btn, .card:not(.is-hidden):focus-within .hide-btn { opacity: 1; }
.hide-btn:hover { color: var(--ink-muted); background: var(--hover-tint); }
.card-restore-btn { background: none; border: none; cursor: pointer; padding: 0.3125rem; color: var(--ink-faint); border-radius: 0.375rem; display: flex; align-items: center; justify-content: center; transition: color 0.15s, background 0.15s; flex-shrink: 0; }
.card-restore-btn:hover { color: var(--ink-muted); background: var(--hover-tint); }

.stat-card {
  position: relative; overflow: hidden; background: var(--card-bg); border-radius: 1.25rem;
  border: 1px solid var(--card-border); padding: 1.25rem;
  transition: all 0.3s ease-out;
}
.stat-card::after {
  content: ''; position: absolute; bottom: 0; left: 0; right: 0; height: 2px;
  background: var(--gold);
}

.btn-primary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.75rem 1.5rem; border-radius: 0.75rem;
  background: var(--navy); color: var(--cream-50);
  font-family: 'DM Sans', sans-serif; font-weight: 600; font-size: 0.875rem;
  letter-spacing: 0.025em; border: none; cursor: pointer;
  transition: all 0.2s ease-out;
}
.btn-primary:hover { background: var(--navy-800); box-shadow: 0 4px 12px var(--btn-primary-shadow); }
.btn-primary:active { transform: scale(0.97); }
.btn-primary:disabled { opacity: 0.4; cursor: not-allowed; }

.btn-secondary {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.625rem 1.25rem; border-radius: 0.75rem;
  background: var(--btn-secondary-bg); color: var(--navy-700);
  font-family: 'DM Sans', sans-serif; font-weight: 500; font-size: 0.875rem;
  border: 1px solid var(--border); cursor: pointer;
  transition: all 0.2s ease-out;
}
.btn-secondary:hover { background: var(--cream-300); }
.btn-secondary:active { transform: scale(0.97); }

.btn-ghost {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 0.5rem 0.75rem; border-radius: 0.75rem;
  color: var(--ink-muted); font-family: 'DM Sans', sans-serif; font-weight: 500; font-size: 0.875rem;
  background: transparent; border: none; cursor: pointer;
  transition: all 0.2s ease-out;
}
.btn-ghost:hover { background: var(--btn-ghost-hover); color: var(--navy); }

.input-field {
  width: 100%; padding: 0.75rem 1rem; border-radius: 0.75rem;
  background: var(--cream-50); border: 1px solid var(--border);
  color: var(--ink); font-family: 'DM Sans', sans-serif; font-size: 0.875rem;
  transition: all 0.2s ease-out; outline: none;
}
.input-field::placeholder { color: var(--ink-faint); }
.input-field:focus { border-color: var(--gold); box-shadow: 0 0 0 2px rgba(196,154,82,0.3); background: var(--card-bg); }

.badge {
  display: inline-flex; align-items: center; padding: 0.125rem 0.625rem;
  border-radius: 0.5rem; font-size: 0.75rem; font-weight: 500;
}
.badge-synced { background: var(--neutral-pill-bg); color: var(--neutral-pill-text); }
.badge-grouped { background: var(--neutral-pill-bg); color: var(--neutral-pill-text); }
.badge-pending { background: var(--gold-pill-bg); color: var(--gold-pill-text); }

.sync-bar {
  background: var(--sync-bar-bg);
  color: #f5f2ec; border-radius: 1.25rem;
  border: 1px solid var(--sync-bar-border);
  box-shadow: var(--shadow-elevated);
}

.checkbox {
  flex-shrink: 0; width: 1.25rem; height: 1.25rem; border-radius: 0.375rem;
  border: 2px solid var(--border); display: flex; align-items: center; justify-content: center;
  cursor: pointer; transition: all 0.2s; background: transparent;
}
.checkbox.checked { background: var(--navy); border-color: var(--navy); }
.checkbox.synced { background: var(--checkbox-synced); border-color: var(--checkbox-synced); }
.checkbox:hover:not(.synced) { border-color: var(--navy-300); }

:where(button, [role="button"], [role="checkbox"], input):focus-visible {
  outline: 2px solid var(--gold); outline-offset: 3px;
}
.calendar-refresh-btn { gap: 0.5rem; white-space: nowrap; }
.editable-title { background: none; border: none; padding: 0; text-align: left; font: inherit; }

.project-trigger {
  width: 100%; display: flex; align-items: center; gap: 0.5rem;
  padding: 0.625rem 0.75rem; border-radius: 0.75rem; text-align: left; font-size: 0.875rem;
  border: 2px solid transparent; cursor: pointer; transition: all 0.2s;
  font-family: 'DM Sans', sans-serif; background: var(--cream-100); color: var(--ink);
}
.project-trigger:hover { background: var(--cream-300); }
.project-trigger.unassigned { background: var(--unassigned-bg); border-color: rgba(196,154,82,0.3); }
.project-trigger.unassigned:hover { border-color: rgba(196,154,82,0.5); background: var(--unassigned-bg-hover); }
.project-trigger.open { background: var(--card-bg); border-color: var(--navy); box-shadow: 0 0 0 2px var(--trigger-ring); }
.pt-row { display: flex; flex-direction: column; justify-content: center; gap: 0.125rem; flex: 1; min-width: 0; white-space: nowrap; }
.pt-main { display: flex; align-items: baseline; min-width: 0; }
.pt-customer {
  max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-size: 0.6875rem; font-weight: 600; color: var(--ink-muted); text-transform: uppercase; letter-spacing: 0.08em;
}
.pt-project {
  flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-size: 0.875rem; font-weight: 500; color: var(--ink);
}
.pt-task {
  flex: 1 2 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis;
  font-size: 0.875rem; font-weight: 400; color: var(--ink-sec);
}
.pt-sep-arrow { flex-shrink: 0; margin: 0 0.25rem; color: var(--ink-faint); font-weight: 400; }
.picker-identifier {
  display: inline-flex; align-items: center; padding: 0 0.375rem; border-radius: 0.25rem;
  background: var(--cream-100); color: var(--ink-faint);
  font-family: ui-monospace, "SF Mono", monospace; font-weight: 500; text-transform: none; letter-spacing: 0;
}
.picker-project-title {
  max-width: 46ch; text-wrap: balance; overflow-wrap: anywhere;
  font-size: 1.0625rem; font-weight: 600; line-height: 1.28; letter-spacing: 0; color: var(--ink);
}
.picker-task:hover:not(.sel) { background: var(--hover-tint) !important; }

.dropdown { position: absolute; z-index: 50; margin-top: 0.5rem; width: 100%; min-width: 360px;
  background: var(--card-bg); border-radius: 1.25rem; box-shadow: var(--shadow-dropdown);
  border: 1px solid var(--border); overflow: hidden; }

/* ─── Layout Helpers ─── */
.container { padding: 0 3rem; }
.flex { display: flex; } .flex-col { flex-direction: column; }
.items-center { align-items: center; } .items-start { align-items: start; } .items-end { align-items: flex-end; } .items-baseline { align-items: baseline; }
.justify-center { justify-content: center; } .justify-between { justify-content: space-between; }
.gap-1 { gap: 0.25rem; } .gap-2 { gap: 0.5rem; } .gap-3 { gap: 0.75rem; } .gap-4 { gap: 1rem; }
.flex-1 { flex: 1; } .flex-shrink-0 { flex-shrink: 0; }
.w-full { width: 100%; } .min-w-0 { min-width: 0; }
.text-center { text-align: center; } .text-right { text-align: right; }
.truncate { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.relative { position: relative; } .absolute { position: absolute; }
.sticky { position: sticky; } .hidden { display: none; }
.grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.75rem; }
.space-y-2 > * + * { margin-top: 0.5rem; } .space-y-3 > * + * { margin-top: 0.75rem; }
.space-y-5 > * + * { margin-top: 1.25rem; }
.mb-1 { margin-bottom: 0.25rem; } .mb-2 { margin-bottom: 0.5rem; }
.mb-3 { margin-bottom: 0.75rem; } .mb-4 { margin-bottom: 1rem; }
.mb-6 { margin-bottom: 1.5rem; } .mb-8 { margin-bottom: 2rem; }
.mb-10 { margin-bottom: 2.5rem; } .mb-12 { margin-bottom: 3rem; }
.mt-1 { margin-top: 0.25rem; } .mt-2 { margin-top: 0.5rem; }
.ml-2 { margin-left: 0.5rem; } .mr-2 { margin-right: 0.5rem; }
.p-4 { padding: 1rem; } .p-5 { padding: 1.25rem; } .p-8 { padding: 2rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.py-3 { padding-top: 0.75rem; padding-bottom: 0.75rem; }
.py-10 { padding-top: 2.5rem; padding-bottom: 2.5rem; }
.py-20 { padding-top: 5rem; padding-bottom: 5rem; }
.py-24 { padding-top: 6rem; padding-bottom: 6rem; }

@media (min-width: 640px) { .sm-block { display: block; } }
@media (max-width: 639px) {
  .container { padding-left: 1rem; padding-right: 1rem; }
  .settings-page { padding: 1.25rem 1rem 3rem !important; }
  .settings-card { padding: 1.25rem !important; }
  .settings-grid { grid-template-columns: minmax(0, 1fr) !important; gap: 1.75rem !important; }
  .settings-card [style*="min-width:18rem"] { min-width: 0 !important; }
  .refresh-label { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .calendar-refresh-btn { width: 2.5rem; height: 2.5rem; padding: 0; }
  .stat-card { padding: 1rem 0.375rem; }
  .stat-card > div:last-child { font-size: 8px !important; letter-spacing: 0.08em !important; }
  .sync-bar { flex-wrap: wrap; gap: 0.875rem; padding: 1rem !important; }
  .sync-bar > button { width: 100%; }
  .card .items-start.gap-4 { gap: 0.75rem; }
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { scroll-behavior: auto !important; animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition-duration: 0.01ms !important; }
}
</style>
</head>
<body>
<div id="app"></div>
<script src="/assets/goco-sync-core.js"></script>
<script>
// ─── State ───
const state = {
  page: 'loading', // loading, onboarding, dashboard, settings
  step: 'calendar', // calendar, moco, user, ai
  settings: null,
  icalUrl: '',
  mocoSubdomain: '',
  mocoApiKey: '',
  users: [],
  selectedUser: null,
  loading: false,
  error: '',
  // AI provider config (during onboarding/settings editing)
  aiProvider: '', // '', 'openai'
  aiApiKey: '',
  aiExcludeTerms: '', // comma-separated name fragments of projects that AI must never assign
  // Dashboard
  currentDate: new Date(),
  entries: [],
  projects: [],
  dataLoading: true,
  syncing: false,
  syncResult: null,
  showDisconnect: false,
  mocoActivities: [],
  mocoError: null,
  hiddenKeys: new Map(), // dateStr → Set of hidden keys
  aiWarning: '', // one-time warning after an AI error
  calendarRefreshing: false,
  calendarRefreshResult: '',
  calendarRefreshResetTimer: null,
};

// ─── Storage ───
function getSettings() {
  try {
    const settings = JSON.parse(localStorage.getItem('goco-settings') || '{}');
    if (settings.aiProvider !== 'openai' && (settings.aiProvider || settings.aiApiKey)) {
      settings.aiProvider = null;
      settings.aiApiKey = '';
      localStorage.setItem('goco-settings', JSON.stringify(settings));
    }
    return settings;
  } catch { return {}; }
}
function saveSettings(s) { localStorage.setItem('goco-settings', JSON.stringify(s)); return s; }
function clearSettings() { localStorage.removeItem('goco-settings'); }

// ─── Theme ───
function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
  else root.removeAttribute('data-theme');
}
function setTheme(theme) {
  const s = getSettings();
  s.theme = theme;
  saveSettings(s);
  if (state.settings) state.settings.theme = theme;
  applyTheme(theme);
}
function getMappings() {
  try { return JSON.parse(localStorage.getItem('goco-mappings') || '[]'); } catch { return []; }
}
function saveMappings(m) { localStorage.setItem('goco-mappings', JSON.stringify(m)); }
function addMapping(m) {
  const mappings = getMappings().filter(x => x.keyword.toLowerCase() !== m.keyword.toLowerCase());
  mappings.unshift(m); saveMappings(mappings);
}
function findMapping(summary) {
  const mappings = getMappings(); const s = summary.toLowerCase().trim();
  // Exact match only (case-insensitive) — no partial matching to avoid false positives
  return mappings.find(m => m.keyword.toLowerCase().trim() === s) || null;
}
function getSyncLedger() {
  try { return JSON.parse(localStorage.getItem('goco-sync-ledger') || '{}'); } catch { return {}; }
}
function rememberSyncedActivity(dateStr, entryKey, activityId) {
  if (!dateStr || !entryKey || activityId === null || activityId === undefined) return;
  const ledger = getSyncLedger();
  if (!ledger[dateStr]) ledger[dateStr] = {};
  ledger[dateStr][entryKey] = activityId;
  localStorage.setItem('goco-sync-ledger', JSON.stringify(ledger));
}
function hasSyncedActivity(dateStr, entryKey, activities) {
  const ledger = getSyncLedger();
  const activityId = ledger[dateStr] && ledger[dateStr][entryKey];
  if (activityId === null || activityId === undefined) return false;
  return (activities || []).some(a => String(a.id) === String(activityId));
}
function autoMatchProject(summary) {
  if (!state.projects || !state.projects.length) return null;
  const q = summary.toLowerCase().trim();
  let bestMatch = null, bestScore = 0;
  for (const proj of state.projects) {
    const pname = proj.name.toLowerCase();
    for (const task of proj.tasks.filter(t => t.active)) {
      const tname = task.name.toLowerCase();
      let score = 0;
      // Project name matching (min 4 chars to avoid false positives)
      if (pname.length >= 4) {
        if (q === pname) score = Math.max(score, 100);
        else if (q.includes(pname)) score = Math.max(score, 80);
        else if (pname.includes(q) && q.length >= 4) score = Math.max(score, 60);
      }
      // Task name matching (min 4 chars)
      if (tname.length >= 4) {
        if (q === tname) score = Math.max(score, 90);
        else if (q.includes(tname)) score = Math.max(score, 70);
        else if (tname.includes(q) && q.length >= 4) score = Math.max(score, 50);
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = { projectId: proj.id, taskId: task.id, projectName: proj.name, taskName: task.name, customerName: proj.customer.name };
      }
    }
  }
  return bestScore >= 60 ? bestMatch : null;
}

// ─── Helpers ───
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}
function formatTime(iso) { return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }); }
function formatHours(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (h === 0) return m + ' min'; if (m === 0) return h + ' h'; return h + ' h ' + m + ' min';
}
function isToday(d) { return d.toDateString() === new Date().toDateString(); }
function normalizeActivityText(value) {
  return String(value || '').toLowerCase().trim().split(/\\s+/).join(' ');
}
function activityMatchesEntry(activity, summary) {
  const description = normalizeActivityText(activity && activity.description);
  const entrySummary = normalizeActivityText(summary);
  if (!description || !entrySummary) return false;
  if (description === entrySummary) return true;
  const shorter = description.length < entrySummary.length ? description : entrySummary;
  return shorter.length >= 12 && shorter.includes(' ') && (description.includes(entrySummary) || entrySummary.includes(description));
}
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function renderProjectPath(customerName, projectName, taskName) {
  return '<span class="pt-row"><span class="pt-customer">'+esc(customerName || '')+'</span><span class="pt-main"><span class="pt-project">'+esc(projectName || '')+'</span><span class="pt-sep-arrow">&rarr;</span><span class="pt-task">'+esc(taskName || '')+'</span></span></span>';
}
// Returns the Set of hidden keys for the current date
function getHiddenKeys() {
  const dateStr = formatDate(state.currentDate);
  if (!state.hiddenKeys.has(dateStr)) state.hiddenKeys.set(dateStr, new Set());
  return state.hiddenKeys.get(dateStr);
}

// ─── Password field with eye-toggle ───
const eyeIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const eyeOffIconSvg = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
window.togglePasswordVisibility = function(inputId) {
  var input = document.getElementById(inputId);
  var btn = document.getElementById(inputId + '-toggle');
  if (!input || !btn) return;
  var show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.innerHTML = show ? eyeOffIconSvg : eyeIconSvg;
  btn.setAttribute('aria-label', show ? 'API-Key verbergen' : 'API-Key anzeigen');
};
function passwordField(id, value, placeholder, extraStyle) {
  return '<div style="position:relative">' +
    '<input id="' + id + '" type="password" class="input-field" style="font-family:monospace;letter-spacing:0.05em;padding-right:2.75rem;' + (extraStyle || '') + '" placeholder="' + esc(placeholder || '') + '" value="' + esc(value || '') + '">' +
    '<button type="button" id="' + id + '-toggle" onclick="togglePasswordVisibility(&apos;' + id + '&apos;)" aria-label="API-Key anzeigen" title="API-Key anzeigen" style="position:absolute;right:0.5rem;top:50%;transform:translateY(-50%);background:transparent;border:none;cursor:pointer;color:var(--ink-muted);padding:0.5rem;display:flex;align-items:center;border-radius:0.375rem;transition:color 0.15s" onmouseover="this.style.color=&apos;var(--navy)&apos;" onmouseout="this.style.color=&apos;var(--ink-muted)&apos;">' +
    eyeIconSvg + '</button></div>';
}

// ─── API Proxy (via our Node server) ───
async function apiGet(path) { const r = await fetch('/api' + path); return r.json(); }
async function apiPost(path, body) {
  const r = await fetch('/api' + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { ok: r.ok, data: await r.json() };
}

// ─── Render ───
function render() {
  const app = document.getElementById('app');
  if (state.page === 'loading') {
    app.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center"><div class="flex flex-col items-center gap-4 anim-fade-in"><img src="data:image/png;base64,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" style="width:2.5rem;height:2.5rem;border-radius:0.75rem"><span style="font-family:&apos;DM Sans&apos;,sans-serif;font-size:0.875rem;font-weight:700;color:var(--wordmark-faint);letter-spacing:0.2em;text-transform:uppercase">GOCO</span></div></div>';
    return;
  }
  if (state.page === 'onboarding') { renderOnboarding(app); return; }
  if (state.page === 'dashboard') { renderDashboard(app); return; }
  if (state.page === 'settings') { renderSettings(app); return; }
}

// ─── Onboarding ───
function renderOnboarding(app) {
  const stepNum = state.step === 'calendar' ? 1 : state.step === 'moco' ? 2 : state.step === 'user' ? 3 : 4;
  const labels = ['Kalender', 'MOCO', 'Benutzer', 'KI'];

  let stepContent = '';
  if (state.step === 'calendar') {
    stepContent = '<div class="anim-fade-in"><p style="font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);margin-bottom:0.375rem">Schritt 01</p><h2 style="font-size:1.375rem;font-weight:600;color:var(--navy);letter-spacing:-0.02em;margin-bottom:0.75rem">Google Kalender</h2><p style="color:var(--ink-muted);font-size:0.875rem;margin-bottom:2rem;line-height:1.7">Gib den geheimen iCal-Link deines Google Kalenders ein. Du findest ihn unter Google Kalender &rarr; Einstellungen &rarr; Kalender &rarr; Geheime Adresse im iCal-Format.</p><div class="space-y-5"><div><label style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;color:var(--ink-sec);margin-bottom:0.5rem">iCal-URL</label><input id="ical-input" class="input-field" placeholder="https://calendar.google.com/calendar/ical/..." value="'+esc(state.icalUrl)+'"></div>'+(state.error?'<p style="color:var(--error);font-size:0.875rem">'+esc(state.error)+'</p>':'')+'<button class="btn-primary w-full" onclick="handleCalendarNext()">Weiter</button></div></div>';
  } else if (state.step === 'moco') {
    stepContent = '<div class="anim-fade-in"><p style="font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);margin-bottom:0.375rem">Schritt 02</p><h2 style="font-size:1.375rem;font-weight:600;color:var(--navy);letter-spacing:-0.02em;margin-bottom:0.75rem">MOCO Verbindung</h2><p style="color:var(--ink-muted);font-size:0.875rem;margin-bottom:2rem;line-height:1.7">Gib deine MOCO-Subdomain und deinen API-Key ein. Den API-Key findest du unter Profil &rarr; Integrationen.</p><div class="space-y-5"><div><label style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;color:var(--ink-sec);margin-bottom:0.5rem">MOCO Subdomain</label><div class="flex" style="gap:0"><input id="subdomain-input" class="input-field" style="border-radius:0.75rem 0 0 0.75rem;border-right:0" placeholder="firmenname" value="'+esc(state.mocoSubdomain)+'"><span style="padding:0.75rem 1rem;background:var(--input-suffix-bg);border:1px solid var(--border);border-radius:0 0.75rem 0.75rem 0;font-size:0.875rem;color:var(--ink-muted);white-space:nowrap">.mocoapp.com</span></div></div><div><label style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;color:var(--ink-sec);margin-bottom:0.5rem">API-Key</label>'+passwordField('apikey-input', state.mocoApiKey, 'Dein persönlicher API-Key')+'</div>'+(state.error?'<p style="color:var(--error);font-size:0.875rem">'+esc(state.error)+'</p>':'')+'<div class="flex gap-3" style="padding-top:0.25rem"><button class="btn-secondary flex-1" onclick="goStep(&apos;calendar&apos;)">Zurück</button><button class="btn-primary flex-1" onclick="handleMocoNext()" '+(state.loading?'disabled':'')+'>'+( state.loading?'<span class="flex items-center gap-2"><svg class="anim-spin" style="width:1rem;height:1rem" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Verbinde...</span>':'Verbinden')+'</button></div></div></div>';
  } else if (state.step === 'user') {
    let userCards = state.users.map((u, i) => {
      const sel = state.selectedUser && state.selectedUser.id === u.id;
      return '<button onclick="selectUser('+i+')" style="width:100%;display:flex;align-items:center;gap:0.75rem;padding:0.875rem 1rem;border-radius:0.75rem;text-align:left;transition:all 0.2s;border:'+(sel?'none':'1px solid var(--border)')+';background:'+(sel?'var(--navy)':'var(--cream-50)')+';color:'+(sel?'var(--cream-50)':'var(--ink)')+';cursor:pointer;'+(sel?'box-shadow:var(--shadow-hover)':'')+'" class="user-card-btn anim-fade-up delay-'+(i+1)+'"><div class="user-avatar" style="width:2.5rem;height:2.5rem;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:0.875rem;font-weight:600;flex-shrink:0;background:'+(sel?'var(--gold)':'var(--cream-300)')+';color:'+(sel?'var(--navy)':'var(--navy-700)')+'">'+esc(u.firstname[0]+u.lastname[0])+'</div><div style="flex:1;min-width:0"><div style="font-weight:500;font-size:0.875rem">'+esc(u.firstname+' '+u.lastname)+'</div><div class="user-email" style="font-size:0.75rem;color:'+(sel?'var(--cream-300)':'var(--ink-muted)')+'">'+esc(u.email)+'</div></div><svg class="user-check" style="display:'+(sel?'flex':'none')+';width:1.25rem;height:1.25rem;color:var(--gold);flex-shrink:0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></button>';
    }).join('');
    stepContent = '<div class="anim-fade-in"><p style="font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);margin-bottom:0.375rem">Schritt 03</p><h2 style="font-size:1.375rem;font-weight:600;color:var(--navy);letter-spacing:-0.02em;margin-bottom:0.75rem">Benutzer wählen</h2><p style="color:var(--ink-muted);font-size:0.875rem;margin-bottom:2rem;line-height:1.7">Für welchen MOCO-Benutzer soll die Zeiterfassung synchronisiert werden?</p><div class="space-y-2" style="max-height:16rem;overflow-y:auto;margin-bottom:1.5rem">'+userCards+'</div>'+(state.error?'<p style="color:var(--error);font-size:0.875rem;margin-bottom:1rem">'+esc(state.error)+'</p>':'')+'<div class="flex gap-3"><button class="btn-secondary flex-1" onclick="goStep(&apos;moco&apos;)">Zurück</button><button class="btn-primary flex-1" onclick="handleUserNext()">Weiter</button></div></div>';
  } else if (state.step === 'ai') {
    const isOpenAi = state.aiProvider === 'openai';
    const isOff = !state.aiProvider;
    const cardStyle = function(active) { return 'flex:1;padding:1rem;border-radius:0.75rem;cursor:pointer;transition:all 0.2s;text-align:left;border:'+(active?'2px solid var(--gold)':'1px solid var(--border)')+';background:'+(active?'var(--gold-light)':'var(--cream-50)')+';color:var(--ink)'; };
    stepContent = '<div class="anim-fade-in"><p style="font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);margin-bottom:0.375rem">Schritt 04 · Optional</p><h2 style="font-size:1.375rem;font-weight:600;color:var(--navy);letter-spacing:-0.02em;margin-bottom:0.75rem">KI-Zuordnung</h2><p style="color:var(--ink-muted);font-size:0.875rem;margin-bottom:1.5rem;line-height:1.7">Mit einer optionalen KI-Verbindung werden Kalendereinträge intelligent auf MOCO-Projekte zugeordnet. Du lernst weiter durch manuelles Korrigieren. Es entstehen geringe nutzungsabhängige API-Kosten.</p><div class="space-y-3" style="margin-bottom:1.5rem"><button type="button" onclick="setAiProvider(&apos;openai&apos;)" style="'+cardStyle(isOpenAi)+';display:block;width:100%"><div style="font-weight:600;font-size:0.875rem;margin-bottom:0.25rem">OpenAI (GPT-6 Luna)</div><div style="font-size:0.75rem;color:var(--ink-muted)">Empfohlen · effizient bei strukturierter Zuordnung</div></button><button type="button" onclick="setAiProvider(&apos;&apos;)" style="'+cardStyle(isOff)+';display:block;width:100%"><div style="font-weight:600;font-size:0.875rem;margin-bottom:0.25rem">Keine KI verwenden</div><div style="font-size:0.75rem;color:var(--ink-muted)">Score-basiertes Matching wie bisher</div></button></div>'+(state.aiProvider?'<div class="anim-slide-down" style="margin-bottom:1rem;padding:1rem;background:var(--gold-light);border-radius:0.75rem;border:1px solid rgba(196,154,82,0.3)"><label style="display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;color:var(--gold-dark);margin-bottom:0.5rem">OpenAI API-Key</label>'+passwordField('ai-apikey-input', state.aiApiKey, 'sk-...')+'</div>':'')+(state.error?'<p style="color:var(--error);font-size:0.875rem;margin-bottom:1rem">'+esc(state.error)+'</p>':'')+'<div class="flex gap-3"><button class="btn-secondary flex-1" onclick="goStep(&apos;user&apos;)">Zurück</button><button class="btn-primary flex-1" onclick="handleComplete()">Fertig</button></div></div>';
  }

  let progress = [1,2,3,4].map(n => '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:0.5rem"><div style="width:100%;height:3px;border-radius:99px;transition:all 0.5s;background:'+(n<=stepNum?'var(--navy)':'var(--border)')+'"></div><span style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;font-weight:500;transition:color 0.3s;color:'+(n<=stepNum?'var(--navy)':'var(--ink-faint)')+'">'+labels[n-1]+'</span></div>').join('');

  app.innerHTML = '<div style="min-height:100vh;display:flex;align-items:flex-start;justify-content:center;padding:3rem 1.5rem"><div style="width:100%;max-width:32rem" class="anim-fade-up"><div class="text-center mb-12"><img src="data:image/png;base64,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" style="width:3rem;height:3rem;border-radius:0.75rem;margin-bottom:1.5rem"><h1 style="font-size:2.5rem;font-weight:600;color:var(--navy);margin-bottom:0.625rem;letter-spacing:-0.03em;line-height:1.1">Einrichtung</h1><p style="color:var(--ink-muted);font-size:0.875rem;letter-spacing:0.01em">Verbinde deinen Google Kalender mit MOCO</p></div><div class="flex gap-1 mb-8 px-2" style="gap:0.25rem">'+progress+'</div><div class="card p-8 onboarding-card">'+stepContent+'</div><p class="text-center" style="font-size:0.75rem;color:var(--ink-faint);margin-top:2rem;letter-spacing:0.025em">Alle Daten werden lokal in deinem Browser gespeichert.</p></div></div>';

  // Bind input values
  const icalInput = document.getElementById('ical-input');
  if (icalInput) icalInput.addEventListener('input', e => { state.icalUrl = e.target.value; });
  const subInput = document.getElementById('subdomain-input');
  if (subInput) subInput.addEventListener('input', e => { state.mocoSubdomain = e.target.value; });
  const apiInput = document.getElementById('apikey-input');
  if (apiInput) apiInput.addEventListener('input', e => { state.mocoApiKey = e.target.value; });
  if (icalInput) icalInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleCalendarNext(); });
  if (apiInput) apiInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleMocoNext(); });
  const aiKeyInput = document.getElementById('ai-apikey-input');
  if (aiKeyInput) aiKeyInput.addEventListener('input', e => { state.aiApiKey = e.target.value; });
  if (aiKeyInput) aiKeyInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleComplete(); });
}

// Onboarding handlers
window.handleCalendarNext = function() {
  if (!state.icalUrl.trim()) { state.error = 'Bitte gib den iCal-Link ein.'; render(); return; }
  state.error = ''; state.step = 'moco'; render();
};
window.goStep = function(s) { state.step = s; state.error = ''; render(); };
window.handleMocoNext = async function() {
  if (!state.mocoSubdomain.trim() || !state.mocoApiKey.trim()) { state.error = 'Bitte fülle beide Felder aus.'; render(); return; }
  state.loading = true; state.error = ''; render();
  try {
    const sess = await apiGet('/moco/session?subdomain='+encodeURIComponent(state.mocoSubdomain)+'&apiKey='+encodeURIComponent(state.mocoApiKey));
    if (!sess.valid) { state.error = sess.error || 'Verbindung fehlgeschlagen.'; state.loading = false; render(); return; }
    const users = await apiGet('/moco/users?subdomain='+encodeURIComponent(state.mocoSubdomain)+'&apiKey='+encodeURIComponent(state.mocoApiKey));
    if (Array.isArray(users)) { state.users = users; state.step = 'user'; }
    else { state.error = 'Fehler beim Laden der Benutzer.'; }
  } catch { state.error = 'Netzwerkfehler.'; }
  state.loading = false; render();
};
window.selectUser = function(i) {
  state.selectedUser = state.users[i];
  state.error = '';
  var btns = document.querySelectorAll('.user-card-btn');
  if (!btns.length) { render(); return; }
  btns.forEach(function(btn, idx) {
    var sel = idx === i;
    btn.style.border = sel ? 'none' : '1px solid var(--border)';
    btn.style.background = sel ? 'var(--navy)' : 'var(--cream-50)';
    btn.style.color = sel ? 'var(--cream-50)' : 'var(--ink)';
    btn.style.boxShadow = sel ? 'var(--shadow-hover)' : '';
    var av = btn.querySelector('.user-avatar');
    if (av) { av.style.background = sel ? 'var(--gold)' : 'var(--cream-300)'; av.style.color = sel ? 'var(--navy)' : 'var(--navy-700)'; }
    var em = btn.querySelector('.user-email');
    if (em) em.style.color = sel ? 'var(--cream-300)' : 'var(--ink-muted)';
    var ck = btn.querySelector('.user-check');
    if (ck) ck.style.display = sel ? 'flex' : 'none';
  });
};
window.handleUserNext = function() {
  if (!state.selectedUser) { state.error = 'Bitte wähle einen Benutzer.'; render(); return; }
  state.error = '';
  if (state.settings) {
    state.aiProvider = state.settings.aiProvider || '';
    state.aiApiKey = state.settings.aiApiKey || '';
  }
  state.step = 'ai'; render();
};
window.setAiProvider = function(p) {
  state.aiProvider = p;
  if (!p) state.aiApiKey = '';
  state.error = '';
  render();
};
window.pickTheme = function(theme) {
  setTheme(theme);
  if (state.page === 'settings') render();
};
window.handleComplete = function() {
  if (!state.selectedUser) { state.error = 'Bitte wähle einen Benutzer.'; state.step = 'user'; render(); return; }
  if (state.aiProvider && !state.aiApiKey.trim()) { state.error = 'Bitte gib einen API-Key ein oder wähle "Keine KI verwenden".'; render(); return; }
  const u = state.selectedUser;
  state.settings = saveSettings({
    icalUrl: state.icalUrl.trim(), mocoSubdomain: state.mocoSubdomain.trim(),
    mocoApiKey: state.mocoApiKey.trim(), mocoUserId: u.id,
    mocoUserName: u.firstname + ' ' + u.lastname, onboardingComplete: true,
    aiProvider: state.aiProvider || null,
    aiApiKey: state.aiProvider ? state.aiApiKey.trim() : '',
  });
  state.page = 'dashboard'; state.dataLoading = true; render(); fetchDashboardData();
};

// ─── Settings ───
window.openSettings = function() {
  const s = state.settings || {};
  state.icalUrl = s.icalUrl || '';
  state.mocoSubdomain = s.mocoSubdomain || '';
  state.mocoApiKey = s.mocoApiKey || '';
  state.aiProvider = s.aiProvider || '';
  state.aiApiKey = s.aiApiKey || '';
  state.aiExcludeTerms = s.aiExcludeTerms || '';
  state.error = '';
  state.page = 'settings';
  render();
};
window.closeSettings = function() {
  state.error = '';
  state.page = 'dashboard';
  render();
};
window.handleSettingsSave = function() {
  if (!state.icalUrl.trim() || !state.mocoSubdomain.trim() || !state.mocoApiKey.trim()) {
    state.error = 'iCal-URL, MOCO-Subdomain und API-Key sind erforderlich.'; render(); return;
  }
  if (state.aiProvider && !state.aiApiKey.trim()) {
    state.error = 'Bitte gib einen API-Key ein oder wähle "Keine KI verwenden".'; render(); return;
  }
  const prev = state.settings || {};
  state.settings = saveSettings({
    ...prev,
    icalUrl: state.icalUrl.trim(),
    mocoSubdomain: state.mocoSubdomain.trim(),
    mocoApiKey: state.mocoApiKey.trim(),
    aiProvider: state.aiProvider || null,
    aiApiKey: state.aiProvider ? state.aiApiKey.trim() : '',
    aiExcludeTerms: state.aiExcludeTerms.trim(),
  });
  state.error = '';
  state.page = 'dashboard';
  state.projects = [];
  state.dataLoading = true;
  render();
  fetchDashboardData();
};

function renderSettings(app) {
  const isOpenAi = state.aiProvider === 'openai';
  const isOff = !state.aiProvider;
  const cardStyle = function(active) { return 'padding:1rem;border-radius:0.75rem;cursor:pointer;transition:all 0.2s;text-align:left;border:'+(active?'2px solid var(--gold)':'1px solid var(--border)')+';background:'+(active?'var(--gold-light)':'var(--cream-50)')+';color:var(--ink);display:block;width:100%'; };
  const labelCss = 'display:block;font-size:0.75rem;text-transform:uppercase;letter-spacing:0.12em;font-weight:600;color:var(--ink-sec);margin-bottom:0.5rem';
  const sectionTitle = 'font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--gold);margin-bottom:0.75rem';

  const calSection = '<div style="margin-bottom:1.5rem"><p style="'+sectionTitle+'">Google Kalender</p><label style="'+labelCss+'">iCal-URL</label><input id="set-ical" class="input-field" placeholder="https://calendar.google.com/calendar/ical/..." value="'+esc(state.icalUrl)+'"></div>';
  const mocoSection = '<div><p style="'+sectionTitle+'">MOCO Verbindung</p><label style="'+labelCss+'">Subdomain</label><div class="flex" style="gap:0;margin-bottom:1rem"><input id="set-sub" class="input-field" style="border-radius:0.75rem 0 0 0.75rem;border-right:0" placeholder="firmenname" value="'+esc(state.mocoSubdomain)+'"><span style="padding:0.75rem 1rem;background:var(--input-suffix-bg);border:1px solid var(--border);border-radius:0 0.75rem 0.75rem 0;font-size:0.875rem;color:var(--ink-muted);white-space:nowrap">.mocoapp.com</span></div><label style="'+labelCss+'">MOCO API-Key</label>'+passwordField('set-key', state.mocoApiKey, 'Dein persönlicher MOCO API-Key')+'</div>';

  const providerHeader = function(title, detail) {
    return '<div style="display:flex;align-items:center;justify-content:space-between;gap:1rem"><div style="font-weight:600;font-size:0.875rem;white-space:nowrap">'+title+'</div><div style="font-size:0.75rem;color:var(--ink-muted);text-align:right;white-space:nowrap">'+detail+'</div></div>';
  };
  const openAiKey = isOpenAi ? '<div style="margin-top:0.75rem"><label style="'+labelCss+';color:var(--gold-dark);margin-bottom:0.375rem">OpenAI API-Key</label>'+passwordField('set-ai-key', state.aiApiKey, 'sk-...')+'</div>' : '';
  const openAiCardStyle = cardStyle(isOpenAi).replace('cursor:pointer', 'cursor:default');
  const providerCards = '<div class="space-y-3"><div style="'+openAiCardStyle+'"><button type="button" onclick="setAiProvider(&apos;openai&apos;)" style="display:block;width:100%;padding:0;background:none;border:none;color:inherit;font-family:inherit;cursor:pointer;text-align:left">'+providerHeader('OpenAI (GPT-6 Luna)', 'empfohlen')+'</button>'+openAiKey+'</div><button type="button" onclick="setAiProvider(&apos;&apos;)" style="'+cardStyle(isOff)+'">'+providerHeader('Keine KI verwenden', 'klassisches Matching')+'</button></div>';
  const excludeField = isOpenAi ? '<div style="margin-top:1.25rem"><label for="set-ai-exclude" style="'+labelCss+'">Von der KI-Zuordnung ausschließen</label><p style="color:var(--ink-muted);font-size:0.8125rem;margin-bottom:0.5rem;line-height:1.6">Projekte, deren Name enthält:</p><input id="set-ai-exclude" class="input-field" placeholder="z. B. Intern, Wartung" value="'+esc(state.aiExcludeTerms)+'"><p style="color:var(--ink-muted);font-size:0.75rem;margin-top:0.375rem;line-height:1.5">Mehrere Begriffe mit Komma trennen, Groß-/Kleinschreibung spielt keine Rolle. Diese Projekte werden der KI nicht angeboten. Leer lassen, um nichts auszuschließen.</p></div>' : '';
  const aiSection = '<div><p style="'+sectionTitle+'">KI-Zuordnung (optional)</p><p style="color:var(--ink-muted);font-size:0.8125rem;margin-bottom:1rem;line-height:1.6">Eine optionale KI verbessert die automatische Projekt-Zuordnung.<br>Es entstehen geringe nutzungsabhängige API-Kosten.</p>'+providerCards+excludeField+'</div>';

  const errBlock = state.error ? '<p style="color:var(--error);font-size:0.875rem;margin-top:1rem">'+esc(state.error)+'</p>' : '';

  const currentTheme = (state.settings && state.settings.theme) || getSettings().theme || 'system';
  const themeBtn = function(value, label) {
    const active = currentTheme === value;
    return '<button type="button" onclick="pickTheme(&apos;'+value+'&apos;)" style="flex:1;padding:0.625rem 1rem;border-radius:0.5rem;font-family:DM Sans,sans-serif;font-size:0.8125rem;font-weight:'+(active?'600':'500')+';cursor:pointer;transition:all 0.2s;border:'+(active?'2px solid var(--gold)':'1px solid var(--border)')+';background:'+(active?'var(--gold-light)':'var(--cream-50)')+';color:'+(active?'var(--gold-dark)':'var(--ink-sec)')+'">'+label+'</button>';
  };
  const appearanceSection = '<div style="margin-top:2rem;padding-top:1.5rem;border-top:1px solid var(--border)"><div style="display:flex;align-items:flex-end;justify-content:space-between;gap:1.5rem;flex-wrap:wrap"><div style="flex:1;min-width:14rem"><p style="'+sectionTitle+';margin-bottom:0.375rem">Erscheinungsbild</p><p style="color:var(--ink-muted);font-size:0.8125rem;line-height:1.6">Folgt automatisch dem System (Hell/Dunkel) oder fest auswählen.</p></div><div class="flex gap-2" style="flex:1;min-width:18rem">'+themeBtn('system','System')+themeBtn('light','Hell')+themeBtn('dark','Dunkel')+'</div></div></div>';

  app.innerHTML = '<div style="min-height:100vh;padding:2rem 3rem 4rem"><div style="width:100%;max-width:86rem;margin:0 auto" class="anim-fade-up"><div class="flex items-center justify-between mb-6"><div><h1 style="font-size:2rem;font-weight:600;color:var(--navy);letter-spacing:-0.03em;line-height:1.1">Einstellungen</h1><p style="color:var(--ink-muted);font-size:0.875rem;margin-top:0.25rem">Verbindungen und KI-Zuordnung</p></div><button class="btn-ghost" onclick="closeSettings()" title="Schließen"><svg style="width:1.25rem;height:1.25rem" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12"/></svg></button></div><div class="card" style="padding:2rem 2rem 2.25rem"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(26rem,1fr));gap:2.25rem;align-items:start"><div>'+calSection+mocoSection+'</div>'+aiSection+'</div>'+appearanceSection+errBlock+'<div class="flex gap-3" style="padding-top:1.25rem"><button class="btn-secondary flex-1" onclick="closeSettings()">Abbrechen</button><button class="btn-primary flex-1" onclick="handleSettingsSave()">Speichern</button></div></div></div></div>';
  app.innerHTML = app.innerHTML
    .replace('<div style="min-height:100vh;padding:2rem 3rem 4rem">', '<div class="settings-page" style="min-height:100vh;padding:2rem 3rem 4rem">')
    .replace('<div class="card" style="padding:2rem 2rem 2.25rem">', '<div class="card settings-card" style="padding:2rem 2rem 2.25rem">')
    .replace('<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(26rem,1fr));gap:2.25rem;align-items:start">', '<div class="settings-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(26rem,1fr));gap:2.25rem;align-items:start">');

  const ical = document.getElementById('set-ical');
  if (ical) ical.addEventListener('input', e => { state.icalUrl = e.target.value; });
  const sub = document.getElementById('set-sub');
  if (sub) sub.addEventListener('input', e => { state.mocoSubdomain = e.target.value; });
  const key = document.getElementById('set-key');
  if (key) key.addEventListener('input', e => { state.mocoApiKey = e.target.value; });
  const aiKey = document.getElementById('set-ai-key');
  if (aiKey) aiKey.addEventListener('input', e => { state.aiApiKey = e.target.value; });
  const aiExclude = document.getElementById('set-ai-exclude');
  if (aiExclude) aiExclude.addEventListener('input', e => { state.aiExcludeTerms = e.target.value; });
}
// ─── Dashboard ───
function renderDashboard(app) {
  state.showDisconnect = false;
  const s = state.settings;
  const d = state.currentDate;
  const dayNum = d.toLocaleDateString('de-DE', { day: 'numeric' });
  const monthYear = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
  const weekday = d.toLocaleDateString('de-DE', { weekday: 'long' });
  const dayRest = monthYear + ' · ' + weekday;

  // Header
  let header = '<header class="sticky" style="top:0;z-index:40;background:var(--header-bg);backdrop-filter:blur(16px);border-bottom:1px solid var(--header-border)"><div class="container flex items-center justify-between" style="padding-top:1rem;padding-bottom:1rem"><div class="flex items-center gap-3"><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAAXNSR0IArs4c6QAAAERlWElmTU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAgKADAAQAAAABAAAAgAAAAABIjgR3AAABdGlUWHRYTUw6Y29tLmFkb2JlLnhtcAAAAAAAPHg6eG1wbWV0YSB4bWxuczp4PSJhZG9iZTpuczptZXRhLyIgeDp4bXB0az0iWE1QIENvcmUgNi4wLjAiPgogICA8cmRmOlJERiB4bWxuczpyZGY9Imh0dHA6Ly93d3cudzMub3JnLzE5OTkvMDIvMjItcmRmLXN5bnRheC1ucyMiPgogICAgICA8cmRmOkRlc2NyaXB0aW9uIHJkZjphYm91dD0iIgogICAgICAgICAgICB4bWxuczp4bXA9Imh0dHA6Ly9ucy5hZG9iZS5jb20veGFwLzEuMC8iPgogICAgICAgICA8eG1wOkNyZWF0b3JUb29sPkFkb2JlIFBob3Rvc2hvcCAyNy42IChNYWNpbnRvc2gpPC94bXA6Q3JlYXRvclRvb2w+CiAgICAgIDwvcmRmOkRlc2NyaXB0aW9uPgogICA8L3JkZjpSREY+CjwveDp4bXBtZXRhPgqCOzMBAAAfbklEQVR4Ae2dB3hc1ZXH1aZoRl0ayWq2bMmSbLlgW7gDsSHBm9AJJJAEQgmQ5Eso3wLJ7iY2u+Sj7JcQNkt2IZQQSDaUAMGmOVR3HBsDlrHlhqxqadTrNEn7e/Ok8Wjemzf3jUYak0/zgfXefbec8z/nnnvuvefdF1u16acxU7/oIRAXvaanWpYQmBJAlPVgSgBTAogyAlFufqoHTAkgyghEufmpHjAlgCgjEOXmp3rAlACijECUm5/qAVMCiDICUW4+IcrtizUfGxsbHxcTFxsbx/+xUpnh4Zhh6Y+3fGwMab70oaHhoeHhwSHyyI+9eU7Xf05TAQAoWCfEg3eMe3Cot9/d3u1s6XTYOwbaup2dva6+AbfTNeQZGgLYhLg4kzHOmmhISzJmpphs6Ym2NDMXSRaDIT4OKXgGh5DK6SmN00sAwA3oCfGxDtdgg72vuq7rwOcdh+u66u39Hd3OfqcHKCXdHx7Rd3+1lhPlGiymhPQUU4HNUlqYWjEzvawwNTfLkmiM9wwOyzX4F4zudexpsh8A6IaEuN4BT3Vt184DzX8/aD/W0NPV6wJwukF8fKxke7zGRwQvhCFZoUEMkVQ8NclYnJ985hzbioqcsumpSYkJbs8QwhCpaqLzRFkAQGowxGHKjzf2vLO38b19jUfruwecg8hDBj0i/MvCAPFEU3xJQcqaRXnnLsmblZfM0OF2D0VXDlETANAbDfEuz9DeavvLH9TsONDS2eMC94SEOGFF1y0dsPZ4dT8t2biyIvvSc4qWlNmMCXEud9S6Q3QEYDTEoY/b9zf/6W9H9x5qxSCQosPE6EY+sAAOkss9hNFbUp519ZdLVs3PQfakBOab+PvJFgCGBadlT7X9yU2Hdx5owTnBBE2cymsDSIfABOFurajIvv6C0soyG24VI4d2qcg+nTwvCJRNxviG1r7HN1Zv2lGLn2MyxMfERwt8CUbapudxsW3/SXTigpXTb7ywLD/L6nRNnhAmqQeg+MyWXttZ+9uXD+JfAr24SxNZjQtWG46T0z0I+j+4bM7XVkzH152crjAZAgDulo6BX79Q9frOOgw91jYYClFPZ2Ti99UVhbddMS87PRGRTDRJE26CzMb43Qftv/jDx0cbupkKTTQ/46zfqxyxr26v/aym81+vOWPpHBumcpx1aheP/8HVZ2nnCPspyo6FfeG9z9c/+ZG90yFZ/C/IjwUMVj7e2dOYYjXML86Y0JnCRAlAXjX7zV8++82LB5iOssDwBQF/hEzmz6xBbfn4pNM9tHSuDWVikJiI34SYIJn6+5/55KUtNafheCuII1wwN3liUzW94affWUi3QJMEy4pni7wAoJsZzYan9r6+s56pvzgp2jlZzxwc5D9AGGYQj/P+5LkbwyZP+QEPkMVLP+mxdoUiT3HVGMNe+qDG4fJsuG4JFjXiMoiwALA89NwNT+59fVcE0AdZ1j/dHo8hIT4jPa0wf9qsooKiwvzcabbM9FSr1WI0GMDR5Xb39fW3dXQ1nbTX1DUcr6mvazjZ3tHp9gwaEvjh8o7L70KNUCYauuf6JayUeAUtIj6hPJEUANpHm1ie8aPvGRx0udxWS+LCeSVnrViycukZc8uKc2yZiYlmlJtWJG+Rn5dHWgViGWVW/gcGHM32ts+qj+3Y/fHWnXsPHj7e1z9gNCLE8LujLAOzMeFn310Em9KaeIR+kZwH0EMffuEARpNuGzZ5bvR2cHBWUeGF67500bo18+bMTk6yYF5IloyMAOdIAvsD3vzb09tfdfDIq2++t/HN94/X1GGbDIbwdQ6X9IYLym69oiKCq0YREwCgP//ucfx9eRsrDAF4pN/gwvnlN3zrMtBH3xEF8hABPVhzCAPE0X36BDJ44o8vfbL/EPcYpmBFNNKRPmrA/ODKtbMiNT+IjABwdfYcsv/44Z2sojAMaPCg+giIBxzO0uIZP77p21+/+CtpKckO9hu9242q+cNIpDeYTcbO7p4X/7r5vx579vCxE4lmk2y1dNVGJ4TZh29bcWa5LSLz5AjMA3B7Wrsdd/52N7OtMPx9bD1K+oPrv/nIg/92zspK4HCNT+tVAUXG0mBuSFi6eP4lXzuXPPv2H6JpjJJq/mCJyAzc9x/vWLskz2pOELCIwWoaSY+IAOLue+bjnVUtLHaGaE3xmAGzorzk0YfWf++aK4xGI4iMnyVFI6cSqBwxWC2W889dXXlGxSdV1Y1NLXpHBRTO3uFgj3rtkvzxmEeZrPEKANO/cXvto68e0jvwQrrT6bryknVP/ObeeXNnOxzO8TNzCmnNKxpitJldPINBvqnZ/umBavqBLnOEM3qotqvAZq2YlT7OveVxCQCyT7YP/Nvv9vQ79Jl+7DvG9O5bb7h//R0WixnF10RsQh4y4CdZEy9ct4ZBa9uufbShSwZ0poM1GKL8ZIthPL12XAJgN/Wh56t2HrCbvNsagjgxmY2Lj3tw/R23f/8azyCeThQ2AmVSUQKmLmvPWsa07p2tHw5BmLAHQc72bhfjwZpFueOZHoc/X8fr31Pduml7rS7jg+bjkDx07103f/dKr6sTsRmNoPgDsiEDyIAYSGLiAHkBGTRuYRz2AQEoNLJpPwqzJJ4mtu+JTYcd7kHxeT7GF4bv//nt373qkv4Bx6QZfW0IIANiIOm+n98mWUZhgwLjsA8IQKHb9R6lKUwBEFFCTMOuAy26VvkZde/80XU3Xft1vP5RAk6Xv5B007VX3Pmj6yFSnCbYBwSgABDxUv45wxEA0iaQhIgS1MW/Lu1rPM4rLj7/rh/fAIfiWqZdZwSfQhKEQR5EQqp4zYAAFAASXicIRwAEkjDvJZ5H3Pbh57Cqg89Dt43kSpY3skEcLO2cEAZ5EAmp4o4ZIAAFgEghfvp/4ZQhkvDlLTUEtQk2h3KZTEYYm5adifMnWEqZDTeRhX6iqbzrbLH0PtwPaX9gNJSaR2TQ5U0GtAJ5EAmpECzeTYGCraeRWPmAGkPd6l6TgnniOIkkFHc9Ma+33vzttWcv09W1fZSjlfISdO+Ay97Z39zR29bV39PvcjhZISVOmvD0WLPJkGwxZqZactKTbGmWpEQjxVk+FR5Qfa3FQC2k3vidyx9+9FlLovnUg+BXQEGQGbAU5SazWhc8o8oT3QIwJMQSRUscp+BuFzrFnPO2W77jcukY3GRKgR55sxt1tL79UG1rfUt3DyHq3qApHqHpstmlB6CtMtbsviRbTAXZKeXTs4py01jBDyMeHVIh+PW3t56obWTpVAW2sUkQAiDAcssl5Xp7uL6JGBw7XEMPv1jFNil9fSwZ6ncY03vu/iGrbOJWVa4I6ImZ/fjIybd2H91T3djS0efyDEo7jkSrs1vr3bCVZMDqv/fNGTmdW4fb09zed/CEHbHh1melsnEWr6svIMyMtFS221772wfiC9e9Dvc/LS8UhMUHlr4xAFAO13YRQc5iiK8KjQtW81nfZ4WZpR6NbAGPvCjHVde2Prv50zc/PIrZwQTRNOkBOVVvyUZmslOQ4lRCVdwKFpfrhGDIXjivHBZUWwlIBBBg4eUGmg54pH2rLzcdfEdVM/H7QkhIk7VBdldY3xdXQFQYO/PXbYeee+dAo71b1mttHoI9pSzDMl3npQ8Ovr7rMKaMITpY5oB0CIZsiIeFgEeqtwACLDurmr2hXapZ1BNFCaI0bbANxLsrgm1AerF3Z5G5vnrjqqnDw61d/TkZ1vMqZy0uy2NcZSgdz3oRYkD59x1u+vM7++0dfeIaCtlszMGCoAyABXCASFA7Ze51CCAuPraxtf9YYzeLoKrQBSRi9OWdRV0LLIyos/LSV84rXLVg+gUrS69dt/DyL80tzEkNYyz1p4ct4qa23uferapt7qJb+D8Kdg3ZbIvCguDoBSyAA0QAFaxOZboQKXIx4vqxcV29bhFjyjhGTAML7oLq408Zrj0TS3xMQMe2lhZmXnXe/HPOKKIPyr6ONPDGS/u6CQls+Bq48lr4EGyj+xi3l7ccrGvuFuwHuHCwACMjPpY/lYprYAEcaRjQE5KkQwBU+1lNh+DSK6TPKZ3FlFJwEFOwM5KAc4kYGH3PWjjj/DOLsSbA7XI6W5ubjh+pPlT1SfWBT08cP9rR1jro8STwWqrmbjtDcZ/DxQDDTELEXWH7bN6cEhiBnWAU+qcDDhDpwT9GxzyA+R5vjIrQDU2QTjwPESUsNPqTGN41YqBDVM4pqG1oeuDhJ9qaG3t7ejweNu5HouQMJlNqanrBjJmlFfMLphfRP5CHalvIoLPX8dquI99YW0G0hLZq8zQ5yQojez4+ILJzCThAJL5GAIWiPYBez9vS9S39ggMANnfV0jN0WX9VvPwTkcGaytI4V7e9pXlw0OPtDFKECd3C7XLZm5v27Nr6/NO/e/GZJ+kTmCdo9i/uu8b+1J7s2r6/TkSZYGHV0kWw4yuucQE4QARQwZpWlhUVAP4br6h39DhFBgCIJpJwTlkxkCmbDDuFarMyM265/psM1AEccovWGwxGLj4/dvjFZ554542NbPySqNocMthzqLGuObTbDgtzymbBjogyAQ4QAZSwuyvcA6iaqBMWAoJo1Rg28RqnF0zDhRAhekzJUDdOl/vcs5fn5tg0akb3MR27t73/yp//0N/XqyoDuADZbftrQw5pNAQjsCPiClMtEBEzIaKmMq+iPQBXmteMGA9DQSQ9J7Zw5owC4ji1LaxIVQF5qHladlZZyUzGmIBH/rf0A4PRePzIoVefe9Yx0I+P5P9UvqYT1DR1Hm/s0PaIYAFGYIemlZUoU4CopXMAuJSPVFNUKFPNhwvI+o/g4iLTSGKYGe7UqxpfKlG2hEmzgR6yGiwSg8Hbm14BxACTJZeFzn1HmkJqCYzAjuBkHogASpq1iv1EMaJCzigRFACZiSAXI0B/rthYogoZBkR+9IPPPt336Ue74xOkQPaAH8gyGrd00kVCAAY7IXKMVg1EACWYmUKiAqBeTogRGQCkSuPiMtPTQmrWKM36/lJtT2+fqkarVsQYsGvLu92d7UpDBDsOl/tYQ7t2Z6VF4laUxVWbo06AEtRUahAWgHchSLVJZSK0EvMk2GeVxTVSwJ11ypraBm3I/GuAmM729qp9e5g7+6fL11TISKA9wMJIktUiKACqZTlIsIOSWVQA7LfJOyFKHpQpcGXwvruifORLkaL99ezpywVZzqytb6o+WoOr46sq5AWRhwerPmE0VvYbpgKtXX3stSkf+VcLO9oZ/DNLQAlLQFgA/i2M+xr9bWztOdrQru2BKNsxGY0b33q/rb0zpNX2L4sVam+1n2xqULqkwNrv8HT0DIg7jv41q14LGmq5rLAApN1B0aEFo+l2a4V74h919Dh27K9jk0ucXBbeTtQ1PvXHl3nfSJVzjUSPx91UX8vKtDIPfZHFCW2XDXbEhzRpgi0KlbAJokLxEESMS2+ftk6hd+56excyEOwEsgle/8AjNXWNeoP6AR1I2uzNqiCSyCqpd79DKR0phc7R29cPU+qPFakAJYy/uABiYzgVT3Bwh9a2jk5Nozk8IL0cQTBB3e7PGngFVzNzDLqPzfn5ff/9/Ctv4YMqWA6dQP2s3/Gqq1rW2AEX07qgZpuyvIIpKAAgAijxbi06lEEdZxIK1ktm3hhVY/VUGmeRSIENMbFv7z3e1edYNX+6xWzEG/H3neCcBUsMDm7P+vsfefHVzSb9xmekydgY1kdVewAZQh6MAjtB5XOKJ+kKlgBKMDP5RQWAfmSk8FLV2NaC3KHPvK8LmEGeS8lyVZIEYmJ3fdbAksDi0rzi/IwUi9HIIZSxHDc5RIjO4RP1vFz3+/97BecnPN0foWE4hhEYiarKQJsvGIEdwVGaqgAqeHcKhERUAGhmdlqioL3GRn9+op4wLC5UGQZ/bzTriKJggtq6Bgg/sSYa06zGqt1bPG5nX7/jRF3DkWO1HZ1ddIJxoe8NHLJYrQwkapZk2EuMunIhMxiBHcGBB4gAStzDFhbA8LAt3cx5nNKmszqpp2Tr9dZP8mZoQR6LiKpmd9hqJnjtVEWY+LiYWIfTc9Ll2bx1z/HD1bje1MNyP2thp6oO9wrPPCOTMzdUvCDI8BKjbjaQWePJltr6kxATsnEGACACKH9Dql0qdKVyeda+OIs2PdkkUjVEc1LAwerjwfYxIDQ1yaz05RGt0WCcOavEbDaaCTeUzpM7JSRtTrSfsnszLb8Qs6bMBhkQE8y/gAUYgR3ZDVMW908BHCACKIGlwpFyogLAknAScEG2JeR4JVfMavv23fuCEQ2hGcmEDcYrtQ4TUVRSyla7P2PjvKbO1LT03PxCZXeEAMiAmGCKBQswIrizBDhABFBBDK8KH6ICoChvhHEScMgdDLkRHEfOaeCkAGyosllO106xmlOTTFwEPGWvEaQksDRX/ANKad9S1ezyCmtyshIXCIAMiFFSQp0QDwswAjvaTchPAQeIAEoks5xHR1acmrlF6SL7qFRNTCunZHBOgyrpoM5spcCWoipO1pAXLV0RKBlxnsbmBHSG3wWVS1W3ECAAMiBGtTmIhwUYEQnRpVnAASJN728scToW44gzHBri4OXUJEOw3upfN7rDGSWckhGMdGxuSX6GchigEvZyyyoWzCwp9WiuZ/g3p3FNJYuWrbLl5KrOwiAAMoINABAPCzCi2o8DGgUWwAEi+Uz3gKfBbvX0gMHhvCxLcV6K4DCA74gLjy+kOhLgXBPvlpWq5rEND+PzrV13oTU5RRW1YMwo00F/+sziZavPUTVoOIvETkOG6pQFsuUjPgSXnoAFcIBoSMdqtPBSBLzJdoMzyAXXpZnEHqupQwackqGEBqVLNCVUzMxWZZ7R0jYt9/yLLmcRX81zV9ankkJPSs/MWncJhyCYlNafAjRdMdMGGao9ALIhHhZgRKV2RRKwAE4wa6bIPpKgowdQgjZWzMvh1QxVi6lsA9I5IYYzSlS9SWpbUJyTlqy+dYPyls6d99VLv8HWLiOzsnLtFLfblZllu+Sb1/Cv0vmhLBaDpiFAVZ8gGLIhXhB9AAGWlfPUa9MgVa8ApGGAE+A5g1yjUt8josk+qTrECTE49b5E3wVamWI1nVmeF8ymIYM5C864/FvXZdpyCL1S1WJfbb4LegwFS8rmXnHNjTm5efQD3yP/CxqlaQhQrRaCIRviRQLiqBZAgKWUAUB8CuClRp8A6Kp8/YDz91W1xp893zWhaw8/9ixnYqjOJCF30ezcwuyUYHTLRvyq625ZfvYao8mEGFBnVchIxNCzcI/L/5WLLrv0qmtT0tKDoU9zNErTqu1CKgRzrBDE+xjRvgAQYAEcVWumUVbfK0reimIzkk1v7q5H5iK+gTSUtbRRkBNiVOHA0+C1Ol4Bw3lQrRCNxjGdVVqOL49DSWSuy+kAaewSQ7T3P6k7ms2J+YUzlp21Zu26C4pmzUYevJavyjnGx2RIuGh1mWT9FBMRb1Wme3/56Ot/28q7kqo1BCTSFJOvO74xP8VqFHER/YuHc2IWE427/2f3Gx/WM+D41xXsGvoQw/NP/mrtWUtZ4FRmI2B/b3XTmx8eIZvKtG20AE8Zk51OR2d7W3ubvbuzE0mwvGNOTExNz8jMyk5JS2OvGDHT4mihwL88QKLrls1eUpZLEHzgY0y52fTu1t1XXn8H2VQVQlmE9bF1ywoe/P5SXWG5cj2iXWxMq7Exl55dxEuBYxKD38AGWvuTe3716p8eycxIVYZ6A8Ti0tyuPuf2T2s13p4AkaEhFx5qVva07Gl5/uhI2u79aW+FQiMdd9X8QppTRZ/ueLKlDVIhWND7pE408rKzi/yWFoNjoXiibwyQi/PRg8pyG9+eED88EGaYUsIYqqnqEWFKzjljxrK5+Rjl4Oorte81LbK158DQkf/QevBXcDcmgWqpnCbOWVSk6vtCGHl+8u+/glRx9AEBKAAEWMa0J3YTxhggVcwCerLVuHl3g6bNGEMC7gRnU5Gf83mCxeHMys9Ar3mLCCD8FXxMRWHdyLZ+9cIZX1pUhAiVMqY5HP/7fv27R3//vK4FcGzanVcvYArmURtOQhIbpgDgZ/q0JM6u+7ypR3CXBlKwHtt2fUTQ3PLKherRtcMxM3PT01MSeSd7wOkRXHcKySTWhnfn1y2ffWZ5PpSrjg+8FP/Y0y9seOARXSFAHNiE73/zxeXBVCokbWEKgHox1tMyE9/6sN6rrSEbkjLISv3ulg9zsjPPXDRP9fUx8MnNTGJvkkgFXpdEV1VNllB7I6cVsEKZedHq8pm5aapOJ1SBPrued63/JXacoV6wchhnL4+zdDk8TnVVUaSe8AVAk9OzrU3tA58cbdcYOQOIgFvs7+b3d6SnpixbMh/DrVRI0qxmQ/kMmy3N2tnr7OlzkomCagvbAdWP3FInrSC8aZnJ51UW834ZFarOXTCJWJ7Hnn7xzg2/hBjVyYp6G94QRD6EddV5xeJjobKq8AUg1RUbUzY97b2PGnv6eWFIw4Ec0y458Vk2v7eDKdXq5UvgGazG5JBGWikhJyOJxaLsjCQ0t29AOqDNZ7yV0uCRF3fp/BQO0OSgCF6sxOJPy0zyyiKgBekWnwcesPsbHvgt1OtCH3HmZSbec2Nl4vhODx2XAGCYSRlxDO9+1KjLXnvVOfb9bX/nPOdVyxanpSYrfVMAQoeRFgegzC2ylRVm2dItJqPkN5MOysDqRVaSFRXyKC3ZXJSbjoMP9JXlednpVlREKV3y82Oxwd7aceu/3Meoi4Mgbnnk4gy5d1+9kNU3VXdWziPybzgTMf96ZcX52eN7Nm6rNev/WgABB96DnG5fe/Zy3odWXTWTm0MSyBiR0w+Iqut3uIimwvkEYryARGMCYUUWs4EzxLBUsnj86fS/xhfAy3x3y66f3PMQHqcun0euh5kX37y693uVjL2Bnde/JYHr8QqAJsClvcd504Pbapp6xAcDH23gzoyf83k4IYaXvxxOZzCdlYsgcm8HGuOnyvbHa4R8FatcIEWzycQ6z6//95nHn/mLrtmWrzpUnnOBHrtrNb1/3PjHjMsEyTShlalWY0l+ytt7GwUXiHzMcIE+Aty2D/e98fZWXMDSkiJezZWHUP9s/tcoHY1iiHz/cautiVgY1hh6+weefX7Tj+7+Bes8rDN7xwD/ikNfoxwEE9x385mlBal8qiJ0gVA5IiAAmkARZkxLSrEYPvj4JF6juLsik0cBrHB7R9drm7e8s2UXaM4ozMNN4iQg7d4Qijupl2BtCGonVvXPL73xzz//z6f+9HJ3Ty99TjeVXqnD6d3fWvCVpQVYwpCti2SIgAnyNcPxdafnBxw2vvneq//wH3BADPKM6T+e3sdXbwQPNPMJL+CCORpjA6dkcE6D6idMMD6YIf7hJ3U4FkW9/Q7bxcDOXm5kP2FCKxwHdNk5RT+7dhHXUusR+kWyB0ASoxzDwPon/qE+4gNfoP/V5QX33BD5j/hEWADQilPEzHDDUx/x5chx9gN/JWOais+Hn4r2ofEMqvxkO05H4Ck/1JIkRnWmVPz8i4/nWkJ/ReGG6xZjY8fv9gRQEtZ+QEAdY28hEULvuWEx2zUcLyo75mOzhHMnIcqnecbxCZ4wWsXSMNhieb5IH3KDT2TA5IhVKiLlf//6YXkOFQb/0S0CF3QqPpv0w8vmykxNBD2R7wEylZCOfeCLT/lZloeeq+IIizDmaBPBsGCdzLYs5oTbr5z39TWcSzE63AsW1pNtogQADVDNJ2H44hPzxi/K52xl6AZcg8wrv/Cfs5WZYdVwek7S2sV5HKTDeWpYVSySHhWZ1LxQi+VhnecX36skzjlSsy0NHiLvBak2Jr2eJX/S/KWDfFY+UiOzalvhJcrj7eR/0nwCTZA/EARTceThxatnVJZnPb6xetOOWhYUEYN/niheo+n4bFesmXnjhWXIgM/RRWyiFYqrSeoBPjLoCiy976m2P7npMCeOM1ZLryH5Hk/uBSgTyoBJXF6RfcMFpZVlNinUa/LAl7idpB7gAxb2mEwtKctaWJK5/dNmvj2xt7qVeCamDmGsjvmq1XvhdRCGcMyWzbVd/eWSVQtyOIhhEiy+ks7J7gE+CtB6YluAfu8hO/O1HVUtnHMECrwTP3EdApVnpYSRlnepV87LvuRsNs5shFWxFTRpNseHgHwRNQGMNE90BV/+GI7h6weE2r23r5EzyJn6IwmMlby+FkBxGLesXtDzwJ2lEWKYiaI9d0nerLxkdtMwQdGC/rQQgA9NEMcg9A54cFU5g/zvh+zHGnq6el04hSwuycIQ32bApZFBl4unJhmL85P5/ikvNxBeTwwz8yzk4Ws9iheTPQYEYxU4WIJGDAtLMpaUZeIjNbX2871GTgLmLNp6ez8fz2Q6LQcugq9SGHIi6ayC8LZ0eoqpwGbBl+etufLpqblZ7BnHe1sZoocFI2Py06NsgoIxzDCAcwKUAMrOH2fRchRhS6fD3jHAsaiMFpzLxieHcVqoAbeK0yU4owTLzkvStvTE7DQzy1CEjBM4hWAQG+7WaaHwCoZPlx4QQBhgYT1YfpbTCavim5kzc5ORiqz7wCkBKoMqnfgx0idIB2vQRjSyxxVQ8+l2e5oKIAAmCVBJFqenEgcQq+82YrsW+pqdyj2KwJQARpGI0t8pAUQJ+NFmpwQwikSU/k4JIErAjzY7JYBRJKL0d0oAUQJ+tNkpAYwiEaW/UwKIEvCjzU4JYBSJKP2dEkCUgB9tdkoAo0hE6e//AwZFpeZX0ASoAAAAAElFTkSuQmCC" style="width:2rem;height:2rem;border-radius:0.5rem"><span style="font-family:&apos;DM Sans&apos;,sans-serif;font-size:0.875rem;font-weight:700;color:var(--navy);letter-spacing:0.2em;text-transform:uppercase">GOCO</span></div><div class="flex items-center gap-3 relative"><span style="font-size:0.75rem;color:var(--ink-muted)">'+esc(s.mocoUserName)+'</span><button class="btn-ghost" onclick="openSettings()" style="font-size:0.75rem" title="Einstellungen"><svg style="width:1rem;height:1rem" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.28Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"/></svg></button><button class="btn-ghost" onclick="toggleDisconnect()" style="font-size:0.75rem" title="Verbindung trennen"><svg style="width:1rem;height:1rem" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3-3h-12m8.25 4.5L19.5 12l-3.75-4.5"/></svg></button>'+'<div id="disconnect-dropdown"></div></div></div></header>';

  // Date nav
  let dateNav = '<div class="flex items-end justify-between mb-10"><div><span class="flex items-center gap-2" style="font-size:0.75rem;text-transform:uppercase;letter-spacing:0.15em;font-weight:600;color:var(--gold);margin-bottom:0.5rem;height:1.125rem;'+(isToday(d)?'':'visibility:hidden')+'">'+(isToday(d)?'<span style="width:6px;height:6px;border-radius:50%;background:var(--gold)" class="anim-pulse"></span>Heute':'&nbsp;')+'</span><h1 style="font-size:clamp(2.5rem,5vw,3.5rem);font-weight:300;color:var(--navy);line-height:1;letter-spacing:-0.03em">'+dayNum+'.</h1><p style="color:var(--ink-muted);font-size:0.875rem;margin-top:0.25rem">'+esc(dayRest)+'</p></div><div class="flex items-center gap-1">'+(isToday(d)?'':'<button class="btn-ghost" style="font-size:0.75rem;margin-right:0.5rem" onclick="goToToday()">Heute</button>')+'<button onclick="navDate(-1)" style="width:2.5rem;height:2.5rem;border-radius:0.75rem;display:flex;align-items:center;justify-content:center;color:var(--ink-muted);background:transparent;border:none;cursor:pointer;transition:all 0.2s" onmouseover="this.style.background=&apos;var(--btn-ghost-hover)&apos;" onmouseout="this.style.background=&apos;transparent&apos;"><svg style="width:1.25rem;height:1.25rem" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5"/></svg></button><button onclick="navDate(1)" style="width:2.5rem;height:2.5rem;border-radius:0.75rem;display:flex;align-items:center;justify-content:center;color:var(--ink-muted);background:transparent;border:none;cursor:pointer;transition:all 0.2s" onmouseover="this.style.background=&apos;var(--btn-ghost-hover)&apos;" onmouseout="this.style.background=&apos;transparent&apos;"><svg style="width:1.25rem;height:1.25rem" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5"/></svg></button></div></div>';
  const refreshIcon = '<svg class="'+(state.calendarRefreshing?'anim-spin':'')+'" style="width:0.875rem;height:0.875rem;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>';
  const refreshButton = '<button id="calendar-refresh-btn" class="btn-ghost calendar-refresh-btn" onclick="hardReload()" aria-label="Kalender aktualisieren" '+(state.calendarRefreshing?'disabled':'')+'>'+refreshIcon+'<span class="refresh-label">'+(state.calendarRefreshing?'Aktualisiere …':(state.calendarRefreshResult||'Kalender aktualisieren'))+'</span></button>';
  dateNav = dateNav
    .replace('<div class="flex items-center gap-1">', '<div class="flex items-center gap-1">'+refreshButton)
    .replace('<button onclick="navDate(-1)"', '<button aria-label="Vorheriger Tag" onclick="navDate(-1)"')
    .replace('<button onclick="navDate(1)"', '<button aria-label="Nächster Tag" onclick="navDate(1)"');

  // Stats — based only on visible (non-hidden) calendar entries, not MOCO activities
  const visibleEntries = state.entries.filter(e => !e.isHidden);
  const totalMin = visibleEntries.reduce((s,e) => s + e.totalMinutes, 0);
  const syncedCount = visibleEntries.filter(e => e.isSynced).length;
  const hasData = !state.dataLoading && (state.entries.length > 0 || (state.mocoActivities && state.mocoActivities.length > 0));
  let stats = '';
  if (hasData) {
    stats = '<div class="grid-3 mb-8" id="stats-cards"><div class="stat-card text-center"><div class="font-display" style="font-size:1.875rem;color:var(--navy);font-variant-numeric:tabular-nums">'+visibleEntries.length+'</div><div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.15em;font-weight:600;margin-top:0.25rem">Kalendereinträge</div></div><div class="stat-card text-center"><div class="font-display" style="font-size:1.875rem;color:var(--navy);font-variant-numeric:tabular-nums">'+(totalMin/60).toFixed(2)+'<span style="font-size:1.125rem;color:var(--ink-faint);margin-left:0.125rem">h</span></div><div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.15em;font-weight:600;margin-top:0.25rem">Gesamt heute</div></div><div class="stat-card text-center"><div class="font-display" style="font-size:1.875rem;font-variant-numeric:tabular-nums"><span style="color:var(--gold)">'+syncedCount+'</span><span style="font-size:1.125rem;color:var(--ink-faint)">/'+visibleEntries.length+'</span></div><div style="font-size:10px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.15em;font-weight:600;margin-top:0.25rem">In MOCO</div></div></div>';
  }

  // Error / sync result
  let alerts = '';
  if (state.error) alerts += '<div style="margin-bottom:1.5rem;padding:1rem;border-radius:1.25rem;background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);font-size:0.875rem" class="anim-fade-in">'+esc(state.error)+'</div>';
  if (state.aiWarning) alerts += '<div style="margin-bottom:1.5rem;padding:1rem;border-radius:1.25rem;background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);font-size:0.875rem" class="anim-fade-in">'+esc(state.aiWarning)+'</div>';
  if (state.syncResult) {
    const sr = state.syncResult;
    const bg = sr.failed === 0 ? 'background:var(--ok-bg);border:1px solid var(--ok-border);color:var(--ok-text)' : 'background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text)';
    let msg = ''; if (sr.success > 0) msg += sr.success + ' Einträge synchronisiert. '; if (sr.failed > 0) msg += sr.failed + ' fehlgeschlagen.';
    alerts += '<div style="margin-bottom:1.5rem;padding:1rem;border-radius:1.25rem;'+bg+';font-size:0.875rem" class="anim-fade-in">'+esc(msg)+'</div>';
  }

  // Content
  let content = '';
  if (state.dataLoading) {
    content = '<div class="flex flex-col items-center justify-center py-24"><div style="width:3rem;height:3rem;border-radius:0.75rem;background:var(--spinner-bg);display:flex;align-items:center;justify-content:center;margin-bottom:1rem"><svg class="anim-spin" style="width:1.25rem;height:1.25rem;color:var(--navy)" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg></div><p style="color:var(--ink-muted);font-size:0.875rem">Lade Kalender und MOCO-Daten ...</p></div>';
  } else if (state.entries.length === 0) {
    const hasMocoOnly = state.mocoActivities && state.mocoActivities.length > 0;
    content = hasMocoOnly ? '' : '<div class="card flex flex-col items-center justify-center py-20 anim-fade-up"><div style="width:4rem;height:4rem;border-radius:1.25rem;background:var(--btn-secondary-bg);display:flex;align-items:center;justify-content:center;margin-bottom:1.25rem"><svg style="width:2rem;height:2rem;color:var(--ink-faint)" fill="none" viewBox="0 0 24 24" stroke-width="1" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5"/></svg></div><h3 style="font-family:&apos;DM Sans&apos;,sans-serif;font-size:1.125rem;font-weight:600;color:var(--navy);margin-bottom:0.25rem;letter-spacing:-0.01em">Keine Kalendereinträge</h3><p style="font-size:0.875rem;color:var(--ink-muted)">Für diesen Tag gibt es keine Kalendereinträge.</p></div>';
  } else {
    const pendingItems = [], syncedItems = [];
    state.entries.forEach((e, i) => (e.isSynced ? syncedItems : pendingItems).push([e, i]));

    const checkSvg = '<svg style="width:0.75rem;height:0.75rem;color:var(--cream-50)" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
    const timeSvg = '<svg style="width:0.875rem;height:0.875rem" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z"/></svg>';
    const eyeOffSvg = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
    const eyeSvg = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';

    // Pending cards
    let pendingCards = pendingItems.map(([entry, i]) => {
      const cbClass = entry.isSelected ? 'checkbox checked' : 'checkbox';
      const check = entry.isSelected ? checkSvg : '';
      let badges = '';
      if (entry.events.length > 1) badges += '<span class="badge badge-grouped">'+entry.events.length+'x zusammengefasst</span>';
      if (entry.aiSuggested && entry.projectId && entry.taskId) badges += '<span class="badge-ai" title="Mittels KI zugeordnet" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.125rem 0.5rem;border-radius:0.375rem;background:var(--gold-pill-bg);color:var(--gold-pill-text);font-size:0.6875rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase">KI</span>';
      const mapping = entry.projectId && entry.taskId;
      let projTrigger;
      if (entry.aiPending) {
        projTrigger = '<div class="relative" id="proj-wrap-'+i+'"><button class="project-trigger" onclick="toggleProjectDropdown('+i+')" style="opacity:0.7"><span class="flex items-center gap-2" style="color:var(--ink-muted);font-style:italic"><svg class="anim-spin" style="width:0.875rem;height:0.875rem" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>KI ordnet zu …</span></button></div>';
      } else {
        projTrigger = '<div class="relative" id="proj-wrap-'+i+'"><button class="'+(mapping?'project-trigger':'project-trigger unassigned')+'" onclick="toggleProjectDropdown('+i+')">'+(mapping?renderProjectPath(entry.customerName, entry.projectName, entry.taskName):'<span class="truncate flex-1" style="color:var(--gold-dark);font-weight:500">Projekt zuordnen...</span>')+'<svg style="width:1rem;height:1rem;color:var(--ink-faint);transition:transform 0.2s;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg></button></div>';
      }
      const descVal = entry.description !== undefined ? entry.description : entry.summary;
      const descChanged = entry.description !== undefined && entry.description !== entry.summary;
      const hiddenClass = entry.isHidden ? ' is-hidden' : '';
      return '<div id="entry-card-'+i+'" class="card anim-fade-up delay-'+Math.min(i+2,6)+hiddenClass+'"><div class="card-body"><div class="flex items-start gap-4"><div id="entry-cb-'+i+'" class="'+cbClass+'" style="margin-top:2px" onclick="toggleEntry('+i+')">'+check+'</div><div class="flex-1 min-w-0"><div class="flex items-center gap-2 mb-1" id="entry-title-wrap-'+i+'"><h3 id="entry-title-'+i+'" onclick="editDescription('+i+')" style="font-weight:600;font-size:0.875rem;color:var(--ink);cursor:text;border-bottom:1px dashed '+(descChanged?'var(--gold)':'transparent')+'" title="Klicken zum Bearbeiten der Beschreibung">'+esc(descVal)+'</h3>'+badges+'</div><div class="flex items-center gap-3" style="font-size:0.75rem;color:var(--ink-muted);margin-bottom:0.75rem"><span class="flex items-center gap-1">'+timeSvg+formatHours(entry.totalMinutes)+'</span><span style="color:var(--border)">|</span><span>'+esc(entry.timeRanges.join(', '))+'</span></div>'+projTrigger+'</div><div class="flex-shrink-0" style="display:flex;flex-direction:column;align-items:flex-end;justify-content:space-between;align-self:stretch"><div class="text-right"><div class="font-display" style="font-size:1.5rem;font-variant-numeric:tabular-nums;color:var(--navy)">'+entry.totalHours.toFixed(2)+'</div><div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.15em;font-weight:600">Stunden</div></div><button class="hide-btn" onclick="hideEntry('+i+')" title="Ausblenden">'+eyeOffSvg+'</button></div></div></div><div class="card-hidden-strip"><span class="card-hidden-title">'+esc(descVal)+'</span><button class="card-restore-btn" onclick="showEntry('+i+')" title="Einblenden">'+eyeSvg+'</button></div></div>';
    }).join('');
    pendingCards = pendingCards
      .split('class="checkbox checked" style=').join('class="checkbox checked" role="checkbox" tabindex="0" aria-checked="true" onkeydown="handleCheckboxKey(event)" style=')
      .split('class="checkbox" style=').join('class="checkbox" role="checkbox" tabindex="0" aria-checked="false" onkeydown="handleCheckboxKey(event)" style=')
      .split('<h3 id="entry-title-').join('<h3 class="editable-title" role="button" tabindex="0" onkeydown="handleEditableTitleKey(event)" id="entry-title-');

    const hiddenCount = pendingItems.filter(([e]) => e.isHidden).length;
    const hiddenRow = '<div id="hidden-entries-row" style="text-align:right;margin-bottom:0.5rem;padding-right:1.5rem;visibility:'+(hiddenCount>0?'visible':'hidden')+'"><button onclick="showAllHidden()" style="font-family:inherit;background:none;border:none;padding:0;font-size:0.8125rem;color:var(--ink-muted);cursor:pointer;text-decoration:underline;text-underline-offset:2px" onmouseover="this.style.color=\\'var(--ink-sec)\\'" onmouseout="this.style.color=\\'var(--ink-muted)\\'">'+hiddenCount+' ausgeblendet \xb7 Alle einblenden</button></div>';
    content = (pendingCards ? hiddenRow+'<div class="space-y-3">'+pendingCards+'</div>' : '');
  }

  // Sync bar
  const selEntries = state.entries.filter(e => e.isSelected && !e.isSynced);
  const selCount = selEntries.length;
  const selMin = selEntries.reduce((s,e) => s + e.totalMinutes, 0);
  const syncableCount = state.entries.filter(e => e.isSelected && !e.isSynced && e.projectId && e.taskId).length;
  let syncBar = '';
  if (!state.dataLoading && state.entries.some(e => !e.isSynced)) {
    const btnStyle = (state.syncing || syncableCount === 0)
      ? 'background:#1a3045;color:#5a6878;cursor:not-allowed'
      : 'background:var(--gold-btn);color:#0d1d2b;cursor:pointer';
    const deselectLink = selCount > 0 ? '<button onclick="deselectAll()" style="font-family:inherit;margin-left:1.25rem;padding:0;background:none;border:none;color:#9fb3c8;cursor:pointer;font-size:0.8125rem;text-decoration:underline;text-underline-offset:2px" onmouseover="this.style.color=\\'#f5f2ec\\'" onmouseout="this.style.color=\\'#9fb3c8\\'">Alle abw\\u00e4hlen</button>' : '';
    syncBar = '<div class="sticky" style="bottom:1.5rem;margin-top:2.5rem"><div class="sync-bar flex items-center justify-between" style="padding:1.5rem"><div id="sync-bar-info" style="font-size:0.875rem"><span style="font-weight:600;color:#f5f2ec">'+selCount+' Einträge</span><span style="color:#9fb3c8;margin-left:0.5rem">('+formatHours(selMin)+')</span>'+deselectLink+'</div><button id="sync-bar-btn" onclick="handleSync()" style="padding:0.625rem 1.5rem;border-radius:0.875rem;font-weight:600;font-size:0.875rem;border:none;transition:all 0.2s;'+btnStyle+'" '+(state.syncing||syncableCount===0?'disabled':'')+'>'+(state.syncing?'<span class="flex items-center gap-2"><svg class="anim-spin" style="width:1rem;height:1rem" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Synchronisiere...</span>':'Synchronisieren')+'</button></div></div>';
  }

  // MOCO activities section — shows ALL activities for this day
  let mocoSection = '';
  if (!state.dataLoading && state.mocoError) {
    mocoSection = '<div style="margin-top:2rem;padding:1rem;border-radius:1.25rem;background:var(--err-bg);border:1px solid var(--err-border);color:var(--err-text);font-size:0.875rem" class="anim-fade-in"><strong>MOCO-Fehler:</strong> '+esc(state.mocoError)+'</div>';
  } else if (!state.dataLoading && state.mocoActivities && state.mocoActivities.length > 0) {
    const mocoTotalHrs = state.mocoActivities.reduce((s,a) => s + (a.seconds ? a.seconds/3600 : (a.hours ? parseFloat(a.hours) : 0)), 0);
    const mocoCards = state.mocoActivities.map(act => {
      const hrs = act.seconds ? (act.seconds / 3600).toFixed(2) : (act.hours ? parseFloat(act.hours).toFixed(2) : '–');
      const hasDesc = act.description && act.description.trim();
      const desc = hasDesc ? esc(act.description) : '<span style="opacity:0.45">Kein Titel</span>';
      const proj = act.project ? esc(act.project.name) : '';
      const task = act.task ? esc(act.task.name) : '';
      const custName = act.customer ? esc(act.customer.name) : '';
      const projLine = proj ? (custName ? custName + ' / ' : '') + proj + (task ? ' → ' + task : '') : '';
      return '<div class="card anim-fade-up" style="background:var(--moco-bg);border-color:var(--moco-border)"><div class="flex items-start gap-4"><div style="width:1.5rem;height:1.5rem;border-radius:0.375rem;background:var(--moco-icon-bg);display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px"><svg style="width:0.75rem;height:0.75rem;color:var(--moco-text)" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg></div><div class="flex-1 min-w-0"><div style="font-weight:600;font-size:0.875rem;color:var(--ink)">'+desc+'</div>'+(projLine ? '<div style="font-size:0.75rem;color:var(--ink-muted);margin-top:0.25rem">'+projLine+'</div>' : '')+'</div><div class="text-right flex-shrink-0"><div style="font-size:1.25rem;font-weight:600;font-variant-numeric:tabular-nums;color:var(--navy)">'+hrs+'</div><div style="font-size:9px;color:var(--moco-text);text-transform:uppercase;letter-spacing:0.15em;font-weight:600">In MOCO</div></div></div></div>';
    }).join('');
    mocoSection = '<div class="anim-fade-up" style="margin-top:2.5rem"><div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:1rem"><div style="flex:1;height:1px;background:var(--moco-divider)"></div><span style="font-size:0.6875rem;font-weight:600;letter-spacing:0.14em;text-transform:uppercase;color:var(--moco-text);white-space:nowrap">In MOCO eingetragen ('+state.mocoActivities.length+' · '+mocoTotalHrs.toFixed(2)+' h)</span><div style="flex:1;height:1px;background:var(--moco-divider)"></div></div><div class="space-y-2">'+mocoCards+'</div></div>';
  }

  app.innerHTML = header + '<main class="container py-10">' + dateNav + stats + '<div id="dashboard-alerts">' + alerts + '</div>' + content + mocoSection + syncBar + '</main>';
}

// Dashboard handlers
window.toggleDisconnect = function() {
  state.showDisconnect = !state.showDisconnect;
  var dd = document.getElementById('disconnect-dropdown');
  if (!dd) { render(); return; }
  if (state.showDisconnect) {
    dd.innerHTML = '<div class="absolute anim-slide-down" style="right:0;top:100%;margin-top:0.5rem;width:18rem;background:var(--card-bg);border-radius:1.25rem;box-shadow:var(--shadow-dropdown);border:1px solid var(--border);overflow:hidden;z-index:50"><div style="padding:1.25rem"><p style="font-size:0.875rem;color:var(--ink-sec);margin-bottom:1rem;line-height:1.6">Verbindung trennen? Zuordnungen bleiben erhalten.</p><div class="flex gap-2"><button class="btn-secondary flex-1" style="font-size:0.75rem" onclick="toggleDisconnect()">Abbrechen</button><button style="flex:1;padding:0.5rem 0.75rem;border-radius:0.75rem;background:var(--disconnect);color:#fff;font-size:0.75rem;font-weight:600;border:none;cursor:pointer;transition:background 0.2s" onmouseover="this.style.background=&apos;var(--disconnect-hover)&apos;" onmouseout="this.style.background=&apos;var(--disconnect)&apos;" onclick="doDisconnect()">Trennen</button></div></div></div>';
  } else {
    dd.innerHTML = '';
  }
  return;
};
window.doDisconnect = function() { clearSettings(); state.settings = null; state.page = 'onboarding'; state.step = 'calendar'; state.icalUrl = ''; state.mocoSubdomain = ''; state.mocoApiKey = ''; state.users = []; state.selectedUser = null; state.showDisconnect = false; state.entries = []; state.projects = []; state.mocoActivities = []; state.mocoError = null; state.syncResult = null; state.error = ''; render(); };
window.hardReload = async function() {
  state.showDisconnect = false;
  if (state.calendarRefreshResetTimer) {
    clearTimeout(state.calendarRefreshResetTimer);
    state.calendarRefreshResetTimer = null;
  }
  state.calendarRefreshing = true;
  state.calendarRefreshResult = '';
  updateRefreshButtonInPlace();
  try {
    const response = await fetch('/api/cache/clear', { method: 'POST' });
    if (!response.ok) throw new Error('Cache konnte nicht geleert werden.');
    await fetchDashboardData(true);
    state.calendarRefreshResult = 'Aktualisiert';
  } catch (e) {
    state.error = 'Kalender konnte nicht aktualisiert werden: ' + e.message;
  } finally {
    state.calendarRefreshing = false;
    updateRefreshButtonInPlace();
    if (state.calendarRefreshResult) {
      state.calendarRefreshResetTimer = setTimeout(function() {
        state.calendarRefreshResult = '';
        state.calendarRefreshResetTimer = null;
        updateRefreshButtonInPlace();
      }, 3000);
    }
  }
};
function updateRefreshButtonInPlace() {
  var btn = document.getElementById('calendar-refresh-btn');
  if (!btn) return;
  btn.disabled = state.calendarRefreshing;
  var icon = '<svg class="'+(state.calendarRefreshing?'anim-spin':'')+'" style="width:0.875rem;height:0.875rem;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"/></svg>';
  btn.innerHTML = icon + '<span class="refresh-label">' + (state.calendarRefreshing ? 'Aktualisiere …' : (state.calendarRefreshResult || 'Kalender aktualisieren')) + '</span>';
  btn.setAttribute('aria-label', state.calendarRefreshing ? 'Kalender wird aktualisiert' : 'Kalender aktualisieren');
}
window.navDate = function(off) {
  const d = new Date(state.currentDate); d.setDate(d.getDate() + off);
  state.currentDate = d; fetchDashboardData();
};
window.goToToday = function() { state.currentDate = new Date(); fetchDashboardData(); };
window.deselectAll = function() {
  state.entries.forEach(function(entry, i) {
    if (!entry.isSynced && entry.isSelected) {
      entry.isSelected = false;
      var cb = document.getElementById('entry-cb-' + i);
      if (cb) { cb.className = 'checkbox'; cb.innerHTML = ''; cb.setAttribute('aria-checked', 'false'); }
    }
  });
  var info = document.getElementById('sync-bar-info');
  if (info) info.innerHTML = '<span style="font-weight:600;color:var(--cream-50)">0 Einträge</span><span style="color:var(--navy-300);margin-left:0.5rem">(0:00 h)</span>';
  var btn = document.getElementById('sync-bar-btn');
  if (btn) { btn.disabled = true; btn.style.background = 'var(--navy-800)'; btn.style.color = 'var(--navy-400)'; btn.style.cursor = 'not-allowed'; }
};
function updateHiddenRow() {
  var hiddenCount = state.entries.filter(function(e) { return e.isHidden && !e.isSynced; }).length;
  var row = document.getElementById('hidden-entries-row');
  if (!row) return;
  row.style.visibility = hiddenCount > 0 ? 'visible' : 'hidden';
  var button = row.querySelector('button');
  if (button) button.textContent = hiddenCount + ' ausgeblendet \xb7 Alle einblenden';
}
function updateSyncBarInPlace() {
  var selEntries = state.entries.filter(function(e) { return e.isSelected && !e.isSynced; });
  var selCount = selEntries.length;
  var selMin = selEntries.reduce(function(s, e) { return s + e.totalMinutes; }, 0);
  var syncableCount = state.entries.filter(function(e) { return e.isSelected && !e.isSynced && e.projectId && e.taskId; }).length;
  var deselectLink = selCount > 0 ? '<button onclick="deselectAll()" style="font-family:inherit;margin-left:1.25rem;padding:0;background:none;border:none;color:#9fb3c8;cursor:pointer;font-size:0.8125rem;text-decoration:underline;text-underline-offset:2px" onmouseover="this.style.color=\\'#f5f2ec\\'" onmouseout="this.style.color=\\'#9fb3c8\\'">Alle abw\\u00e4hlen</button>' : '';
  var info = document.getElementById('sync-bar-info');
  if (info) info.innerHTML = '<span style="font-weight:600;color:#f5f2ec">'+selCount+' Eintr\\u00e4ge</span><span style="color:#9fb3c8;margin-left:0.5rem">('+formatHours(selMin)+')</span>'+deselectLink;
  var btn = document.getElementById('sync-bar-btn');
  if (btn) {
    var canSync = !state.syncing && syncableCount > 0;
    btn.disabled = !canSync;
    btn.style.background = canSync ? 'var(--gold-btn)' : '#1a3045';
    btn.style.color = canSync ? '#0d1d2b' : '#5a6878';
    btn.style.cursor = canSync ? 'pointer' : 'not-allowed';
  }
}
function updateStatsInPlace() {
  var statsCards = document.getElementById('stats-cards');
  if (!statsCards) return;
  var visibleEntries = state.entries.filter(function(e) { return !e.isHidden; });
  var totalMin = visibleEntries.reduce(function(s, e) { return s + e.totalMinutes; }, 0);
  var syncedCount = visibleEntries.filter(function(e) { return e.isSynced; }).length;
  var statDivs = statsCards.querySelectorAll('.stat-card');
  if (statDivs[0]) { var n0 = statDivs[0].querySelector('.font-display'); if (n0) n0.textContent = visibleEntries.length; }
  if (statDivs[1]) { var n1 = statDivs[1].querySelector('.font-display'); if (n1) n1.innerHTML = (totalMin/60).toFixed(2)+'<span style="font-size:1.125rem;color:var(--ink-faint);margin-left:0.125rem">h</span>'; }
  if (statDivs[2]) { var n2 = statDivs[2].querySelector('.font-display'); if (n2) n2.innerHTML = '<span style="color:var(--gold)">'+syncedCount+'</span><span style="font-size:1.125rem;color:var(--ink-faint)">/'+visibleEntries.length+'</span>'; }
}
window.hideEntry = function(i) {
  var entry = state.entries[i];
  if (!entry || entry.isSynced) return;
  entry.isHidden = true;
  getHiddenKeys().add(entry.key);
  if (entry.isSelected) {
    entry.isSelected = false;
    var cb = document.getElementById('entry-cb-' + i);
    if (cb) { cb.className = 'checkbox'; cb.innerHTML = ''; cb.setAttribute('aria-checked', 'false'); }
  }
  var card = document.getElementById('entry-card-' + i);
  if (card) card.classList.add('is-hidden');
  updateSyncBarInPlace();
  updateHiddenRow();
  updateStatsInPlace();
};
window.showEntry = function(i) {
  var entry = state.entries[i];
  if (!entry) return;
  entry.isHidden = false;
  getHiddenKeys().delete(entry.key);
  var card = document.getElementById('entry-card-' + i);
  if (card) card.classList.remove('is-hidden');
  updateHiddenRow();
  updateStatsInPlace();
};
window.showAllHidden = function() {
  state.entries.forEach(function(entry, i) {
    if (entry.isHidden && !entry.isSynced) {
      entry.isHidden = false;
      getHiddenKeys().delete(entry.key);
      var card = document.getElementById('entry-card-' + i);
      if (card) card.classList.remove('is-hidden');
    }
  });
  updateHiddenRow();
  updateStatsInPlace();
};
window.toggleEntry = function(i) {
  var entry = state.entries[i];
  if (!entry || entry.isSynced || entry.isHidden) return;
  entry.isSelected = !entry.isSelected;
  // Update checkbox in-place
  var cbClass = entry.isSelected ? 'checkbox checked' : 'checkbox';
  var checkSvg = entry.isSelected ? '<svg style="width:0.75rem;height:0.75rem;color:var(--cream-50)" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' : '';
  var cb = document.getElementById('entry-cb-' + i);
  if (cb) { cb.className = cbClass; cb.innerHTML = checkSvg; cb.setAttribute('aria-checked', entry.isSelected ? 'true' : 'false'); }
  updateSyncBarInPlace();
};
window.handleCheckboxKey = function(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  const index = Number((event.currentTarget.id || '').split('-').pop());
  if (Number.isInteger(index)) toggleEntry(index);
};
window.handleEditableTitleKey = function(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  event.currentTarget.click();
};

window.toggleProjectDropdown = function(i) {
  // Simple: open project selector in a modal-like overlay
  const entry = state.entries[i];
  if (!entry || entry.isSynced) return;
  showProjectPicker(i);
};

function showProjectPicker(entryIdx) {
  // Create overlay
  var overlay = document.createElement('div');
  overlay.id = 'project-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:var(--modal-overlay-bg);backdrop-filter:blur(4px)';
  function closePicker() {
    document.removeEventListener('keydown', handlePickerKey);
    overlay.remove();
  }
  function handlePickerKey(event) { if (event.key === 'Escape') closePicker(); }
  overlay._closePicker = closePicker;
  overlay.onclick = function(e) { if (e.target === overlay) closePicker(); };
  document.addEventListener('keydown', handlePickerKey);

  var panel = document.createElement('div');
  panel.className = 'anim-slide-down';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Projekt zuordnen');
  panel.style.cssText = 'width:90%;max-width:640px;max-height:70vh;background:var(--card-bg);border-radius:1.25rem;box-shadow:var(--shadow-dropdown);overflow:hidden;display:flex;flex-direction:column';

  // Store project data by key to avoid escaping issues in HTML attributes
  var pickerData = {};

  // Event delegation for task clicks (attached once on panel)
  panel.addEventListener('click', function(e) {
    var btn = e.target.closest('.picker-task');
    if (!btn) return;
    var d = pickerData[btn.getAttribute('data-key')];
    if (d) pickProject(entryIdx, d.projId, d.taskId, d.projName, d.taskName, d.custName);
  });

  var searchVal = '';
  var firstRender = true;
  function normalize(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }
  function renderPicker() {
    var q = normalize(searchVal);
    var filtered = state.projects.slice().reverse();
    if (q) {
      var tokens = q.split(/\\s+/).filter(Boolean);
      filtered = state.projects.slice().reverse().map(function(p) {
        var custName = p.customer && p.customer.name ? p.customer.name : '';
        var projFields = [normalize(p.name), normalize(custName), normalize(p.identifier)];
        var pm = tokens.every(function(tok) { return projFields.some(function(f) { return f.indexOf(tok) !== -1; }); });
        var mt = p.tasks.filter(function(t) {
          if (!t.active) return false;
          if (pm) return true;
          var allFields = projFields.concat([normalize(t.name)]);
          return tokens.every(function(tok) { return allFields.some(function(f) { return f.indexOf(tok) !== -1; }); });
        });
        if (pm || mt.length > 0) {
          var copy = {}; for (var k in p) copy[k] = p[k];
          copy.tasks = pm ? p.tasks.filter(function(t){return t.active;}) : mt;
          return copy;
        }
        return null;
      }).filter(Boolean);
    }

    var entry = state.entries[entryIdx];
    var items = '';
    pickerData = {};
    if (filtered.length === 0) {
      items = '<div style="padding:2rem;text-align:center;font-size:0.875rem;color:var(--ink-muted)">Keine Projekte gefunden</div>';
    } else {
      var firstGroup = true;
      filtered.forEach(function(proj) {
        var taskItems = '';
        proj.tasks.filter(function(t){return t.active;}).forEach(function(task) {
          var sel = entry.projectId === proj.id && entry.taskId === task.id;
          var key = proj.id + '-' + task.id;
          pickerData[key] = { projId: proj.id, taskId: task.id, projName: proj.name, taskName: task.name, custName: proj.customer.name };
          taskItems += '<button class="picker-task'+(sel?' sel':'')+'" data-key="'+key+'" style="width:100%;display:flex;align-items:flex-start;gap:0.5rem;padding:0.4375rem 1.25rem;text-align:left;font-size:0.8125rem;line-height:1.3;border:none;cursor:pointer;transition:all 0.15s;background:'+(sel?'var(--picker-sel-bg)':'transparent')+';color:'+(sel?'var(--navy)':'var(--ink-sec)')+';font-weight:'+(sel?'500':'400')+'"><span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;margin-top:0.4em;background:'+(sel?'var(--gold)':'var(--border)')+'"></span><span style="flex:1">'+esc(task.name)+'</span>'+(sel?'<svg style="width:1rem;height:1rem;color:var(--gold);flex-shrink:0" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>':'')+'</button>';
        });
        items += '<div style="'+(firstGroup?'':'border-top:1px solid var(--border);')+'padding:1.5rem 0 1.375rem"><div style="padding:0 1.25rem 0.75rem"><div style="display:flex;align-items:center;gap:0.375rem;margin-bottom:0.4375rem;font-size:10px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.15em">'+esc(proj.customer.name)+(proj.identifier ? '<span style="color:var(--ink-faint);font-weight:400">&middot;</span><span class="picker-identifier">'+esc(proj.identifier)+'</span>' : '')+'</div><div class="picker-project-title">'+esc(proj.name)+'</div></div>'+taskItems+'</div>';
        firstGroup = false;
      });
    }

    var timeStr = entry.timeRanges && entry.timeRanges.length === 1 ? entry.timeRanges[0] : (entry.events && entry.events.length > 1 ? entry.events.length + '\u00D7 zusammengefasst' : '');
    panel.innerHTML = '<div style="padding:1.375rem 1.25rem 1.25rem;background:var(--surface);border-radius:1.25rem 1.25rem 0 0;border-bottom:1px solid var(--border)">' +
        '<div style="font-size:10px;font-weight:600;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:0.5rem">Projektzuordnung f\u00FCr</div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;gap:0.875rem">' +
          '<span style="font-size:1.3125rem;color:var(--ink);font-weight:600;letter-spacing:-0.012em;line-height:1.25;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(entry.summary)+'</span>' +
          '<span style="font-size:0.8125rem;font-weight:600;color:var(--gold-dark);background:rgba(196,154,82,0.12);padding:0.3125rem 0.6875rem;border-radius:0.4375rem;white-space:nowrap">'+formatHours(entry.totalMinutes)+'</span>' +
        '</div>' +
        (timeStr ? '<div style="margin-top:0.5rem;font-size:0.8125rem;color:var(--ink-muted)">'+esc(timeStr)+'</div>' : '') +
      '</div>' +
      '<div style="padding:0.875rem 1.25rem;border-bottom:1px solid var(--card-border)"><div style="position:relative"><svg style="position:absolute;left:0.75rem;top:50%;transform:translateY(-50%);width:1rem;height:1rem;color:var(--ink-faint)" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/></svg><input id="picker-search" type="text" style="width:100%;padding:0.625rem 0.75rem 0.625rem 2.25rem;border-radius:0.5rem;background:var(--cream-50);border:1px solid var(--border);font-size:0.875rem;color:var(--ink);outline:none" placeholder="Firma, Projekt oder Teilschritt suchen..."></div></div>' +
      '<div class="picker-scroll" style="position:relative;overflow-y:auto;max-height:calc(70vh - 8.5rem);padding:0 0 0.25rem">'+items+'</div>';

    var si = panel.querySelector('#picker-search');
    if (si) {
      si.value = searchVal;
      si.focus();
      si.addEventListener('input', function(e) { searchVal = e.target.value; renderPicker(); });
    }

    // On first open, scroll to the already assigned task so that a correction
    // does not start at the top of the list.
    // Use offsetTop (layout based) instead of getBoundingClientRect: the
    // slideDown animation distorts the panel with scale()/translate(), which
    // makes rect coordinates unusable. The whole group (including the project
    // header) is aligned, not just the task itself.
    if (firstRender) {
      firstRender = false;
      var scrollC = panel.querySelector('.picker-scroll');
      var selEl = scrollC && scrollC.querySelector('.picker-task.sel');
      var targetEl = selEl;
      if (selEl) {
        var grp = selEl.parentElement; // enclosing project group
        if (grp && grp.parentElement === scrollC) targetEl = grp;
      }
      if (scrollC && targetEl) {
        // Align the project group to the top (small gap) so the header is
        // visible and all tasks lie below it – never scroll upwards to find it.
        scrollC.scrollTop = Math.max(0, targetEl.offsetTop - 12);
      }
    }
  }

  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  renderPicker();
}

window.pickProject = function(idx, projId, taskId, projName, taskName, custName) {
  const entry = state.entries[idx];
  entry.projectId = projId; entry.taskId = taskId;
  entry.projectName = projName; entry.taskName = taskName; entry.customerName = custName;
  entry.aiPending = false; entry.aiSuggested = false;
  if (!entry.isSynced) entry.isSelected = true;
  addMapping({ keyword: entry.summary, projectId: projId, taskId, projectName: projName, taskName, customerName: custName });
  const overlay = document.getElementById('project-overlay');
  if (overlay) overlay._closePicker ? overlay._closePicker() : overlay.remove();
  // In-place DOM update instead of full render() to avoid re-animation
  var projWrap = document.getElementById('proj-wrap-' + idx);
  if (projWrap) {
    projWrap.innerHTML = '<button class="project-trigger" onclick="toggleProjectDropdown('+idx+')">'+renderProjectPath(custName, projName, taskName)+'<svg style="width:1rem;height:1rem;color:var(--ink-faint);transition:transform 0.2s;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg></button>';
  }
  // Update checkbox
  var cb = document.getElementById('entry-cb-' + idx);
  if (cb && entry.isSelected) {
    cb.className = 'checkbox checked';
    cb.innerHTML = '<svg style="width:0.75rem;height:0.75rem;color:var(--cream-50)" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>';
    cb.setAttribute('aria-checked', 'true');
  }
  updateAiEntryInPlace(entry, idx);
  updateSyncBarInPlace();
  updateStatsInPlace();
};

window.updateDescription = function(i, val) {
  if (state.entries[i]) state.entries[i].description = val;
};

window.editDescription = function(i) {
  var entry = state.entries[i];
  if (!entry || entry.isSynced) return;
  var titleEl = document.getElementById('entry-title-' + i);
  if (!titleEl) return;
  var wrap = document.getElementById('entry-title-wrap-' + i);
  var currentVal = entry.description !== undefined ? entry.description : entry.summary;
  var input = document.createElement('input');
  input.type = 'text';
  input.value = currentVal;
  input.style.cssText = 'font-weight:600;font-size:0.875rem;color:var(--ink);font-family:DM Sans,sans-serif;width:100%;padding:0.25rem 0.5rem;border:1px solid var(--gold);border-radius:0.375rem;outline:none;background:var(--card-bg);box-shadow:0 0 0 2px rgba(196,154,82,0.2)';
  function finishEdit() {
    entry.description = input.value;
    var descChanged = entry.description !== entry.summary;
    var h3 = document.createElement('h3');
    h3.id = 'entry-title-' + i;
    h3.className = 'editable-title';
    h3.setAttribute('role', 'button');
    h3.tabIndex = 0;
    h3.onclick = function() { editDescription(i); };
    h3.onkeydown = function(event) { handleEditableTitleKey(event); };
    h3.style.cssText = 'font-weight:600;font-size:0.875rem;color:var(--ink);cursor:text;border-bottom:1px dashed ' + (descChanged ? 'var(--gold)' : 'transparent');
    h3.title = 'Klicken zum Bearbeiten der Beschreibung';
    h3.textContent = input.value;
    input.replaceWith(h3);
    if(window.workflowChanged) workflowChanged();
  }
  input.addEventListener('blur', finishEdit);
  input.addEventListener('keydown', function(e) { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = currentVal; input.blur(); } });
  titleEl.replaceWith(input);
  input.focus();
  input.select();
};

window.handleSync = async function() {
  const toSync = state.entries.filter(e => e.isSelected && !e.isSynced && e.projectId && e.taskId);
  if (toSync.length === 0) return;
  state.syncing = true; state.syncResult = null;
  var syncBtn = document.getElementById('sync-bar-btn');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.style.background = 'var(--navy-800)'; syncBtn.style.color = 'var(--navy-400)'; syncBtn.style.cursor = 'not-allowed';
    syncBtn.innerHTML = '<span class="flex items-center gap-2"><svg class="anim-spin" style="width:1rem;height:1rem" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>Synchronisiere...</span>';
  }
  let success = 0, failed = 0;
  const s = state.settings;
  for (const entry of toSync) {
    try {
      const res = await apiPost('/moco/activities?subdomain='+encodeURIComponent(s.mocoSubdomain)+'&apiKey='+encodeURIComponent(s.mocoApiKey)+'&userId='+s.mocoUserId, {
        date: formatDate(state.currentDate), project_id: entry.projectId, task_id: entry.taskId,
        seconds: entry.totalMinutes * 60, description: entry.description !== undefined ? entry.description : entry.summary,
      });
      if (res.ok && res.data && res.data.id) {
        success++; entry.isSynced = true; entry.isSelected = false; getHiddenKeys().delete(entry.key);
        rememberSyncedActivity(formatDate(state.currentDate), entry.key, res.data.id);
      }
      else { failed++; console.error('Sync fehlgeschlagen:', JSON.stringify(res.data)); }
    } catch(e) { failed++; console.error('Sync Fehler:', e); }
  }
  state.syncing = false; state.syncResult = { success, failed };
  if (success > 0) setTimeout(() => fetchDashboardData(true), 1500);
  else render();
};

function resolveProject(projectId, taskId) {
  const p = state.projects.find(x => x.id === projectId);
  if (!p) return null;
  const t = (p.tasks || []).find(x => x.id === taskId);
  if (!t) return null;
  return {
    projectId, taskId, projectName: p.name, taskName: t.name,
    customerName: (p.customer && p.customer.name) || '',
  };
}

function applyMappingToEntry(entry, mapping, source) {
  if (mapping) {
    entry.projectId = mapping.projectId;
    entry.taskId = mapping.taskId;
    entry.projectName = mapping.projectName;
    entry.taskName = mapping.taskName;
    entry.customerName = mapping.customerName;
    entry.aiSuggested = source === 'ai';
    if (!entry.isSynced && !getHiddenKeys().has(entry.key)) entry.isSelected = true;
  }
  entry.aiPending = false;
}

function updateAiEntryInPlace(entry, index) {
  var projWrap = document.getElementById('proj-wrap-' + index);
  if (projWrap) {
    const hasMapping = entry.projectId && entry.taskId;
    projWrap.innerHTML = entry.aiPending ? '<button class="project-trigger" onclick="toggleProjectDropdown('+index+')" style="opacity:0.7"><span class="flex items-center gap-2" style="color:var(--ink-muted);font-style:italic"><svg class="anim-spin" style="width:0.875rem;height:0.875rem" viewBox="0 0 24 24" fill="none"><circle style="opacity:0.25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path style="opacity:0.75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>KI ordnet zu …</span></button>' : '<button class="'+(hasMapping?'project-trigger':'project-trigger unassigned')+'" onclick="toggleProjectDropdown('+index+')">'+(hasMapping?renderProjectPath(entry.customerName, entry.projectName, entry.taskName):'<span class="truncate flex-1" style="color:var(--gold-dark);font-weight:500">Projekt zuordnen...</span>')+'<svg style="width:1rem;height:1rem;color:var(--ink-faint);transition:transform 0.2s;flex-shrink:0" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5"/></svg></button>';
  }
  var titleWrap = document.getElementById('entry-title-wrap-' + index);
  if (titleWrap) {
    var badge = titleWrap.querySelector('.badge-ai');
    if (entry.aiSuggested && entry.projectId && entry.taskId) {
      if (!badge) titleWrap.insertAdjacentHTML('beforeend', '<span class="badge-ai" title="Mittels KI zugeordnet" style="display:inline-flex;align-items:center;gap:0.25rem;padding:0.125rem 0.5rem;border-radius:0.375rem;background:var(--gold-pill-bg);color:var(--gold-pill-text);font-size:0.6875rem;font-weight:600;letter-spacing:0.05em;text-transform:uppercase">KI</span>');
    } else if (badge) badge.remove();
  }
  var cb = document.getElementById('entry-cb-' + index);
  if (cb) {
    cb.className = entry.isSelected ? 'checkbox checked' : 'checkbox';
    cb.setAttribute('aria-checked', entry.isSelected ? 'true' : 'false');
    cb.innerHTML = entry.isSelected ? '<svg style="width:0.75rem;height:0.75rem;color:var(--cream-50)" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' : '';
  }
}

function updateAlertsInPlace() {
  var alerts = document.getElementById('dashboard-alerts');
  if (!alerts) return;
  alerts.innerHTML = state.aiWarning ? '<div style="margin-bottom:1.5rem;padding:1rem;border-radius:1.25rem;background:var(--warn-bg);border:1px solid var(--warn-border);color:var(--warn-text);font-size:0.875rem" class="anim-fade-in">'+esc(state.aiWarning)+'</div>' : '';
}

async function runAiMatching() {
  const s = state.settings;
  if (!s || !s.aiProvider) return;
  const pending = state.entries.filter(e => e.aiPending);
  if (pending.length === 0) return;

  state.aiWarning = '';

  const payload = {
    provider: s.aiProvider,
    apiKey: s.aiApiKey,
    excludeTerms: s.aiExcludeTerms || '',
    entries: pending.map(e => ({ key: e.key, summary: e.summary })),
    projects: state.projects,
    examples: getMappings().slice(0, 30).map(m => ({
      keyword: m.keyword, projectId: m.projectId, taskId: m.taskId,
    })),
  };

  let matches = null;
  try {
    const r = await apiPost('/ai/match', payload);
    if (r.ok && r.data && Array.isArray(r.data.matches)) {
      matches = r.data.matches;
    } else {
      throw new Error((r.data && r.data.error) || 'Keine Antwort von der KI.');
    }
  } catch (e) {
    console.error('[AI] Fehler:', e.message);
    state.aiWarning = 'KI-Zuordnung fehlgeschlagen (' + e.message + '). Score-basiertes Matching wird verwendet.';
  }

  for (const entry of pending) {
    if (!entry.aiPending) continue; // the user assigned it manually in the meantime
    let mapping = null;
    let source = '';
    if (matches) {
      const m = matches.find(x => x.key === entry.key);
      if (m && m.projectId && m.taskId) {
        mapping = resolveProject(m.projectId, m.taskId);
        if (mapping) source = 'ai';
      }
    }
    if (!mapping) {
      mapping = findMapping(entry.summary) || autoMatchProject(entry.summary);
      source = mapping ? 'fallback' : '';
    }
    applyMappingToEntry(entry, mapping, source);
    updateAiEntryInPlace(entry, state.entries.indexOf(entry));
  }

  updateSyncBarInPlace();
  updateStatsInPlace();
  updateAlertsInPlace();
}

async function fetchDashboardData(soft) {
  if (!soft) { state.dataLoading = true; state.mocoActivities = []; state.syncResult = null; render(); }
  state.error = '';
  state.aiWarning = '';
  const s = state.settings;
  const aiOn = !!(s && s.aiProvider && s.aiApiKey);
  try {
    const dateStr = formatDate(state.currentDate);
    const projectsPromise = state.projects.length === 0
      ? apiGet('/moco/projects?subdomain='+encodeURIComponent(s.mocoSubdomain)+'&apiKey='+encodeURIComponent(s.mocoApiKey)).catch(() => null)
      : Promise.resolve(null);
    const [calData, actData, projData] = await Promise.all([
      apiGet('/calendar?url='+encodeURIComponent(s.icalUrl)+'&date='+dateStr),
      apiGet('/moco/activities?subdomain='+encodeURIComponent(s.mocoSubdomain)+'&apiKey='+encodeURIComponent(s.mocoApiKey)+'&userId='+s.mocoUserId+'&date='+dateStr),
      projectsPromise,
    ]);
    if (Array.isArray(projData)) state.projects = projData;
    if (calData.error) { if (!soft) state.error = 'Kalender-Fehler: ' + calData.error; state.dataLoading = false; render(); return; }
    const events = calData.events || [];
    const activities = Array.isArray(actData) ? actData : [];
    if (!Array.isArray(actData)) {
      console.error('MOCO Aktivitäten-Fehler:', JSON.stringify(actData));
      if (!soft) state.mocoError = actData && actData.error ? actData.error : 'Unbekannter Fehler beim Laden der MOCO-Aktivitäten';
    } else { state.mocoError = null; }
    // Group events
    const prevSynced = soft ? new Set(state.entries.filter(e => e.isSynced).map(e => e.key)) : new Set();
    const groups = new Map();
    for (const ev of events) {
      if (ev.isAllDay) continue;
      if (/\\bpause\\b/i.test(ev.summary)) continue;
      const key = ev.summary.trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(ev);
    }
    const newEntries = Array.from(groups.entries()).map(([key, evts]) => {
      const totalMin = evts.reduce((s,e) => s + e.durationMinutes, 0);
      const summary = evts[0].summary;
      const timeRanges = evts.map(e => formatTime(e.start) + ' – ' + formatTime(e.end));
      const es = summary.toLowerCase().trim();
      const matching = activities.filter(a => activityMatchesEntry(a, summary));
      const isSynced = hasSyncedActivity(dateStr, key, activities) || matching.length > 0 || prevSynced.has(key);
      // With AI enabled, assignment happens later in one batch call. Otherwise: classic matching.
      let mapping = null;
      let aiPending = false;
      if (!isSynced) {
        mapping = findMapping(summary);
        if (!mapping && aiOn) {
          aiPending = true;
        } else if (!mapping) {
          mapping = autoMatchProject(summary);
        }
      }
      return {
        key, summary, events: evts, totalMinutes: totalMin,
        totalHours: Math.round((totalMin / 60) * 100) / 100,
        timeRanges, projectId: mapping?.projectId ?? null, taskId: mapping?.taskId ?? null,
        projectName: mapping?.projectName ?? '', taskName: mapping?.taskName ?? '',
        customerName: mapping?.customerName ?? '', isSynced,
        syncedActivityIds: matching.map(a => a.id),
        isHidden: !isSynced && getHiddenKeys().has(key),
        isSelected: !isSynced && !!(mapping) && !getHiddenKeys().has(key),
        aiPending, aiSuggested: false,
      };
    });
    state.entries = newEntries;
    // Store ALL MOCO activities for the day
    state.mocoActivities = activities;
  } catch(e) { if (!soft) state.error = 'Fehler beim Laden der Daten.'; }
  state.dataLoading = false; render();

  if (aiOn && state.entries.some(e => e.aiPending)) {
    runAiMatching();
  }
}

</script>
<script src="/assets/goco-workflow.js"></script>
<script>
// ─── Init ───
(function init() {
  const stored = getSettings();
  applyTheme(stored.theme || 'system');
  if (stored.onboardingComplete) {
    state.settings = stored;
    state.page = 'dashboard';
    render();
    fetchDashboardData();
  } else {
    state.page = 'onboarding';
    render();
  }
})();
</script>
</body>
</html>`;


// ─── HTTP Server & API Proxy ───

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // Local release fixture. It is reachable only when explicitly enabled for
  // the isolated foreground test server and never contacts Google, MOCO or AI.
  if (testFixtures && pathname === '/api/test/counters') {
    res.writeHead(200, {'Content-Type':'application/json','Cache-Control':'no-store'});
    res.end(JSON.stringify(testCounters)); return;
  }
  if (testFixtures && pathname === '/api/calendar') {
    const input=await readBody(req);testCounters.calendar++;
    const date=input.date, start=new Date(date+'T09:00:00'), end=new Date(date+'T09:30:00');
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({events:[{uid:'fixture-1',summary:'Zeiterfassung',description:'',start:start.toISOString(),end:end.toISOString(),isAllDay:false,durationMinutes:30}]}));return;
  }
  if (testFixtures && pathname.startsWith('/api/moco/')) {
    const route=pathname.slice('/api/moco/'.length),date=url.searchParams.get('date')||new Date().toISOString().slice(0,10);
    const tasks=[['Allgemeine Besprechungen',201],['Zeiterfassung',202],['Projektplanung',203],['E-Mails / Telefon',204]].map(([name,id])=>({id,name,active:true}));
    let data;
    if(route==='session'){if(req.headers['x-moco-user']){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture: Session darf noch keinen Zielnutzer impersonieren.'}));return;}data={valid:true,user:{id:7,firstname:'Test',lastname:'Nutzer'}};}
    else if(route==='users')data=[{id:7,firstname:'Test',lastname:'Nutzer',email:'test@example.invalid'}];
    else if(route==='projects'){testCounters.projects++;data=[{id:100,name:'Beispielprojekt',identifier:'DEMO-26-001',active:true,customer:{name:'Beispiel GmbH'},tasks}];}
    else if(route==='activities'){testCounters.mocoReads++;data=[];}
    else if(route==='status')data=[];
    else if(route==='commit'){testCounters.commits++;data={status:'changed',needsReview:true,confirmed:[],activities:[],plan:{items:[]}};}
    else {res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture-Route fehlt.'}));return;}
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));return;
  }
  if (testFixtures && pathname === '/api/ai/match') {testCounters.ai++;res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({matches:[]}));return;}

  // Serve the app
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
    res.end(APP_HTML);
    return;
  }
  if (['/assets/goco-sync-core.js','/assets/goco-workflow.js'].includes(pathname)) {
    res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(require('fs').readFileSync(path.join(__dirname, pathname.split('/').pop()), 'utf8'));
    return;
  }

  // API: Clear ICS cache
  if (pathname === '/api/cache/clear') {
    icsCache = { url: null, text: null, time: 0 };
    parsedCalendarCache.clear();
    console.log('  [Cache] ICS cache cleared');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // API: Calendar proxy
  if (pathname === '/api/calendar') {
    let input; try { input = await readBody(req); } catch { res.writeHead(400); res.end('{}'); return; }
    const icalUrl = input.url;
    const dateStr = input.date;
    if (!icalUrl || !dateStr) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing url or date parameter' }));
      return;
    }

    try {
      // Use cached ICS if available and fresh
      let icsText;
      const now = Date.now();
      const rawCacheFresh = icsCache.url === icalUrl && icsCache.text && (now - icsCache.time) < ICS_CACHE_TTL;
      const parsedCacheKey = icalUrl + '|' + dateStr;
      if (rawCacheFresh && parsedCalendarCache.has(parsedCacheKey)) {
        const events = parsedCalendarCache.get(parsedCacheKey);
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-GOCO-Calendar-Cache': 'hit' });
        res.end(JSON.stringify({ events }));
        return;
      }
      if (rawCacheFresh) {
        icsText = icsCache.text;
        console.log(`  [Calendar] Using cached ICS (${Math.round(icsText.length/1024)}KB, ${Math.round((now - icsCache.time)/1000)}s old)`);
      } else {
        console.log(`  [Calendar] Fetching ICS from Google...`);
        icsText = await fetchUrl(icalUrl);
        icsCache = { url: icalUrl, text: icsText, time: now };
        parsedCalendarCache.clear();
        console.log(`  [Calendar] Fetched ${Math.round(icsText.length/1024)}KB`);
      }
      const events = parseICS(icsText, dateStr);
      parsedCalendarCache.set(parsedCacheKey, events);
      console.log(`  [Calendar] ${dateStr}: ${events.length} events found`);
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-GOCO-Calendar-Cache': 'miss' });
      res.end(JSON.stringify({ events }));
    } catch (e) {
      console.error(`  [Calendar] Error:`, e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Authenticated local proxy. Credentials never appear in request URLs.
  if (pathname.startsWith('/api/moco/')) {
    const route=pathname.slice('/api/moco/'.length);
    try {
      const account=String(req.headers['x-moco-account']||''), userId=req.headers['x-moco-user'];
      const adapter=createMocoAdapter({account,apiKey:req.headers['x-moco-key'],userId,authenticatedUserId:req.headers['x-moco-auth-user']});
      const cacheKey=account+'|'+userId;
      const getProjects=async(force=false)=>{const old=projectCache.get(cacheKey);if(!force&&old&&Date.now()-old.at<900000)return old.data;const data=await adapter.projects();projectCache.set(cacheKey,{at:Date.now(),data});return data;};
      let result;
      if(route==='session')result={valid:true,user:await adapter.session()};
      else if(route==='users')result=await adapter.users();
      else if(route==='projects')result=await getProjects(url.searchParams.get('refresh')==='1');
      else if(route==='activities'&&req.method==='GET'){
        const ctx={account,userId,date:url.searchParams.get('date')};
        if(!/^\d{4}-\d{2}-\d{2}$/.test(ctx.date)||!userId)throw Object.assign(new Error('Datum oder Nutzer fehlt.'),{status:400});
        result=await adapter.read(ctx);
      } else if(route==='commit'&&req.method==='POST'){
        const args=await readBody(req);
        if(args.ctx?.account!==account||String(args.ctx?.userId)!==String(userId)||!args.planningInputs)throw Object.assign(new Error('Buchungskontext stimmt nicht überein.'),{status:400});
        // Only calendar entries are accepted, including when an old payload is supplied.
        if(!Array.isArray(args.items)||args.items.some(item=>item.kind!=='calendar'))throw Object.assign(new Error('Es werden ausschließlich Kalendereinträge gebucht.'),{status:400});
        result=await syncService.commit(args,{...adapter,projects:()=>getProjects()});
      } else if(route==='status')result=syncService.status({account,userId,date:url.searchParams.get('date')});
      else throw Object.assign(new Error('Route nicht verfügbar.'),{status:404});
      res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(result));
    } catch(e){res.writeHead(e.status||503,{'Content-Type':'application/json',...(e.retryAfter?{'Retry-After':e.retryAfter}:{})});res.end(JSON.stringify({error:e.message}));}
    return;
  }

  // API: AI matching proxy (OpenAI)
  if (pathname === '/api/ai/match' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const { provider, apiKey, entries, projects, examples } = body || {};
      if (!provider || !apiKey || !Array.isArray(entries) || !Array.isArray(projects)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing required fields' }));
        return;
      }
      if (provider !== 'openai') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unsupported AI provider: ' + provider }));
        return;
      }
      if (entries.length === 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ matches: [] }));
        return;
      }

      const excludeTerms = parseExcludeTerms(body.excludeTerms);
      const { taskLines, allowedPairs, exampleLines } = buildAiCandidates(projects, examples, excludeTerms);
      const systemText = buildAiSystemText(taskLines, exampleLines, excludeTerms.length > 0);

      const userText = 'Ordne diese Einträge zu (gib für jeden key projectId+taskId oder null zurück):\n' +
        entries.map(e => `key="${e.key}" summary="${e.summary}"`).join('\n');

      const matches = await callOpenAI(apiKey, systemText, userText, entries, allowedPairs);

      console.log(`[AI] openai: ${entries.length} entries → ${matches.filter(m => m.projectId).length} matches`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ matches }));
    } catch (e) {
      console.error('[AI ERROR]', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// ─── AI candidate selection ───

// Parses the setting "exclude projects from AI matching whose name contains …".
// Input: comma-separated string (or array). Output: unique, lower-cased, non-empty terms.
function parseExcludeTerms(raw) {
  const list = Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(',');
  return [...new Set(list.map(t => String(t).trim().toLowerCase()).filter(Boolean))].slice(0, 50);
}

function isExcludedProject(project, excludeTerms) {
  const name = String((project && project.name) || '').toLowerCase();
  return excludeTerms.some(term => name.includes(term));
}

// Builds everything the model may see: candidate lines, the allow-list of
// project/task pairs (enforced again in normalizeMatches) and few-shot examples.
// Excluded projects appear in none of them.
function buildAiCandidates(projects, examples, excludeTerms = []) {
  const taskLines = [];
  const allowedPairs = new Set();
  const blockedProjectIds = new Set();
  for (const p of projects) {
    if (isExcludedProject(p, excludeTerms)) {
      blockedProjectIds.add(Number(p.id));
      continue;
    }
    const customer = p.customer && p.customer.name ? p.customer.name : '';
    for (const t of (p.tasks || [])) {
      if (t.active === false) continue;
      allowedPairs.add(`${Number(p.id)}:${Number(t.id)}`);
      taskLines.push(`projectId=${p.id} taskId=${t.id} | ${customer ? customer + ' / ' : ''}${p.name} → ${t.name}`);
    }
  }
  const exampleLines = (examples || [])
    .filter(e => !blockedProjectIds.has(Number(e.projectId)))
    .slice(0, 30)
    .map(e => `"${e.keyword}" → projectId=${e.projectId} taskId=${e.taskId}`);
  return { taskLines, allowedPairs, blockedProjectIds, exampleLines };
}

// The prompt stays German on purpose: calendar titles and project names are German.
// The excluded terms themselves are never sent to the model.
function buildAiSystemText(taskLines, exampleLines, hasExclusions) {
  return [
    'Du bist ein präziser Klassifikator für Zeiterfassung. Ordne jeden Kalendereintrag der passenden Projekt+Task-Kombination aus der unten gegebenen Liste zu.',
    '',
    'WICHTIGE REGELN (in dieser Reihenfolge prüfen):',
    '',
    ...(hasExclusions ? [
      '0) AUSGESCHLOSSENE PROJEKTE:',
      '   Der Nutzer hat bestimmte Projekte bewusst von der KI-Zuordnung ausgeschlossen. Sie sind absichtlich nicht in der Kandidatenliste. Wähle ausschließlich Kombinationen aus der Liste.',
      '',
    ] : []),
    '1) PROJEKT VOR TASK:',
    '   Wenn der Kalendertitel einen Projekt-, Kunden- oder Markennamen enthält (z. B. "Alpha > Website", "Beispiel GmbH Newsletter", "Acme: Konzept"), wähle IMMER ein Task aus genau DIESEM Projekt.',
    '   Greife NIE auf ein anderes Projekt zurück, nur weil dort ein ähnlich benannter Task existiert.',
    '   Beispiel falsch: "Alpha > Website-Design" → Beta-Projekt, weil dort ein "Design"-Task existiert.',
    '   Beispiel richtig: "Alpha > Website-Design" → Alpha-Projekt, Task der am besten zu "Website-Design" passt.',
    '',
    '2) TASK INNERHALB DES KORREKTEN PROJEKTS:',
    '   Sobald das Projekt feststeht, wähle den Task, dessen Name am besten zum Rest des Titels passt. Bei Mehrdeutigkeit innerhalb des Projekts den allgemeinsten passenden Task wählen.',
    '',
    '3) KEIN PROJEKT-INDIKATOR IM TITEL:',
    '   Nur wenn der Titel keinen erkennbaren Projekt-/Kundenbezug hat, anhand semantischer Ähnlichkeit zur gesamten Liste wählen.',
    '',
    '4) BEI UNSICHERHEIT NULL:',
    '   Wenn keine Kombination wirklich passt, gib projectId UND taskId beide als null zurück. Ein falscher Match ist schlimmer als kein Match.',
    '',
    '5) FRÜHERE ZUORDNUNGEN:',
    '   Die Beispiele unten zeigen, wie der Nutzer in der Vergangenheit zugeordnet hat. Folge dem Muster bei identischen oder sehr ähnlichen Titeln.',
    '   ABER: Regel 1 (Projekt vor Task) hat Vorrang vor Beispielen, falls der Titel einen klaren neuen Projektbezug hat.',
    '',
    'confidence:',
    '- "high": Projekt eindeutig im Titel + passender Task vorhanden',
    '- "medium": Projekt klar, Task plausibel',
    '- "low": Vermutung',
    '',
    'Verfügbare Projekt/Task-Kombinationen (Format: projectId=X taskId=Y | Kunde / Projekt → Task):',
    ...taskLines,
    '',
    exampleLines.length ? 'Frühere Zuordnungen des Nutzers (Beispiele):' : 'Keine vorherigen Zuordnungen.',
    ...exampleLines,
  ].join('\n');
}

// ─── OpenAI Matching ───

const OPENAI_MODEL = 'gpt-6-luna';
const OPENAI_API_URL = process.env.OPENAI_API_URL || 'https://api.openai.com/v1/responses';

async function callOpenAI(apiKey, systemText, userText, entries, allowedPairs) {
  const reqBody = {
    model: OPENAI_MODEL,
    store: false,
    reasoning: { effort: 'low' },
    input: [
      { role: 'system', content: systemText },
      { role: 'user', content: userText },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'goco_project_matches',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  key: { type: 'string' },
                  projectId: { type: ['integer', 'null'] },
                  taskId: { type: ['integer', 'null'] },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                },
                required: ['key', 'projectId', 'taskId', 'confidence'],
                additionalProperties: false,
              },
            },
          },
          required: ['matches'],
          additionalProperties: false,
        },
      },
    },
  };

  const data = await fetchJson(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify(reqBody),
  });

  if (data.status && data.status !== 'completed') {
    throw new Error('OpenAI-Antwort unvollständig: ' + data.status);
  }
  const text = (data.output || [])
    .filter(item => item && item.type === 'message')
    .flatMap(item => item.content || [])
    .filter(item => item && item.type === 'output_text')
    .map(item => item.text || '')
    .join('');
  if (!text) throw new Error('Unerwartete OpenAI-Antwort: ' + JSON.stringify(data).substring(0, 200));
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('OpenAI JSON parse failed: ' + text.substring(0, 200)); }
  if (!Array.isArray(parsed.matches)) throw new Error('OpenAI lieferte kein matches-Array');
  return normalizeMatches(parsed.matches, entries, allowedPairs);
}

function normalizeMatches(rawMatches, entries, allowedPairs) {
  const byKey = new Map();
  for (const m of rawMatches) {
    if (!m || typeof m.key !== 'string') continue;
    const projectId = (m.projectId === null || m.projectId === undefined) ? null : Number(m.projectId);
    const taskId = (m.taskId === null || m.taskId === undefined) ? null : Number(m.taskId);
    const safeProjectId = Number.isFinite(projectId) ? projectId : null;
    const safeTaskId = Number.isFinite(taskId) ? taskId : null;
    const pairKey = safeProjectId !== null && safeTaskId !== null ? `${safeProjectId}:${safeTaskId}` : null;
    byKey.set(m.key, {
      key: m.key,
      projectId: pairKey && allowedPairs && !allowedPairs.has(pairKey) ? null : safeProjectId,
      taskId: pairKey && allowedPairs && !allowedPairs.has(pairKey) ? null : safeTaskId,
      confidence: ['high', 'medium', 'low'].includes(m.confidence) ? m.confidence : 'low',
    });
  }
  return entries.map(e => byKey.get(e.key) || { key: e.key, projectId: null, taskId: null, confidence: 'low' });
}

// ─── HTTP/HTTPS Fetch Helpers ───

function fetchUrl(urlStr, _redirects = 0) {
  return new Promise((resolve, reject) => {
    if (_redirects > 5) { reject(new Error('Zu viele Weiterleitungen beim Laden des Kalenders')); return; }
    const parsedUrl = new URL(urlStr);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const request = lib.get(urlStr, { headers: { 'User-Agent': 'GOCO/' + APP_VERSION } }, (resp) => {
      if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
        resp.resume(); // consume body to free connection
        fetchUrl(new URL(resp.headers.location, urlStr).toString(), _redirects + 1).then(resolve).catch(reject);
        return;
      }
      if (resp.statusCode >= 400) {
        resp.resume(); // consume and discard
        reject(new Error(`HTTP ${resp.statusCode} beim Laden des Kalenders`));
        return;
      }
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => resolve(data));
      resp.on('error', reject);
    });
    request.setTimeout(UPSTREAM_TIMEOUT_MS, () => request.destroy(new Error('Zeitüberschreitung beim Laden des Kalenders.')));
    request.on('error', reject);
  });
}

function fetchJson(urlStr, options = {}) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(urlStr);
    const lib = parsedUrl.protocol === 'https:' ? https : http;
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const r = lib.request(reqOptions, (resp) => {
      let data = '';
      resp.on('data', chunk => { data += chunk; });
      resp.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (resp.statusCode >= 400) {
            const errMsg = parsed.message || parsed.error || ('HTTP ' + resp.statusCode);
            reject(new Error(errMsg));
          } else { resolve(parsed); }
        }
        catch { reject(new Error('Invalid JSON: ' + data.substring(0, 200))); }
      });
    });
    r.setTimeout(UPSTREAM_TIMEOUT_MS, () => r.destroy(new Error('Zeitüberschreitung beim externen API-Aufruf.')));
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => { data += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}

// ─── ICS Parser with RRULE support (no dependencies) ───

function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function parseRRule(rruleStr) {
  const parts = {};
  rruleStr.replace(/^RRULE:/i, '').split(';').forEach(p => {
    const [k, v] = p.split('=');
    if (k && v) parts[k.toUpperCase()] = v;
  });
  return {
    freq: parts.FREQ || '',
    interval: parseInt(parts.INTERVAL) || 1,
    until: parts.UNTIL ? parseICSDate(parts.UNTIL) : null,
    count: parts.COUNT ? parseInt(parts.COUNT) : null,
    byday: parts.BYDAY ? parts.BYDAY.split(',') : null,
    bymonthday: parts.BYMONTHDAY ? parts.BYMONTHDAY.split(',').map(Number) : null,
  };
}

function rruleOccursOnDate(rrule, dtstart, targetDateStr) {
  const target = new Date(targetDateStr + 'T00:00:00');
  const targetEnd = new Date(targetDateStr + 'T23:59:59.999');
  // Compare date-only (ignore time of day)
  const dtstartDate = new Date(dtstart.getFullYear(), dtstart.getMonth(), dtstart.getDate());
  if (target < dtstartDate) return false;
  if (rrule.until && target > rrule.until) return false;

  const dayNames = ['SU','MO','TU','WE','TH','FR','SA'];
  const targetDay = dayNames[target.getDay()];
  const diffDays = Math.round((target.getTime() - dtstartDate.getTime()) / 86400000);

  switch (rrule.freq) {
    case 'DAILY':
      if (diffDays % rrule.interval !== 0) return false;
      break;
    case 'WEEKLY': {
      const diffWeeks = Math.floor(diffDays / 7);
      if (diffWeeks % rrule.interval !== 0 && rrule.interval > 1) {
        // Check if target is in the same week-block as an occurrence
        const weekStart = diffWeeks - (diffWeeks % rrule.interval);
        const weekEnd = weekStart + rrule.interval;
        if (diffWeeks < weekStart || diffWeeks >= weekEnd) return false;
        if (diffWeeks !== weekStart) return false;
      }
      if (rrule.byday && !rrule.byday.includes(targetDay)) return false;
      if (!rrule.byday) {
        // Default: same weekday as dtstart
        const startDay = dayNames[dtstart.getDay()];
        if (targetDay !== startDay) return false;
      }
      break;
    }
    case 'MONTHLY': {
      const diffMonths = (target.getFullYear() - dtstart.getFullYear()) * 12 + (target.getMonth() - dtstart.getMonth());
      if (diffMonths < 0 || diffMonths % rrule.interval !== 0) return false;
      if (rrule.bymonthday) {
        if (!rrule.bymonthday.includes(target.getDate())) return false;
      } else {
        if (target.getDate() !== dtstart.getDate()) return false;
      }
      break;
    }
    case 'YEARLY': {
      const diffYears = target.getFullYear() - dtstart.getFullYear();
      if (diffYears < 0 || diffYears % rrule.interval !== 0) return false;
      if (target.getMonth() !== dtstart.getMonth() || target.getDate() !== dtstart.getDate()) return false;
      break;
    }
    default:
      return false;
  }

  // COUNT check: iterate occurrences until target to see if count exceeded
  if (rrule.count) {
    let count = 0;
    const maxIter = rrule.count + 1;
    const cursor = new Date(dtstart);
    for (let i = 0; i < 10000 && count < maxIter; i++) {
      if (cursor > targetEnd) break;
      let matches = true;
      if (rrule.freq === 'WEEKLY' && rrule.byday) {
        matches = rrule.byday.includes(dayNames[cursor.getDay()]);
      } else if (rrule.freq === 'MONTHLY' && rrule.bymonthday) {
        matches = rrule.bymonthday.includes(cursor.getDate());
      }
      if (matches) {
        count++;
        if (count > rrule.count) return false;
        if (cursor.getFullYear() === target.getFullYear() && cursor.getMonth() === target.getMonth() && cursor.getDate() === target.getDate()) return true;
      }
      // Advance cursor
      switch (rrule.freq) {
        case 'DAILY': cursor.setDate(cursor.getDate() + rrule.interval); break;
        case 'WEEKLY':
          if (rrule.byday) { cursor.setDate(cursor.getDate() + 1); }
          else { cursor.setDate(cursor.getDate() + 7 * rrule.interval); }
          break;
        case 'MONTHLY': cursor.setMonth(cursor.getMonth() + rrule.interval); break;
        case 'YEARLY': cursor.setFullYear(cursor.getFullYear() + rrule.interval); break;
      }
    }
    return false;
  }

  return true;
}

function parseICS(text, dateStr) {
  const lines = unfoldICS(text);
  const events = [];
  let currentEvent = null;
  const overrides = {}; // RECURRENCE-ID → event data

  const dayStart = new Date(dateStr + 'T00:00:00');
  const dayEnd = new Date(dateStr + 'T23:59:59.999');

  // First pass: collect all VEVENTs
  const allEvents = [];
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      currentEvent = { _exdates: [] };
    } else if (line === 'END:VEVENT') {
      if (currentEvent) allEvents.push(currentEvent);
      currentEvent = null;
    } else if (currentEvent) {
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        let key = line.substring(0, colonIdx);
        const value = line.substring(colonIdx + 1);
        // Strip parameters (e.g. DTSTART;VALUE=DATE:20260227, DTSTART;TZID=Europe/Berlin:...)
        const semiIdx = key.indexOf(';');
        if (semiIdx > 0) key = key.substring(0, semiIdx);
        if (key === 'EXDATE') {
          // EXDATE can have multiple values separated by comma
          value.split(',').forEach(v => {
            const d = parseICSDate(v.trim());
            if (d) currentEvent._exdates.push(localDateKey(d));
          });
        } else {
          currentEvent[key] = value;
        }
      }
    }
  }

  debugLog(`  [ICS] Total VEVENTs in file: ${allEvents.length}`);

  // Separate overrides (events with RECURRENCE-ID) from regular events
  const regularEvents = [];
  const cancelledDates = {}; // UID_date → true for cancelled occurrences
  for (const ev of allEvents) {
    if (ev['RECURRENCE-ID']) {
      const recDate = parseICSDate(ev['RECURRENCE-ID']);
      if (recDate) {
        const key = (ev.UID || '') + '_' + localDateKey(recDate);
        if (ev.STATUS && ev.STATUS.toUpperCase() === 'CANCELLED') {
          cancelledDates[key] = true;
        } else {
          overrides[key] = ev;
        }
      }
    } else if (ev.STATUS && ev.STATUS.toUpperCase() === 'CANCELLED') {
      // Skip cancelled non-recurring events entirely
      continue;
    } else {
      regularEvents.push(ev);
    }
  }

  debugLog(`  [ICS] Regular events: ${regularEvents.length}, Overrides: ${Object.keys(overrides).length}, Cancelled: ${Object.keys(cancelledDates).length}`);

  // Process regular events
  for (const ev of regularEvents) {
    const start = parseICSDate(ev.DTSTART);
    const end = parseICSDate(ev.DTEND || ev.DTSTART);
    if (!start || !end) continue;

    const durationMs = end.getTime() - start.getTime();
    const isAllDay = !ev.DTSTART || !ev.DTSTART.includes('T');
    const uid = ev.UID || Math.random().toString(36).slice(2);
    const summary = (ev.SUMMARY || '').replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\\,/g, ',').trim();
    const description = ev.DESCRIPTION || '';

    if (ev.RRULE) {
      // Recurring event — check if it occurs on dateStr
      const rrule = parseRRule(ev.RRULE);
      const occurs = rruleOccursOnDate(rrule, start, dateStr);

      if (occurs) {
        // Check EXDATE
        if (ev._exdates.includes(dateStr)) {
          debugLog(`  [ICS]   → EXDATE excludes "${summary}" on ${dateStr}`);
          continue;
        }

        // Check for cancelled occurrence
        const cancelKey = uid + '_' + dateStr;
        if (cancelledDates[cancelKey]) {
          debugLog(`  [ICS]   → CANCELLED excludes "${summary}" on ${dateStr}`);
          continue;
        }

        // Check for override
        const overrideKey = uid + '_' + dateStr;
        if (overrides[overrideKey]) {
          const ov = overrides[overrideKey];
          // Skip cancelled overrides
          if (ov.STATUS && ov.STATUS.toUpperCase() === 'CANCELLED') {
            debugLog(`  [ICS]   → Override CANCELLED for "${summary}" on ${dateStr}`);
            continue;
          }
          const ovStart = parseICSDate(ov.DTSTART);
          const ovEnd = parseICSDate(ov.DTEND || ov.DTSTART);
          if (ovStart && ovEnd) {
            // Only add if the override actually falls on this day
            if (ovStart <= dayEnd && ovEnd >= dayStart) {
              events.push({
                uid: uid + '_' + dateStr,
                summary: (ov.SUMMARY || summary).replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\\,/g, ',').trim(),
                description: ov.DESCRIPTION || description,
                start: ovStart.toISOString(),
                end: ovEnd.toISOString(),
                isAllDay: !ov.DTSTART || !ov.DTSTART.includes('T'),
                durationMinutes: Math.round((ovEnd.getTime() - ovStart.getTime()) / 60000),
              });
              debugLog(`  [ICS]   ✓ Override "${ov.SUMMARY || summary}" on ${dateStr}`);
            } else {
              debugLog(`  [ICS]   → Override for "${summary}" moved to different day (${localDateKey(ovStart)})`);
            }
          }
          continue;
        }

        // Create occurrence with same time-of-day as original
        const occStart = new Date(dateStr + 'T00:00:00');
        occStart.setHours(start.getHours(), start.getMinutes(), start.getSeconds());
        const occEnd = new Date(occStart.getTime() + durationMs);

        events.push({
          uid: uid + '_' + dateStr,
          summary, description,
          start: occStart.toISOString(),
          end: occEnd.toISOString(),
          isAllDay,
          durationMinutes: Math.round(durationMs / 60000),
        });
        debugLog(`  [ICS]   ✓ RRULE "${summary}" (${ev.RRULE}) on ${dateStr}`);
      }
    } else {
      // Non-recurring event — simple date range check
      if (start <= dayEnd && end >= dayStart) {
        events.push({
          uid, summary, description,
          start: start.toISOString(),
          end: end.toISOString(),
          isAllDay,
          durationMinutes: Math.round(durationMs / 60000),
        });
        debugLog(`  [ICS]   ✓ Single "${summary}" on ${dateStr}`);
      }
    }
  }

  // Also add any override events that fall on this day but whose parent wasn't matched
  // (e.g., a single occurrence was moved TO this day from another day)
  for (const key of Object.keys(overrides)) {
    const ov = overrides[key];
    if (ov.STATUS && ov.STATUS.toUpperCase() === 'CANCELLED') continue;
    const ovStart = parseICSDate(ov.DTSTART);
    const ovEnd = parseICSDate(ov.DTEND || ov.DTSTART);
    if (ovStart && ovEnd && ovStart <= dayEnd && ovEnd >= dayStart) {
      const alreadyAdded = events.some(e => e.uid === (ov.UID || '') + '_' + dateStr);
      if (!alreadyAdded) {
        events.push({
          uid: (ov.UID || '') + '_' + dateStr,
          summary: (ov.SUMMARY || '').replace(/\\\\n/g, '').replace(/\\n/g, '').replace(/\\,/g, ',').trim(),
          description: ov.DESCRIPTION || '',
          start: ovStart.toISOString(),
          end: ovEnd.toISOString(),
          isAllDay: !ov.DTSTART || !ov.DTSTART.includes('T'),
          durationMinutes: Math.round((ovEnd.getTime() - ovStart.getTime()) / 60000),
        });
        debugLog(`  [ICS]   ✓ Moved-in override "${ov.SUMMARY}" on ${dateStr}`);
      }
    }
  }

  events.sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());
  debugLog(`  [ICS] Result: ${events.length} events for ${dateStr}: ${events.map(e => '"' + e.summary + '"').join(', ')}`);
  return events;
}

function unfoldICS(text) {
  // ICS spec: lines starting with space/tab are continuations
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0);
}

function parseICSDate(str) {
  if (!str) return null;
  // Format: 20260227T090000 or 20260227T090000Z or 20260227
  const clean = str.replace(/[^0-9T]/g, '');
  if (clean.length >= 8) {
    const y = clean.substring(0, 4);
    const m = clean.substring(4, 6);
    const d = clean.substring(6, 8);
    if (clean.length >= 15) {
      const hh = clean.substring(9, 11);
      const mm = clean.substring(11, 13);
      const ss = clean.substring(13, 15);
      if (str.endsWith('Z')) {
        return new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +ss));
      }
      return new Date(+y, +m - 1, +d, +hh, +mm, +ss);
    }
    return new Date(+y, +m - 1, +d);
  }
  return null;
}

// ─── Start ───

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`  [Server] Port ${PORT} ist bereits belegt. Läuft GOCO bereits?`);
  } else {
    console.error('[Server] Fehler:', e.message);
  }
});

if (require.main === module) server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║                                      ║');
  console.log(`  ║   GOCO v${APP_VERSION}                        ║`);
  console.log('  ║   Standalone Server                   ║');
  console.log('  ║                                      ║');
  console.log(`  ║   → http://localhost:${PORT}            ║`);
  console.log('  ║                                      ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
});

module.exports={APP_HTML,server,parseICS,parseExcludeTerms,isExcludedProject,buildAiCandidates,buildAiSystemText,normalizeMatches};
