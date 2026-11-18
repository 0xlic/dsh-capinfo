import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {formatUnitCost} from '../usage-chart-options.js';

// Exercise only the async request callback with injected state setters and HTTP transport.
// No React/DOM renderer or visual preview is simulated.
const moduleSource = await readFile(new URL('../client-source.js', import.meta.url), 'utf8');
const chartImport = /^import \{createUsageChartComponent\} from '\.\/usage-chart\.js';\r?\n/m;
assert.equal((moduleSource.match(/^import /gm) || []).length, 2);
assert.match(moduleSource, chartImport);
const unitCostImport = /^import \{formatUnitCost\} from '\.\/usage-chart-options\.js';\r?\n/m;
assert.match(moduleSource, unitCostImport);
const source = moduleSource.replace(chartImport, '').replace(unitCostImport, '');
const run = (script, globals) => vm.runInNewContext(script, {
  formatUnitCost,
  createUsageChartComponent: () => 'usage-chart', ...globals,
});
const transportStart = source.indexOf('const fetch = ') + 'const fetch = '.length;
const transportEnd = source.indexOf('\n    const en =', transportStart);
const transportSource = '(' + source.slice(transportStart, transportEnd).trim().replace(/;$/, '') + ')';

test('desktop requests use the owned Host transport instead of the static page origin', async () => {
  const calls = [];
  const transport = {fetch(input, init) {
    assert.equal(this, transport);
    calls.push({input, init});
    return Promise.resolve({ok: true, json: async () => status});
  }};
  const send = run(transportSource, {
    __DSH_TRANSPORT__: transport,
    fetch: () => {throw Error('must not call static page fetch');},
  });
  const response = await send('api/plugins/capinfo', {method: 'POST'});
  assert.equal((await response.json()).hasApiKey, true);
  assert.equal(calls[0].input, 'api/plugins/capinfo');
});

test('browser requests preserve the application mount and fall back to native fetch', async () => {
  const calls = [];
  const send = run(transportSource, {fetch: async (input, init) => {calls.push({input, init}); return {ok: true};}});
  assert.equal((await send('api/plugins/capinfo', {method: 'POST'})).ok, true);
  assert.equal(new URL(calls[0].input, 'https://example.test/harness/').pathname, '/harness/api/plugins/capinfo');
});

const start = source.indexOf('const request = React.useCallback(') + 'const request = React.useCallback('.length;
const end = source.indexOf('\n          }, []);', start);
const callback = '(' + source.slice(start, end) + '\n          })';
function setup(responses, {dirty = true} = {}) {
  const original = {selectedIds: ['one']};
  const values = {state: original, selected: dirty ? ['two'] : ['one'], notice: null};
  const drafts = {current: {...values}};
  const lifecycle = {current: {mounted: true, controller: null}};
  const calls = [];
  const request = run(callback, {
    AbortController, Set, drafts, lifecycle,
    setState: value => {values.state = value;},
    setSelected: value => {values.selected = value;},
    setNotice: value => {values.notice = value;},
    setBusy: () => {},
    fetch: async (url, options) => {
      assert.equal(url, 'api/plugins/capinfo');
      assert.equal(options.method, 'POST');
      calls.push(JSON.parse(options.body));
      const response = await responses.shift();
      if (response instanceof Error) throw response;
      return {ok: true, json: async () => response};
    },
  });
  return {request, values, calls, lifecycle};
}
const status = {ok: true, selectedIds: ['one', 'three'], models: [{id: 'three'}], hasApiKey: true};

test('credential deletion reports success or ambient fallback without discarding other drafts', async () => {
  for (const hasApiKey of [false, true]) {
    const f = setup([{...status, hasApiKey}]);
    let cleared = false;
    await f.request('deleteApiKey', {}, () => {cleared = true;});
    assert.equal(f.values.state.hasApiKey, hasApiKey);
    assert.equal(f.values.notice.key, hasApiKey ? 'keyDeletedFallback' : 'keyDeleted');
    assert.equal(f.values.notice.warning, hasApiKey);
    assert.deepEqual(f.values.selected, ['two']);
    assert.equal(cleared, true);
  }
});

