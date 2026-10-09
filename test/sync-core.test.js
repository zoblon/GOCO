'use strict';
// Tests for the pure reconciliation and booking-plan logic shared by browser and server.
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/goco-sync-core.js');

const ctx = { account: 'demo', userId: 7, date: '2026-03-02' };

function entry(over = {}) {
  return {
    uid: 'ev-1', summary: 'Konzept', description: 'Konzept', start: '2026-03-02T09:00:00',
    totalSeconds: 1800, projectId: 100, taskId: 201, isSelected: true, isHidden: false, ...over,
  };
}
function activity(over = {}) {
  return {
    id: 1, date: ctx.date, user: { id: 7 }, project: { id: 100 }, task: { id: 201 },
    seconds: 1800, description: 'Konzept', ...over,
  };
}
const projects = [{ id: 100, active: true, tasks: [{ id: 201, active: true }, { id: 202, active: false }] }];
const reconcile = (calendarEntries, activities = [], extra = {}) => core.reconcileDay({ ctx, calendarEntries, activities, ...extra });
const plan = (entries, activities = [], p = projects) => core.buildBookingPlan({ ctx, entries, activities, projects: p });

test('norm trims, lower-cases and collapses whitespace', () => {
  assert.equal(core.norm('  Hallo   WELT \n'), 'hallo welt');
  assert.equal(core.norm(null), '');
});

test('secondsOf accepts worked_seconds, seconds and hours, rejects garbage', () => {
  assert.equal(core.secondsOf({ worked_seconds: 90 }), 90);
  assert.equal(core.secondsOf({ seconds: 61.4 }), 61);
  assert.equal(core.secondsOf({ hours: 1.5 }), 5400);
  assert.equal(core.secondsOf({ seconds: -5 }), 0);
  assert.equal(core.secondsOf({}), 0);
});

test('stableSourceKey prefers uid and occurrence and is stable', () => {
  const e = { calendarId: 'c1', uid: 'abc', start: '2026-03-02T09:00:00', end: '2026-03-02T09:30:00' };
  assert.equal(core.stableSourceKey(e), 'c1|abc|2026-03-02T09:00:00');
  assert.equal(core.stableSourceKey({ summary: ' Konzept ', start: 'S', end: 'E' }), 'default|konzept|S|E');
});

test('reconcileDay: nothing in MOCO leaves the whole entry open', () => {
  const r = reconcile([entry()]);
  assert.equal(r.entries.length, 1);
  assert.equal(r.entries[0].remainingSeconds, 1800);
  assert.equal(r.entries[0].isSynced, false);
  assert.equal(r.entries[0].conflict, null);
  assert.deepEqual(r.allocations, []);
});

test('reconcileDay: exact MOCO match marks the entry as synced and records an allocation', () => {
  const r = reconcile([entry()], [activity()]);
  const e = r.entries[0];
  assert.equal(e.isSynced, true);
  assert.equal(e.remainingSeconds, 0);
  assert.equal(r.allocations.length, 1);
  assert.equal(r.allocations[0].activityId, 1);
  assert.equal(r.allocations[0].seconds, 1800);
});

test('reconcileDay: exact match ignores case and whitespace in the description', () => {
  const r = reconcile([entry()], [activity({ description: '  konzept ' })]);
  assert.equal(r.entries[0].isSynced, true);
});

test('reconcileDay: activities of other users or other days are ignored', () => {
  const r = reconcile([entry()], [activity({ user: { id: 8 } }), activity({ id: 2, date: '2026-03-03' })]);
  assert.equal(r.entries[0].isSynced, false);
  assert.equal(r.entries[0].conflict, null);
});

test('reconcileDay: one MOCO activity is never credited to two identical entries', () => {
  const a = entry({ uid: 'a', start: '2026-03-02T09:00:00' });
  const b = entry({ uid: 'b', start: '2026-03-02T10:00:00' });
  const r = reconcile([a, b], [activity()]);
  const synced = r.entries.filter(e => e.isSynced);
  assert.equal(synced.length, 1);
  assert.equal(synced[0].uid, 'a');
  assert.equal(r.entries.find(e => e.uid === 'b').isSynced, false);
});

