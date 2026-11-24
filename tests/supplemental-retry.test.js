import test from 'node:test';
import assert from 'node:assert/strict';
import {Context} from '@deepseek-ai/cordis';
import {SessionRetrySettings, installSupplementalRetry} from '../supplemental-retry.js';

const gateway = {code: 'PI_AI_ERROR', message: 'gateway_concurrency_limit: Concurrency limit exceeded for account, please retry later'};
const terminated = {code: 'TRANSPORT', message: 'terminated'};
const sessionA = {id: 'session-a'};
const sessionB = {id: 'session-b'};

// A manual clock: each scheduled wait exposes its signal and resolves on demand.
function manualWait() {
  const waits = [];
  const wait = (ms, _value, {signal}) => new Promise((resolve, reject) => {
    const entry = {ms, signal, resolve: () => resolve()};
    waits.push(entry);
    signal.addEventListener('abort', () => reject(signal.reason), {once: true});
  });
  return {wait, waits};
}

async function fixture({wait, native = () => undefined, nativeFirst = true, feature = true} = {}) {
  const persisted = {enabledSessionIds: []};
  const writes = [];
  const settings = new SessionRetrySettings({
    get: () => structuredClone(persisted),
    set: async value => {writes.push(value); Object.assign(persisted, structuredClone(value));},
  }, () => feature);
  await settings.set(sessionA.id, true);
  const ctx = new Context();
  if (nativeFirst) ctx.on('agent/request-error', native);
  const fiber = ctx.plugin(retryCtx => installSupplementalRetry(retryCtx, settings, {wait: wait ?? (async () => {})}));
  await fiber.await();
  if (!nativeFirst) ctx.on('agent/request-error', native);
  const records = [];
  // One stable session object per id, as the agent loop holds it across retries.
  const agents = new Map();
  const agent = session => {
    if (!agents.has(session.id)) agents.set(session.id, {
      session: {...session, append(type, data) {records.push({type, ...data});}},
    });
    return agents.get(session.id);
  };
  const controller = new AbortController();
  const run = (data = {}, session = sessionA) => ctx.waterfall('agent/request-error', {
    agent: agent(session), provider: 'capinfo', turn: 1, step: 1, failure: gateway, signal: controller.signal, ...data,
  }, () => undefined);
  return {run, records, controller, fiber, settings, writes, persisted, feature: value => {feature = value;}};
}

test('native recovery keeps precedence regardless of order, and only opted-in sessions continue afterwards', async () => {
  for (const nativeFirst of [true, false]) {
    let attempts = 0;
    const f = await fixture({nativeFirst, native: (_event, next) => ++attempts <= 2 ? {kind: 'retry'} : next()});
    for (let i = 0; i < 2; i++) assert.deepEqual(await f.run({failure: terminated}), {kind: 'retry'});
    assert.equal(f.records.length, 0);
    assert.equal(await f.run({failure: terminated}, sessionB), undefined, 'other sessions fail as before');
    assert.deepEqual(await f.run({failure: terminated}), {kind: 'retry'}, 'opted-in session starts its chain');
    assert.equal(attempts, 4);
  }
});

