import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CapinfoSpending} from '../spending.js';

const valid = {success: true, source: 'api_key', currency: 'CNY', unit: 'CNY', is_active: true, status: 'active', used: 1.3232272, unlimited_quota: true};
const response = (body = valid) => ({ok: true, json: async () => body});
const deferred = () => {let resolve; const promise = new Promise(r => {resolve = r;}); return {promise, resolve};};
const fixture = () => {
  const f = {route: {baseURL: 'https://api.capinfo.com.cn/v1', keyRef: 'ref'}, key: 'secret-key', calls: [], records: [], resolves: [], cleared: [], pruned: 0};
  f.fetch = async (...args) => {f.calls.push(args); return response();};
  f.sampler = new CapinfoSpending(() => f.route, {resolve: async ref => {f.resolves.push(ref); return {value: f.key};}},
    {recordAmount: (...args) => f.records.push(args), prune: () => f.pruned++},
    {fetch: (...args) => f.fetch(...args), now: () => Date.parse('2026-11-13T00:00:00Z'),
      setInterval: (callback, delay) => {f.interval = {callback, delay}; return 1;}, clearInterval: id => f.cleared.push(id)});
  return f;
};

test('start samples immediately and every 60s with fresh credentials, fixed secure headers and hashed identity', async () => {
  const f = fixture();
  assert.equal((await f.sampler.start()).status, 'ready');
  assert.equal(f.interval.delay, 60000);
  const [url, init] = f.calls[0];
  assert.equal(url, 'https://api.capinfo.com.cn/v1/user/balance');
  assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
  assert.equal(init.headers.Authorization, 'Bearer secret-key'); assert.equal(init.headers['User-Agent'], 'cc-switch/1.0');
  assert.deepEqual(f.records[0], [1.3232272, createHash('sha256').update('secret-key').digest('hex')]);
  f.key = 'next-key'; f.interval.callback(); await f.sampler.refresh();
  assert.equal(f.calls[1][1].headers.Authorization, 'Bearer next-key'); assert.equal(f.resolves.length, 2);
  assert.equal(f.pruned, 2);
  assert.deepEqual(Object.keys(f.sampler.snapshot()).sort(), ['checkedAt', 'error', 'status']);
  assert.ok(!JSON.stringify(f.sampler.snapshot()).includes('key'));
  f.sampler.stop(); assert.deepEqual(f.cleared, [1]);
});

test('refresh deduplicates and invalidate aborts old work without late writes', async () => {
  const f = fixture(), old = deferred(); let oldSignal;
  f.fetch = async (url, init) => {oldSignal = init.signal; return old.promise;};
  const a = f.sampler.refresh(); assert.equal(a, f.sampler.refresh());
  await Promise.resolve(); await Promise.resolve();
  f.fetch = async () => response({...valid, used: 3});
  const b = f.sampler.invalidate(); assert.equal(oldSignal.aborted, true);
  await b; old.resolve(response({...valid, used: 99})); await a; await Promise.resolve();
  assert.equal(f.records.length, 1); assert.equal(f.records[0][0], 3);
  f.sampler.stop();
});

test('stop cancels pending credential resolution and blocks late fetches and writes', async () => {
  const f = fixture(), wait = deferred();
  f.sampler.credentials.resolve = () => wait.promise;
  const pending = f.sampler.start(); await Promise.resolve(); f.sampler.stop();
  wait.resolve({value: 'do-not-use'}); await pending;
  assert.equal(f.calls.length, 0); assert.equal(f.records.length, 0);
  await f.sampler.refresh(); await f.sampler.invalidate(); assert.equal(f.calls.length, 0);
});

test('errors never expose bodies, routes or keys and recover without losing previous samples', async () => {
  const f = fixture(); await f.sampler.refresh();
  f.fetch = async () => {throw new Error('secret-key https://evil.test raw-body');};
  assert.equal((await f.sampler.refresh()).status, 'error');
  for (const secret of ['secret-key', 'evil.test', 'raw-body']) assert.ok(!JSON.stringify(f.sampler.snapshot()).includes(secret));
  assert.equal(f.records.length, 1);
  f.fetch = async () => response({...valid, unlimited_quota: false});
  assert.equal((await f.sampler.refresh()).status, 'ready'); assert.equal(f.records.length, 2);
  f.sampler.stop();
});

test('strict schema rejects invalid metadata and nonfinite or negative amounts', async () => {
  const f = fixture();
  for (const patch of [{success: false}, {source: 'account'}, {currency: 'USD'}, {unit: 'USD'}, {is_active: false},
    {used: -1}, {used: NaN}, {used: Infinity}, {used: null}, {used: '2'}, {status: 'inactive'}]) {
    f.fetch = async () => response({...valid, ...patch});
    assert.equal((await f.sampler.refresh()).status, 'error');
  }
  f.fetch = async () => ({ok: false, json: async () => {throw new Error('must not read');}});
  assert.equal((await f.sampler.refresh()).status, 'error');
  f.fetch = async () => ({...response(), redirected: true});
  assert.equal((await f.sampler.refresh()).status, 'error');
  assert.equal(f.records.length, 0); f.sampler.stop();
});

test('20-second timeout aborts even a noncooperating fetch and prevents late writes', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const f = fixture(), wait = deferred(); let signal;
  f.fetch = async (_, init) => {signal = init.signal; return wait.promise;};
  const pending = f.sampler.refresh(); await Promise.resolve(); await Promise.resolve();
  t.mock.timers.tick(20_000);
  assert.equal((await pending).status, 'error'); assert.equal(signal.aborted, true);
  wait.resolve(response()); await Promise.resolve(); await Promise.resolve();
  assert.equal(f.records.length, 0); f.sampler.stop();
});

test('cancellation while reading a body suppresses all late accounting', async () => {
  const f = fixture(), body = deferred(), started = deferred();
  f.fetch = async () => ({ok: true, json: () => {started.resolve(); return body.promise;}});
  const pending = f.sampler.refresh(); await started.promise;
  f.sampler.stop(); const state = f.sampler.snapshot(); body.resolve(valid); await pending;
  assert.deepEqual(f.sampler.snapshot(), state); assert.equal(f.records.length, 0);
});

test('missing config is unconfigured; untrusted origins never resolve or send credentials', async () => {
  const f = fixture(); f.route = undefined;
  assert.equal((await f.sampler.refresh()).status, 'unconfigured');
  for (const baseURL of ['http://api.capinfo.com.cn', 'https://evil.test', 'https://api.capinfo.com.cn.evil.test',
    'https://api.capinfo.com.cn:444', 'https://secret@api.capinfo.com.cn', 'invalid']) {
    f.route = {baseURL, keyRef: 'ref'};
    assert.equal((await f.sampler.refresh()).status, 'error');
  }
  assert.equal(f.resolves.length, 0); assert.equal(f.calls.length, 0);
  f.route = {baseURL: 'https://api.capinfo.com.cn', keyRef: 'ref'}; f.key = '';
  assert.equal((await f.sampler.refresh()).status, 'unconfigured');
  f.sampler.stop();
});
