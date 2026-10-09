'use strict';
// Tests for the booking path with a fake MOCO adapter: no network, temporary journal.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const core = require('../src/goco-sync-core.js');
const { createSyncService, createMocoAdapter, collectPages } = require('../src/goco-sync-server.js');

const ctx = { account: 'demo', userId: 7, date: '2026-03-02' };
const projects = [{ id: 100, active: true, tasks: [{ id: 201, active: true }] }];
const calendarEntry = { uid: 'ev-1', summary: 'Konzept', description: 'Konzept', start: '2026-03-02T09:00:00', totalSeconds: 1800, projectId: 100, taskId: 201, isSelected: true, isHidden: false };

function fakeMoco() {
  const activities = [];
  let nextId = 1, bulkCalls = 0;
  return {
    get bulkCalls() { return bulkCalls; },
    activities,
    adapter: {
      read: async () => activities.map(a => ({ ...a })),
      projects: async () => projects,
      bulk: async items => {
        bulkCalls++;
        return items.map(i => {
          const a = { id: nextId++, date: i.date, user: { id: 7 }, project: { id: i.projectId }, task: { id: i.taskId }, seconds: i.seconds, description: i.description };
          activities.push(a);
          return a;
        });
      },
    },
  };
}
function setup() {
  const journalDir = fs.mkdtempSync(path.join(os.tmpdir(), 'goco-journal-'));
  return { journalDir, service: createSyncService({ journalDir }), moco: fakeMoco() };
}
function previewItems() {
  const planningInputs = { calendarEntries: [calendarEntry], drafts: {}, ledger: {} };
  const reconciled = core.reconcileDay({ ...planningInputs, ctx, activities: [] });
  const plan = core.buildBookingPlan({ ...planningInputs, ctx, entries: reconciled.entries, activities: [], projects });
  return { planningInputs, plan };
}

test('commit books exactly the previewed plan once and journals it', async () => {
  const { journalDir, service, moco } = setup();
  const { planningInputs, plan } = previewItems();
  const result = await service.commit({ ctx, operationId: 'op-1', items: plan.items, planningInputs, previewFingerprint: plan.fingerprint }, moco.adapter);
  assert.equal(result.status, 'confirmed');
  assert.equal(moco.bulkCalls, 1);
  assert.equal(moco.activities.length, 1);
  assert.equal(moco.activities[0].seconds, 1800);
  const journal = JSON.parse(fs.readFileSync(path.join(journalDir, 'sync-journal.json'), 'utf8'));
  assert.equal(journal.operations['op-1'].status, 'confirmed');
});

test('repeating a confirmed operation does not book again', async () => {
  const { service, moco } = setup();
  const { planningInputs, plan } = previewItems();
  const args = { ctx, operationId: 'op-2', items: plan.items, planningInputs, previewFingerprint: plan.fingerprint };
  await service.commit(args, moco.adapter);
  const again = await service.commit(args, moco.adapter);
  assert.equal(again.status, 'confirmed');
  assert.equal(moco.bulkCalls, 1);
  assert.equal(moco.activities.length, 1);
});

test('a plan that changed since the preview is not booked', async () => {
  const { service, moco } = setup();
  const { planningInputs, plan } = previewItems();
  moco.activities.push({ id: 50, date: ctx.date, user: { id: 7 }, project: { id: 100 }, task: { id: 201 }, seconds: 1800, description: 'Konzept' });
  const result = await service.commit({ ctx, operationId: 'op-3', items: plan.items, planningInputs, previewFingerprint: plan.fingerprint }, moco.adapter);
  assert.equal(result.status, 'changed');
  assert.equal(moco.bulkCalls, 0);
});

test('the same operation id with a different payload is rejected', async () => {
  const { service, moco } = setup();
  const { planningInputs, plan } = previewItems();
  await service.commit({ ctx, operationId: 'op-4', items: plan.items, planningInputs, previewFingerprint: plan.fingerprint }, moco.adapter);
  await assert.rejects(
    service.commit({ ctx, operationId: 'op-4', items: [], planningInputs: { ...planningInputs, drafts: { x: {} } }, previewFingerprint: 'other' }, moco.adapter),
    /Operation-ID mit anderem Payload/,
  );
});

test('invalid booking context is rejected before anything is sent', async () => {
  const { service, moco } = setup();
  await assert.rejects(service.commit({ ctx: { ...ctx, date: '02.03.2026' }, operationId: 'op-5', items: [] }, moco.adapter), /Ungültiger Buchungskontext/);
  assert.equal(moco.bulkCalls, 0);
});

test('createMocoAdapter validates subdomain, key and user', () => {
  assert.throws(() => createMocoAdapter({ account: 'evil.example.com/', apiKey: 'k' }), /Ungültige MOCO-Subdomain/);
  assert.throws(() => createMocoAdapter({ account: 'demo', apiKey: '' }), /API-Key fehlt/);
  assert.throws(() => createMocoAdapter({ account: 'demo', apiKey: 'k', userId: 'abc', authenticatedUserId: 1 }), /Ungültiger Nutzer/);
  assert.throws(() => createMocoAdapter({ account: 'demo', apiKey: 'k', userId: 5 }), /neu bestätigt/);
  assert.doesNotThrow(() => createMocoAdapter({ account: 'demo', apiKey: 'k', userId: 5, authenticatedUserId: 5 }));
});

test('collectPages follows same-origin pagination and refuses foreign hosts', async () => {
  const pages = {
    'https://demo.mocoapp.com/api/v1/users': { data: [1], next: 'https://demo.mocoapp.com/api/v1/users?page=2' },
    'https://demo.mocoapp.com/api/v1/users?page=2': { data: [2], next: null },
  };
  assert.deepEqual(await collectPages('https://demo.mocoapp.com/api/v1/users', async url => pages[url]), [1, 2]);
  await assert.rejects(
    collectPages('https://demo.mocoapp.com/api/v1/users', async () => ({ data: [1], next: 'https://evil.example/api/v1/users' })),
    /unzulässiger Pagination-Link/,
  );
});