test('configured state, credential placeholder and inline delete confirmation are defined', () => {
  assert.match(source, /state\.hasApiKey \? 'capinfo-configured' : 'capinfo-muted'/);
  assert.match(source, /placeholder:.*t\('secretPlaceholder'\)/);
  assert.match(source, /secretPlaceholder: '••••••••••••'/);
  assert.match(source, /button\('deleteKey', \(\) => setConfirmDelete\(true\)/);
  assert.match(source, /button\('confirmDeleteKey', \(\) => request\('deleteApiKey'/);
});

test('spending display uses only the host usage snapshot, never a remote spending request', async () => {
  assert.doesNotMatch(source, /balance/i);
  const calls = [];
  const send = run(transportSource, {__DSH_TRANSPORT__: {fetch: async (input, init) => {
    calls.push({input, init}); return {ok: true};
  }}});
  await send('api/plugins/capinfo/usage', {method: 'GET'});
  assert.deepEqual(calls, [{input: 'api/plugins/capinfo/usage', init: {method: 'GET'}}]);
  assert.match(source, /currency\(value\?\.amount\)/);
  assert.match(source, /setInterval\(.*30000\)/);
});

test('manual reload UI has been removed', () => {
  assert.equal(source.includes("button('reload'"), false);
  assert.equal(source.includes('reloadHint'), false);
});

test('rejected save automatically reads persisted status and preserves drafts', async () => {
  const f = setup([{ok: false, error: 'API key saved; sync failed'}, status]);
  await f.request('save', {apiKey: 'test-key'});
  assert.deepEqual(f.calls.map(row => row.action), ['save', 'status']);
  assert.deepEqual(f.values.selected, ['two']);
  assert.equal(f.values.state.hasApiKey, true);
  assert.equal(f.values.notice.retry, false);
  assert.equal(f.values.notice.detail, 'API key saved; sync failed');
});

test('lost save response is not replayed; only a status read follows', async () => {
  const f = setup([new Error('network failure'), status]);
  await f.request('save', {apiKey: 'test-key'});
  assert.deepEqual(f.calls.map(row => row.action), ['save', 'status']);
  assert.equal(f.values.notice.retry, false);
  assert.deepEqual(f.values.selected, ['two']);
});

test('failed reconciliation exposes a small retry and status retry preserves drafts', async () => {
  const f = setup([new Error('offline'), new Error('offline'), status]);
  await f.request('refresh');
  assert.equal(f.values.notice.retry, true);
  await f.request('status');
  assert.deepEqual(f.calls.map(row => row.action), ['refresh', 'status', 'status']);
  assert.deepEqual(f.values.selected, ['two']);
  assert.equal(f.values.notice, null);
});

test('saving a credential synchronizes clean selections and preserves dirty drafts without extra requests', async () => {
  for (const dirty of [false, true]) {
    const f = setup([status], {dirty});
    let cleared = false;
    await f.request('save', {apiKey: 'test-key'}, () => {cleared = true;});
    assert.deepEqual(f.calls, [{action: 'save', apiKey: 'test-key'}]);
    assert.deepEqual(f.values.selected, dirty ? ['two'] : ['one', 'three']);
    assert.equal(f.values.state.hasApiKey, true);
    assert.equal(f.values.notice.key, 'saved');
    assert.equal(cleared, true);
  }
});

test('successful refresh updates clean selections but preserves dirty ones', async () => {
  const dirty = setup([status]); await dirty.request('refresh');
  assert.deepEqual(dirty.values.selected, ['two']);
  const clean = setup([status], {dirty: false}); await clean.request('refresh');
  assert.deepEqual(clean.values.selected, ['one', 'three']);
});

test('successful select adopts server result and unmounted callers never update state', async () => {
  const f = setup([status]); await f.request('select', {selectedIds: ['one', 'three']});
  assert.deepEqual(f.values.selected, ['one', 'three']);
  const closed = setup([status]); closed.lifecycle.current.mounted = false;
  await closed.request('status');
  assert.equal(closed.calls.length, 0);
});
