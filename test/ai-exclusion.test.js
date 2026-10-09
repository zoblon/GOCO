'use strict';
// Tests for the setting "exclude projects from AI matching whose name contains …".
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// The OpenAI endpoint is read once at module load, so point it at a local stub first.
const received = [];
let modelAnswer = [];
const stub = http.createServer((req, res) => {
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    received.push({ headers: req.headers, body: JSON.parse(body) });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ matches: modelAnswer }) }] }] }));
  });
});

let app, appServer, appBase;
test.before(async () => {
  await new Promise(r => stub.listen(0, '127.0.0.1', r));
  process.env.OPENAI_API_URL = `http://127.0.0.1:${stub.address().port}/v1/responses`;
  app = require('../src/goco-standalone.js');
  appServer = app.server;
  await new Promise(r => appServer.listen(0, '127.0.0.1', r));
  appBase = `http://127.0.0.1:${appServer.address().port}`;
});
test.after(() => { appServer.close(); stub.close(); });

const projects = [
  { id: 1, name: 'Website Relaunch', customer: { name: 'Beispiel GmbH' }, tasks: [{ id: 11, name: 'Design' }, { id: 12, name: 'Archiv', active: false }] },
  { id: 2, name: 'Wartungsvertrag 2026', customer: { name: 'Beispiel GmbH' }, tasks: [{ id: 21, name: 'Support' }] },
  { id: 3, name: 'INTERN Verwaltung', tasks: [{ id: 31, name: 'Büro' }] },
];

async function aiMatch(extra = {}) {
  const r = await fetch(appBase + '/api/ai/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ provider: 'openai', apiKey: 'sk-test', entries: [{ key: 'k1', summary: 'Design Review' }], projects, examples: [], ...extra }),
  });
  return { status: r.status, json: await r.json() };
}
const promptOf = call => call.body.input.find(m => m.role === 'system').content;

test('parseExcludeTerms: empty by default', () => {
  assert.deepEqual(app.parseExcludeTerms(undefined), []);
  assert.deepEqual(app.parseExcludeTerms(null), []);
  assert.deepEqual(app.parseExcludeTerms(''), []);
  assert.deepEqual(app.parseExcludeTerms(' , ,, '), []);
});

test('parseExcludeTerms: comma separated, trimmed, lower-cased and de-duplicated', () => {
  assert.deepEqual(app.parseExcludeTerms(' Wartung , INTERN,wartung,'), ['wartung', 'intern']);
  assert.deepEqual(app.parseExcludeTerms(['A', ' b ']), ['a', 'b']);
});

test('isExcludedProject: case-insensitive "name contains"', () => {
  const terms = app.parseExcludeTerms('wartung');
  assert.equal(app.isExcludedProject({ name: 'Wartungsvertrag 2026' }, terms), true);
  assert.equal(app.isExcludedProject({ name: 'Jahres-WARTUNG' }, terms), true);
  assert.equal(app.isExcludedProject({ name: 'Website Relaunch' }, terms), false);
  assert.equal(app.isExcludedProject({ name: 'Wartungsvertrag' }, []), false);
  assert.equal(app.isExcludedProject({}, terms), false);
});

test('nothing is excluded by default: no project name is special-cased', () => {
  const list = [{ id: 9, name: 'Wartungsvertrag Alpha', tasks: [{ id: 91, name: 'Beratung' }] }];
  const { allowedPairs, blockedProjectIds } = app.buildAiCandidates(list, [], app.parseExcludeTerms(''));
  assert.ok(allowedPairs.has('9:91'));
  assert.equal(blockedProjectIds.size, 0);
});

test('buildAiCandidates: excluded projects vanish from candidates, pairs and examples', () => {
  const terms = app.parseExcludeTerms('wartung, intern');
  const c = app.buildAiCandidates(projects, [
    { keyword: 'Support Call', projectId: 2, taskId: 21 },
    { keyword: 'Design Review', projectId: 1, taskId: 11 },
  ], terms);
  assert.deepEqual([...c.allowedPairs], ['1:11']);
  assert.deepEqual([...c.blockedProjectIds].sort(), [2, 3]);
  assert.equal(c.taskLines.length, 1);
  assert.match(c.taskLines[0], /Website Relaunch → Design/);
  assert.deepEqual(c.exampleLines, ['"Design Review" → projectId=1 taskId=11']);
});