test('an opted-in session retries without a limit: 5, 10, 20 seconds, then every 30 seconds', async () => {
  const {wait, waits} = manualWait();
  const f = await fixture({wait});
  const pending = [];
  for (let i = 0; i < 7; i++) {
    const run = f.run(i % 2 ? {failure: terminated} : {});
    await new Promise(resolve => setImmediate(resolve));
    const scheduled = waits.at(-1);
    assert.equal(scheduled.ms, [5000, 10000, 20000, 30000, 30000, 30000, 30000][i]);
    scheduled.resolve();
    pending.push(await run);
  }
  assert.deepEqual(pending, Array(7).fill({kind: 'retry'}));
  const scheduled = f.records.filter(row => row.type === 'llm/retry');
  assert.deepEqual(scheduled.map(row => row.retry), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(scheduled.every(row => row.mode === 'always' && !('maxRetries' in row) && row.policyKey.startsWith('capinfo:')));
  assert.equal(new Set(scheduled.map(row => row.retryId)).size, 1, 'one chain per failed step');
  assert.deepEqual(f.records.map(row => row.type), Array(7).fill(['llm/retry', 'llm/retry-started']).flat());
  // A later step starts a fresh chain with a new id.
  const next = f.run({step: 2});
  await new Promise(resolve => setImmediate(resolve));
  waits.at(-1).resolve();
  assert.deepEqual(await next, {kind: 'retry'});
  assert.equal(f.records.at(-2).retry, 1);
  assert.notEqual(f.records.at(-2).retryId, scheduled[0].retryId);
});

test('the feature switch, session opt-in, provider, and exact transient failure all gate recovery', async () => {
  const f = await fixture();
  f.feature(false);
  assert.equal(await f.run(), undefined);
  assert.equal(f.settings.status(sessionA.id).available, false);
  f.feature(true);
  assert.equal(await f.run({provider: 'other'}), undefined);
  await f.settings.set(sessionA.id, false);
  assert.equal(await f.run(), undefined);
  await f.settings.set(sessionA.id, true);
  for (const failure of [{code: 'RATE_LIMIT', message: '429'}, {code: 'AUTH', message: gateway.message},
    {code: 'PI_AI_ERROR', message: 'unrelated problem: ' + gateway.message},
    {code: 'PI_AI_ERROR', message: 'gateway_concurrency_limit_extra'},
    {code: 'TRANSPORT', message: 'Stream terminated with an unexpected exception'},
    {code: 'TRANSPORT', message: 'network failure'}]) assert.equal(await f.run({failure}), undefined);
  assert.deepEqual(f.records, []);
});

test('cancellation, unload, session opt-out, and feature off all stop a pending retry before it starts', async () => {
  for (const stop of ['cancel', 'unload', 'session-off', 'feature-off']) {
    const {wait, waits} = manualWait();
    const f = await fixture({wait});
    const pending = f.run();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(waits.length, 1);
    if (stop === 'cancel') f.controller.abort();
    if (stop === 'unload') await f.fiber.dispose();
    if (stop === 'session-off') await f.settings.set(sessionA.id, false);
    if (stop === 'feature-off') { f.feature(false); f.settings.featureChanged(); }
    assert.equal(await pending, undefined, stop);
    assert.deepEqual(f.records.map(row => row.type), ['llm/retry'], `${stop}: nothing started`);
    assert.equal(waits[0].signal.aborted, true);
  }
});

test('session opt-ins persist, isolate sessions, and survive a failed write unchanged', async () => {
  const persisted = {enabledSessionIds: ['kept']};
  let fail = false;
  const writes = [];
  const settings = new SessionRetrySettings({
    get: () => structuredClone(persisted),
    set: async value => { if (fail) throw new Error('disk'); writes.push(value); Object.assign(persisted, structuredClone(value)); },
  }, () => true);
  assert.deepEqual([settings.status('kept'), settings.status('other')], [{available: true, enabled: true}, {available: true, enabled: false}]);
  await settings.set('other', true);
  await settings.set('other', true);
  assert.deepEqual(writes, [{enabledSessionIds: ['kept', 'other']}], 'unchanged values are not written');
  fail = true;
  await assert.rejects(settings.set('kept', false), /disk/);
  assert.equal(settings.status('kept').enabled, true, 'memory follows the durable state');
  fail = false;
  await settings.set('kept', false);
  assert.deepEqual(persisted, {enabledSessionIds: ['other']});
  const pending = settings.signal('other');
  await settings.close();
  assert.equal(pending.aborted, true, 'plugin disposal stops every pending wait');
  assert.deepEqual(settings.status('other'), {available: false, enabled: false});
});
