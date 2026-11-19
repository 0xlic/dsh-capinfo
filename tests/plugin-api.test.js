import test from 'node:test';
import assert from 'node:assert/strict';
import {apply} from '../index.js';
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {once} from 'node:events';

// Exercise the installed Connection carrier's body-mode contract rather than
// calling route.fetch(new Request(...)) directly (which hides missing metadata).
async function httpRead(route) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://dsh.internal');
      let request;
      if (route.requestBody === 'buffered') {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        request = new Request(url, {method: req.method,
          ...(chunks.length ? {body: Buffer.concat(chunks)} : {})});
      } else {
        request = new Request(url, {method: req.method, body: Readable.toWeb(req), duplex: 'half'});
      }
      const response = await route.fetch(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(await response.text());
    } catch { res.writeHead(500); res.end('HTTP bridge failed'); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route.path}`);
    return {status: response.status, body: await response.text()};
  } finally {
    const closed = new Promise(resolve => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }
}

test('settings bridge and Host service share the cache, never trigger I/O or migrations, and dispose cleanly', async () => {
  let state = {models: [], lastSynced: 'cached'}, reads = 0, closed = false;
  const effects = [], routes = new Map(), services = new Map();
  const ctx = {
    effect: fn => {const dispose = fn(); if (dispose) effects.push(dispose);},
    reflect: {provide: (name, value) => {services.set(name, value); effects.push(() => services.delete(name));}},
    settings: {configure: () => () => {}, describe: () => []},
    credentials: {resolve: async () => {reads++; return undefined;}, describe: async () => ({configured: false})},
    storageDomain: {open: async options => {
      if (options.name === 'capinfo_usage') {
        let usage = structuredClone(options.global.initial);
        return {global: {get: () => structuredClone(usage), set: async next => {usage = options.global.schema.parse(structuredClone(next));}}, close: async () => {}};
      }
      return {global: {get: () => structuredClone(state),
        set: async next => {state = structuredClone(next);}}, close: async () => {closed = true;}};
    }}, 
    llm: {listConfigurableProviders: () => [], listProviders: () => []},
    connection: {fetch: {register: route => {routes.set(route.path, route); return () => routes.delete(route.path);}}},
    get: () => undefined,
  };
  await apply(ctx, {});
  // Let the nonblocking initial sampler finish its missing-credential check.
  await new Promise(resolve => setImmediate(resolve));
  try {
    assert.equal(routes.has('/api/plugins/capinfo/balance'), false);
    assert.equal(services.has('capinfoBalance'), false);
    const priorReads = reads;
    const usageRoute = routes.get('/api/plugins/capinfo/usage');
    assert.deepEqual(usageRoute.methods, ['GET']);
    assert.equal(usageRoute.requestBody, 'buffered');
    const usageResponse = await usageRoute.fetch();
    assert.equal(usageResponse.headers.get('cache-control'), 'no-store');
    const usageBody = await usageResponse.json();
    assert.equal(usageBody.ok, true);
    assert.equal(usageBody.usage.totalTokens, 0);
    assert.equal(usageBody.usage.timeZone, 'Asia/Shanghai');
    assert.equal(usageBody.usage.amount, null);
    assert.equal(usageBody.usage.amountUpdatedAt, null);
    assert.ok(Array.isArray(usageBody.usage.history));
    assert.equal(usageBody.usage.spending.status, 'unconfigured');
    assert.equal(usageBody.usage.spending.error, null);
    assert.deepEqual(usageBody.usage, services.get('capinfoUsage').getSnapshot());
    assert.equal((await httpRead(usageRoute)).status, 200);
    const broken = {...usageRoute}; delete broken.requestBody;
    assert.equal((await httpRead(broken)).status, 500, 'omitted body mode breaks GET');
    assert.equal(reads, priorReads);
    const response = await routes.get('/api/plugins/capinfo').fetch(new Request('http://localhost/api/plugins/capinfo', {
      method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action: 'status'}),
    }));
    const status = await response.json();
    assert.equal(Object.hasOwn(status, 'balance'), false);
    assert.deepEqual(status.usage, services.get('capinfoUsage').getSnapshot());
  } finally {
    for (const dispose of effects.reverse()) await dispose();
  }
  assert.equal(closed, true); assert.equal(routes.size, 0); assert.equal(services.size, 0);
});


test('initial sample survives the real storage schema and exposes no private amount baseline', async () => {
  const effects = [], routes = new Map();
  const stores = new Map();
  const savedFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, 'https://api.capinfo.com.cn/v1/user/balance');
    assert.equal(init.headers.Authorization, 'Bearer fake-key-for-integration');
    return Response.json({success: true, is_active: true, source: 'api_key', status: 'active',
      currency: 'CNY', unit: 'CNY', unlimited_quota: true, balance: null, total: null, used: 1.3232272});
  };
  const ctx = {
    effect: fn => {const dispose = fn(); if (dispose) effects.push(dispose);},
    reflect: {provide: () => {}},
    settings: {configure: () => () => {}, describe: () => []},
    credentials: {resolve: async () => ({value: 'fake-key-for-integration'}), describe: async () => ({configured: true})},
    storageDomain: {open: async options => {
      let state = options.name === 'capinfo_models' ? {models: [], lastSynced: 'cached'} : options.global.initial;
      const store = {get: () => structuredClone(state), set: async value => {state = options.global.schema.parse(structuredClone(value));}};
      stores.set(options.name, store);
      return {global: store, close: async () => {}};
    }},
    llm: {listConfigurableProviders: () => [], listProviders: () => []},
    connection: {fetch: {register: route => {routes.set(route.path, route); return () => routes.delete(route.path);}}},
    get: () => undefined,
  };
  try {
    await apply(ctx, {});
    await new Promise(resolve => setImmediate(resolve));
    const response = await routes.get('/api/plugins/capinfo/usage').fetch();
    const {usage} = await response.json();
    assert.equal(usage.amount, 0);
    assert.equal(usage.spending.status, 'ready');
    assert.equal(usage.persistenceError, false);
    assert.equal(usage.history.at(-1).amount, 0);
    const serialized = JSON.stringify(usage);
    for (const field of ['baselineUsed', 'lastUsed', 'amountIdentity', 'fake-key-for-integration', '1.3232272'])
      assert.equal(serialized.includes(field), false);
    const persisted = stores.get('capinfo_usage').get();
    assert.equal(persisted.history.at(-1).baselineUsed, 1.3232272);
    assert.equal(persisted.history.at(-1).lastUsed, 1.3232272);
    assert.match(persisted.history.at(-1).amountIdentity, /^[a-f0-9]{64}$/);
  } finally {
    for (const dispose of effects.reverse()) await dispose();
    globalThis.fetch = savedFetch;
  }
});