test('buildAiCandidates: inactive tasks are never offered', () => {
  const c = app.buildAiCandidates(projects, [], []);
  assert.equal(c.allowedPairs.has('1:12'), false);
  assert.equal(c.allowedPairs.has('1:11'), true);
});

test('buildAiSystemText: the exclusion rule appears only when something is excluded and never leaks the terms', () => {
  const plain = app.buildAiSystemText(['a'], [], false);
  const withRule = app.buildAiSystemText(['a'], [], true);
  assert.doesNotMatch(plain, /AUSGESCHLOSSENE PROJEKTE/);
  assert.match(withRule, /AUSGESCHLOSSENE PROJEKTE/);
  assert.doesNotMatch(withRule, /wartung|intern/i);
});

test('normalizeMatches: pairs outside the allow-list are dropped', () => {
  const allowed = new Set(['1:11']);
  const out = app.normalizeMatches([
    { key: 'a', projectId: 1, taskId: 11, confidence: 'high' },
    { key: 'b', projectId: 2, taskId: 21, confidence: 'high' },
  ], [{ key: 'a' }, { key: 'b' }, { key: 'c' }], allowed);
  assert.deepEqual(out.map(m => [m.key, m.projectId, m.taskId]), [['a', 1, 11], ['b', null, null], ['c', null, null]]);
});

test('POST /api/ai/match without excludeTerms offers every project', async () => {
  received.length = 0; modelAnswer = [{ key: 'k1', projectId: 2, taskId: 21, confidence: 'high' }];
  const { status, json } = await aiMatch();
  assert.equal(status, 200);
  assert.equal(received.length, 1);
  const prompt = promptOf(received[0]);
  assert.match(prompt, /Wartungsvertrag 2026/);
  assert.match(prompt, /INTERN Verwaltung/);
  assert.doesNotMatch(prompt, /AUSGESCHLOSSENE PROJEKTE/);
  assert.equal(json.matches[0].projectId, 2);
});

test('POST /api/ai/match enforces the exclusion on the server, even if the model answers with an excluded pair', async () => {
  received.length = 0; modelAnswer = [{ key: 'k1', projectId: 2, taskId: 21, confidence: 'high' }];
  const { status, json } = await aiMatch({ excludeTerms: ' wartung ,INTERN ' });
  assert.equal(status, 200);
  const prompt = promptOf(received[0]);
  assert.doesNotMatch(prompt, /Wartungsvertrag|INTERN Verwaltung|projectId=2 |projectId=3 /);
  assert.match(prompt, /Website Relaunch/);
  assert.match(prompt, /AUSGESCHLOSSENE PROJEKTE/);
  assert.doesNotMatch(prompt, /wartung ,|INTERN,/);
  assert.deepEqual(json.matches, [{ key: 'k1', projectId: null, taskId: null, confidence: 'high' }]);
});

test('POST /api/ai/match drops few-shot examples that point to excluded projects', async () => {
  received.length = 0; modelAnswer = [{ key: 'k1', projectId: 1, taskId: 11, confidence: 'high' }];
  const { json } = await aiMatch({
    excludeTerms: 'wartung',
    examples: [{ keyword: 'Support Call', projectId: 2, taskId: 21 }, { keyword: 'Design Review', projectId: 1, taskId: 11 }],
  });
  const prompt = promptOf(received[0]);
  assert.doesNotMatch(prompt, /Support Call/);
  assert.match(prompt, /"Design Review" → projectId=1 taskId=11/);
  assert.equal(json.matches[0].projectId, 1);
});

test('POST /api/ai/match never sends the exclusion terms to OpenAI', async () => {
  received.length = 0; modelAnswer = [];
  await aiMatch({ excludeTerms: 'geheimbegriff' });
  assert.doesNotMatch(JSON.stringify(received[0].body), /geheimbegriff/);
});