test('reconcileDay: several equally good MOCO activities are a conflict', () => {
  const r = reconcile([entry()], [activity({ id: 1 }), activity({ id: 2 })]);
  assert.match(r.entries[0].conflict, /Mehrere passende MOCO-Buchungen/);
  assert.equal(r.conflicts.length, 1);
});

test('reconcileDay: other time on the same project/task asks before crediting or adding', () => {
  const other = activity({ description: 'Etwas anderes', seconds: 3600 });
  const r = reconcile([entry()], [other]);
  assert.equal(r.entries[0].conflict, 'Möglicherweise bereits enthalten');
  assert.equal(r.entries[0].isSynced, false);
});

test('reconcileDay: decision "credit" uses existing time, "additional" books everything', () => {
  const other = activity({ description: 'Etwas anderes', seconds: 3600 });
  const credit = reconcile([entry({ decision: 'credit' })], [other]).entries[0];
  assert.equal(credit.conflict, null);
  assert.equal(credit.coveredSeconds, 1800);
  assert.equal(credit.isSynced, true);
  const additional = reconcile([entry({ decision: 'additional' })], [other]).entries[0];
  assert.equal(additional.conflict, null);
  assert.equal(additional.remainingSeconds, 1800);
  assert.equal(additional.isSynced, false);
});

test('reconcileDay: unselected or hidden entries never raise the "possibly included" conflict', () => {
  const other = activity({ description: 'Etwas anderes', seconds: 3600 });
  assert.equal(reconcile([entry({ isSelected: false })], [other]).entries[0].conflict, null);
  assert.equal(reconcile([entry({ isHidden: true })], [other]).entries[0].conflict, null);
});

test('reconcileDay: a running MOCO timer on the same project/task blocks the entry', () => {
  const r = reconcile([entry()], [activity({ id: 5, description: 'x', seconds: 0, timer_started_at: '2026-03-02T08:00:00Z' })]);
  assert.match(r.entries[0].conflict, /Laufender Timer/);
});

test('reconcileDay: drafts override the calendar entry by sourceKey', () => {
  const raw = entry({ projectId: null, taskId: null, isSelected: false });
  const sourceKey = core.stableSourceKey(raw);
  const r = reconcile([raw], [], { drafts: { [sourceKey]: { projectId: 100, taskId: 201, isSelected: true, description: 'Angepasst' } } });
  const e = r.entries[0];
  assert.equal(e.projectId, 100);
  assert.equal(e.isSelected, true);
  assert.equal(e.description, 'Angepasst');
});

test('reconcileDay: a ledger record that still matches MOCO keeps the entry synced', () => {
  const e0 = entry();
  const r0 = reconcile([e0], [activity()]);
  const sourceKey = r0.entries[0].sourceKey;
  const ledger = { entries: [{ ...ctx, kind: 'calendar', sourceKey, projectId: 100, taskId: 201, seconds: 1800, description: 'Konzept', activityId: 1, sourceFingerprint: core.sourceSignature(r0.entries[0]) }] };
  const r = reconcile([e0], [activity()], { ledger });
  assert.equal(r.entries[0].isSynced, true);
  assert.equal(r.entries[0].conflict, null);
});

test('reconcileDay: a ledger record whose MOCO activity was deleted or changed is a conflict', () => {
  const e0 = entry();
  const sourceKey = reconcile([e0]).entries[0].sourceKey;
  const record = { ...ctx, kind: 'calendar', sourceKey, projectId: 100, taskId: 201, seconds: 1800, description: 'Konzept', activityId: 1 };
  const deleted = reconcile([e0], [], { ledger: { entries: [record] } }).entries[0];
  assert.match(deleted.conflict, /geändert\/gelöscht/);
  const changed = reconcile([e0], [activity({ seconds: 900 })], { ledger: { entries: [record] } }).entries[0];
  assert.match(changed.conflict, /geändert\/gelöscht/);
});

test('reconcileDay: calendar duration shorter than already booked time is a conflict', () => {
  const e0 = entry();
  const r0 = reconcile([e0], [activity()]);
  const sourceKey = r0.entries[0].sourceKey;
  const ledger = { entries: [{ ...ctx, kind: 'calendar', sourceKey, projectId: 100, taskId: 201, seconds: 1800, description: 'Konzept', activityId: 1, sourceFingerprint: core.sourceSignature({ ...r0.entries[0], totalSeconds: 600 }) }] };
  const r = reconcile([entry({ totalSeconds: 600 })], [activity()], { ledger });
  assert.ok(r.entries[0].conflict);
});

