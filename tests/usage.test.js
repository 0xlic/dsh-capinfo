import test from 'node:test';
import assert from 'node:assert/strict';
import {CapinfoUsage, emptyUsage, observeAdapterUsage} from '../usage.js';
import {createCapinfoRuntime} from '../provider-runtime.js';

const fixture = () => {
  let now = Date.parse('2026-11-11T15:59:59Z');
  let saved = emptyUsage(now);
  const store = {get: () => structuredClone(saved), set: async value => {saved = structuredClone(value);}};
  return {store, usage: new CapinfoUsage(store, {now: () => now}), now: () => now, tick: value => {now += value;}};
};
const tokens = {inputTokens: 10, outputTokens: 5, cacheReadTokens: 7, cacheWriteTokens: 2, totalTokens: 24};

test('concurrent accounting persists, survives restart, and resets at Shanghai midnight without a request', async () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.usage.record(tokens);
  await f.usage.tail;
  const restarted = new CapinfoUsage(f.store, {now: f.now});
  assert.equal(restarted.snapshot().totalTokens, 2400);
  assert.equal(restarted.snapshot().requests, 100);
  const copy = restarted.snapshot(); copy.totalTokens = 0;
  assert.equal(restarted.snapshot().totalTokens, 2400);
  f.tick(1000);
  assert.equal(restarted.snapshot().date, '2026-11-12');
  assert.equal(restarted.snapshot().totalTokens, 0);
  assert.equal(restarted.snapshot().updatedAt, null);
  restarted.record(tokens);
  await restarted.close();
  assert.equal(f.store.get().totalTokens, 24);
  restarted.record(tokens);
  assert.equal(restarted.snapshot().requests, 1);
});

test('rejects invalid counts and does not double count cached tokens', async () => {
  const {usage} = fixture();
  for (const value of [NaN, Infinity, -1, 1.5, '3']) usage.record({...tokens, inputTokens: value});
  usage.record(null);
  assert.equal(usage.snapshot().requests, 0);
  usage.record(tokens);
  usage.record({inputTokens: 1, outputTokens: 2});
  assert.equal(usage.snapshot().totalTokens, 27);
  assert.equal(usage.snapshot().cacheReadTokens, 7);
  await usage.close();
});

test('persistence failures retain memory, are reported safely and recover on next write', async () => {
  const f = fixture();
  const set = f.store.set;
  f.store.set = async () => {throw new Error('secret storage detail');};
  f.usage.record(tokens); await f.usage.tail;
  assert.equal(f.usage.snapshot().persistenceError, true);
  assert.equal(f.usage.snapshot().totalTokens, 24);
  f.store.set = set;
  f.usage.record(tokens); await f.usage.close();
  assert.equal(f.usage.snapshot().persistenceError, false);
  assert.equal(f.store.get().totalTokens, 48);
});

const identityA = 'a'.repeat(64), identityB = 'b'.repeat(64);
test('amount baselines preserve precision, survive restart, key changes and counter resets independently of tokens', async () => {
  const f = fixture();
  f.usage.recordAmount(1.3232272, identityA);
  assert.equal(f.usage.snapshot().amount, 0);
  f.usage.record(tokens);
  f.usage.recordAmount(1.4232272, identityA);
  const expected = 1.4232272 - 1.3232272;
  assert.equal(f.usage.snapshot().amount, expected);
  await f.usage.close();
  const restarted = new CapinfoUsage(f.store, {now: f.now});
  restarted.recordAmount(10, identityB);
  restarted.recordAmount(10.25, identityB);
  restarted.recordAmount(2, identityB);
  restarted.recordAmount(2.5, identityB);
  assert.equal(restarted.snapshot().amount, expected + .75);
  assert.equal(restarted.snapshot().totalTokens, 24);
  const serialized = JSON.stringify(restarted.snapshot());
  for (const privateValue of ['baselineUsed', 'lastUsed', 'amountIdentity', identityA, identityB]) assert.ok(!serialized.includes(privateValue));
  for (const used of [-1, NaN, Infinity, '3']) restarted.recordAmount(used, identityA);
  assert.equal(restarted.snapshot().amount, expected + .75);
  f.tick(1000);
  assert.equal(restarted.snapshot().amount, null);
  assert.equal(restarted.snapshot().totalTokens, 0);
  assert.equal(restarted.snapshot().history.length, 1);
  restarted.recordAmount(99, identityB);
  assert.equal(restarted.snapshot().amount, 0);
  await restarted.close();
});