test('buildBookingPlan: plans selected, unsynced, fully assigned entries', () => {
  const entries = reconcile([entry()]).entries;
  const p = plan(entries);
  assert.equal(p.items.length, 1);
  assert.deepEqual(p.items[0], { sourceKey: entries[0].sourceKey, kind: 'calendar', date: ctx.date, projectId: 100, taskId: 201, seconds: 1800, description: 'Konzept' });
  assert.equal(p.totalSeconds, 1800);
  assert.equal(p.fingerprint, JSON.stringify(p.items));
  assert.deepEqual(p.conflicts, []);
});

test('buildBookingPlan: synced, unselected and hidden entries produce no items', () => {
  const synced = reconcile([entry()], [activity()]).entries;
  assert.equal(plan(synced, [activity()]).items.length, 0);
  assert.equal(plan(reconcile([entry({ isSelected: false })]).entries).items.length, 0);
  assert.equal(plan(reconcile([entry({ isHidden: true })]).entries).items.length, 0);
});

test('buildBookingPlan: only the remaining seconds of a partly covered entry are planned', () => {
  const entries = reconcile([entry({ totalSeconds: 3600, decision: 'credit' })], [activity({ description: 'Etwas anderes', seconds: 1200 })]).entries;
  const p = plan(entries, [activity({ description: 'Etwas anderes', seconds: 1200 })]);
  assert.equal(p.items.length, 1);
  assert.equal(p.items[0].seconds, 2400);
});

test('buildBookingPlan: missing project, missing description and inactive targets become conflicts, not items', () => {
  // With a project list, an unassigned target fails validation first ...
  const missingProject = plan(reconcile([entry({ projectId: null, taskId: null })]).entries);
  assert.equal(missingProject.items.length, 0);
  assert.match(missingProject.conflicts[0].reason, /nicht mehr aktiv/);
  // ... without one, the plain "assign a project" hint is reported.
  const unassigned = core.buildBookingPlan({ ctx, entries: reconcile([entry({ projectId: null, taskId: null })]).entries, activities: [] });
  assert.equal(unassigned.conflicts[0].reason, 'Projekt zuordnen.');

  const noDescription = plan(reconcile([entry({ description: '   ' })]).entries);
  assert.equal(noDescription.items.length, 0);
  assert.equal(noDescription.conflicts[0].reason, 'Kalenderbeschreibung fehlt.');

  const inactiveTask = plan(reconcile([entry({ taskId: 202 })]).entries);
  assert.equal(inactiveTask.items.length, 0);
  assert.match(inactiveTask.conflicts[0].reason, /nicht mehr aktiv/);

  const inactiveProject = plan(reconcile([entry()]).entries, [], [{ ...projects[0], active: false }]);
  assert.equal(inactiveProject.items.length, 0);
});

test('buildBookingPlan: a running timer blocks the whole project/task pair', () => {
  const timer = activity({ id: 9, description: 'Timer', seconds: 0, timer_started_at: '2026-03-02T08:00:00Z' });
  const entries = reconcile([entry()], [timer]).entries;
  const p = plan(entries, [timer]);
  assert.equal(p.items.length, 0);
  assert.ok(p.conflicts.length >= 1);
});

test('buildBookingPlan: only plans calendar items, even when legacy inputs mention daily minimums', () => {
  const entries = reconcile([entry()]).entries;
  const p = core.buildBookingPlan({ ctx, entries, activities: [], projects, dailyMinimums: [{ projectId: 100, taskId: 201, minimumSeconds: 28800, description: 'x' }], minimumsEnabled: true });
  assert.ok(p.items.every(i => i.kind === 'calendar'));
  assert.equal(p.totalSeconds, 1800);
  assert.equal('minimumRows' in p, false);
});

test('buildBookingPlan: without a project list no target validation is applied', () => {
  const p = core.buildBookingPlan({ ctx, entries: reconcile([entry()]).entries, activities: [] });
  assert.equal(p.items.length, 1);
});