test('migrates old-day v1 tokens and retains only the latest thirty natural days on disk', async () => {
  const f = fixture();
  f.usage.record(tokens); await f.usage.close();
  const legacy = f.store.get(); delete legacy.history;
  await f.store.set(legacy);
  f.tick(86400_000);
  const migrated = new CapinfoUsage(f.store, {now: f.now});
  assert.equal(migrated.snapshot().totalTokens, 0);
  assert.equal(migrated.snapshot().history[0].totalTokens, 24);
  for (let day = 0; day < 35; day++) {
    migrated.recordAmount(day, identityA); migrated.record(tokens); f.tick(86400_000);
  }
  migrated.prune();
  assert.equal(migrated.snapshot().history.length, 29); // No sample today yet.
  migrated.recordAmount(35, identityA);
  await migrated.close();
  const history = migrated.snapshot().history;
  assert.equal(history.length, 30);
  assert.deepEqual(history.map(row => row.date), history.map(row => row.date).sort());
  assert.equal(f.store.get().history.length, 30);
});

test('serial writes and close preserve combined tokens and amount updates', async () => {
  const f = fixture(); let active = 0, maximum = 0;
  f.store.set = async value => {active++; maximum = Math.max(maximum, active); await Promise.resolve(); active--;};
  for (let i = 0; i < 20; i++) {f.usage.record(tokens); f.usage.recordAmount(i / 100, identityA);}
  await f.usage.close();
  assert.equal(maximum, 1);
  const previous = f.usage.snapshot(); f.usage.recordAmount(100, identityA);
  assert.deepEqual(f.usage.snapshot(), previous);
});

const collect = async stream => {const chunks = []; for await (const chunk of stream) chunks.push(chunk); return chunks;};
test('observes direct and prepared dispatch exactly once, excludes other providers and preserves errors', async () => {
  const f = fixture();
  const chunk = {type: 'usage', usage: tokens};
  const source = async function* () {yield {type: 'text', text: 'hello'}; yield chunk; yield chunk;};
  const adapter = observeAdapterUsage({stream: source, prepareCall: async () => ({model: {id: 'frozen'}, stream: source})}, f.usage);
  assert.equal((await collect(adapter.stream({provider: 'capinfo'}))).length, 3);
  const call = await adapter.prepareCall('capinfo', 'old');
  assert.equal(call.model.id, 'frozen');
  await collect(call.stream({provider: 'capinfo'}));
  await collect(adapter.stream({provider: 'other'}));
  assert.equal(f.usage.snapshot().requests, 2);
  const error = new Error('upstream');
  const failing = observeAdapterUsage({stream: async function* () {yield chunk; throw error;}, prepareCall: async () => ({})}, f.usage);
  await assert.rejects(collect(failing.stream({provider: 'capinfo'})), error);
  assert.equal(f.usage.snapshot().requests, 3);
  await f.usage.close();
});

test('actual runtime installs observation on both PiAiAdapter entry points', async () => {
  const f = fixture();
  const runtime = createCapinfoRuntime({credentials: {}, get: () => undefined}, {}, f.usage);
  runtime.commit(await runtime.prepare({models: [{id: 'test'}]}));
  // Stub only network dispatch: retain actual adapter preparation and public methods.
  runtime.adapter.streamWithSnapshot = async function* () {yield {type: 'usage', usage: tokens};};
  await collect(runtime.adapter.stream({provider: 'capinfo', model: 'test'}));
  const call = await runtime.adapter.prepareCall('capinfo', 'test');
  await collect(call.stream({provider: 'capinfo', model: 'test'}));
  assert.equal(f.usage.snapshot().totalTokens, 48);
  await f.usage.close();
});
