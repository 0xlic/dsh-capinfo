import test from 'node:test';
import assert from 'node:assert/strict';
import {CapinfoService, CapinfoError, safeError} from '../capinfo-service.js';

function fixture({cached = true} = {}) {
  const config = {providers: {openrouter: {apiKeyEnv: 'OTHER_KEY'}, capinfo: {
    apiKeyEnv: 'CAPINFO_API_KEY', api: 'openai-responses', baseURL: 'https://api.capinfo.com.cn/v1',
    compat: {supportsStore: false}, models: [{id: 'one', contextWindow: 200000, compat: {supportsStore: false}}],
  }}};
  let cache = {models: cached ? structuredClone(config.providers.capinfo.models) : [], lastSynced: cached ? '2026-01-01' : null};
  const creds = new Map([['CAPINFO_API_KEY', 'secret-never-output']]);
  const records = new Map();
  let rev = 1;
  let discovered = [{id: 'one', name: 'One'}, {id: 'two', name: 'Two', contextWindow: 128000}];
  const filter = {enabled: true, models: [{provider: 'other', model: 'other'}, {provider: 'capinfo', model: 'one'}]};
  const mutations = [];
  const ctx = {
    llm: {
      listConfigurableProviders: () => [{provider: 'capinfo', settingsNs: 'include:llm-pi-ai', settingsPath: ['providers', 'capinfo']}],
      discoverModels: async (ns, request) => {
        assert.equal(ns, 'include:llm-pi-ai'); assert.equal(request.api, 'openai-responses');
        assert.equal(request.apiKey, creds.get('CAPINFO_API_KEY'));
        return structuredClone(discovered);
      },
    },
    settings: {
      describe: () => [{ns: 'include:llm-pi-ai', revision: rev, value: structuredClone(config)}, {ns: 'include:scoped-models', revision: rev, value: structuredClone(filter)}],
      mutate: async (ns, ops, expected) => {
        assert.equal(expected, rev); mutations.push({ns, ops});
        if (ns.endsWith(':llm-pi-ai')) config.providers.capinfo = structuredClone(ops[0].value);
        else filter.models = structuredClone(ops[0].value);
        rev++;
      },
    },
    credentials: {
      resolve: async ref => creds.has(ref) ? {value: creds.get(ref)} : undefined,
      describe: async ref => ({configured: creds.has(ref)}),
      set: async (ref, value) => creds.set(ref, value),
      unset: async ref => {creds.delete(ref);},
      readRecord: async key => records.get(key),
      modifyRecord: async (key, fn) => {
        const value = await fn(records.get(key));
        if (value !== undefined) records.set(key, value);
        return records.get(key);
      },
    },
  };
  const provider = {
    profile: () => structuredClone(config.providers.capinfo),
    writeProfile: async profile => { config.providers.capinfo = structuredClone(profile); },
    discover: (request, signal) => ctx.llm.discoverModels('include:llm-pi-ai', request, signal),
    inspection: () => ({management: 'plugin', genericSettingsVisible: false, providerRegistered: true}),
  };
  const service = new CapinfoService(ctx, {}, {get: () => structuredClone(cache), set: async value => {cache = structuredClone(value);}}, provider);
  return {service, ctx, config, filter, records, creds, mutations, setDiscovery: value => {discovered = value;}};
}

test('first refresh selects all and preserves unrelated provider/compat/filter', async () => {
  const f = fixture({cached: false});
  const state = await f.service.run({action: 'refresh'});
  assert.deepEqual(state.selectedIds, ['one', 'two']);
  assert.equal(f.config.providers.openrouter.apiKeyEnv, 'OTHER_KEY');
  assert.equal(f.config.providers.capinfo.api, 'openai-responses');
  assert.equal(f.config.providers.capinfo.models[0].contextWindow, 200000);
  assert.equal(f.config.providers.capinfo.models[0].compat.supportsStore, false);
  assert.deepEqual(f.filter.models, [{provider: 'other', model: 'other'}, {provider: 'capinfo', model: 'one'}, {provider: 'capinfo', model: 'two'}]);
  assert.equal(JSON.stringify(state).includes('secret-never-output'), false);
});

test('subsequent refresh preserves choice; new models are candidates, not silently enabled', async () => {
  const f = fixture();
  const state = await f.service.run({action: 'refresh'});
  assert.deepEqual(state.selectedIds, ['one']);
  assert.deepEqual(state.models.map(row => row.id), ['one', 'two']);
  await f.service.run({action: 'select', selectedIds: ['two']});
  assert.deepEqual(f.config.providers.capinfo.models.map(row => row.id), ['two']);
});

test('saving a new key fetches all and never returns secrets', async () => {
  const f = fixture();
  const state = await f.service.run({action: 'save', apiKey: 'new-secret'});
  assert.deepEqual(state.selectedIds, ['one', 'two']);
  assert.equal(state.hasApiKey, true);
  assert.equal(JSON.stringify(state).includes('new-secret'), false);
});

test('legacy mutation actions and account inputs are rejected without changing credentials', async () => {
  const f = fixture();
  await assert.rejects(f.service.run({action: 'balance'}), /未知/);
  for (const field of ['refreshCookie', 'sessionId', 'username', 'password']) {
    await assert.rejects(f.service.run({action: 'save', apiKey: 'replacement', [field]: 'legacy-secret'}), /操作参数无效/);
  }
  assert.equal(f.creds.get('CAPINFO_API_KEY'), 'secret-never-output');
  assert.equal(f.records.size, 0);
});

test('status does not read or expose legacy account credentials', async () => {
  const f = fixture();
  f.ctx.credentials.readRecord = () => {throw new Error('must not read account records');};
  const state = await f.service.status();
  for (const field of ['authMode', 'hasRefreshCookie', 'hasSessionId'])
    assert.equal(Object.hasOwn(state, field), false);
  assert.equal(Object.hasOwn(state, 'balance'), false);
  assert.equal(Object.hasOwn(f.service, 'balance'), false);
});

test('invalid, empty and stale selections do not change provider', async () => {
  const f = fixture();
  for (const selectedIds of [[], ['missing'], null, [42]])
    await assert.rejects(f.service.run({action: 'select', selectedIds}), CapinfoError);
  assert.equal(f.mutations.length, 0);
  assert.equal((await f.service.run({action: 'status'})).hasApiKey, true);
});

test('empty discovery preserves stored configuration', async () => {
  const f = fixture(); f.setDiscovery([]);
  await assert.rejects(f.service.run({action: 'refresh'}), /原有模型配置已保留/);
  assert.equal(f.mutations.length, 0);
});

test('vanished selections preserve route and save new candidates for adoption', async () => {
  const f = fixture(); f.setDiscovery([{id: 'new'}]);
  await assert.rejects(f.service.run({action: 'refresh'}), /全部下架/);
  assert.equal(f.mutations.length, 0);
  const state = await f.service.run({action: 'status'});
  assert.deepEqual(state.models, [{id: 'new', name: 'new'}]);
  await f.service.run({action: 'select', selectedIds: ['new']});
  assert.equal(f.config.providers.capinfo.models[0].id, 'new');
});

test('requests are serialized and cancellation prevents mutation', async () => {
  const f = fixture({cached: false});
  const [first, second] = await Promise.all([
    f.service.run({action: 'refresh'}), f.service.run({action: 'select', selectedIds: ['two']}),
  ]);
  assert.deepEqual(first.selectedIds, ['one', 'two']);
  assert.deepEqual(second.selectedIds, ['two']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.run({action: 'select', selectedIds: ['one']}, controller.signal));
  assert.deepEqual((await f.service.status()).selectedIds, ['two']);
});

test('deleting API credential preserves model settings and unrelated credentials', async () => {
  const f = fixture();
  f.records.set('unrelated/account', {kind: 'grant', payload: {secret: 'account-secret'}});
  const models = structuredClone(f.config.providers.capinfo.models);
  let notified = 0; f.service.provider.credentialsChanged = () => {notified++;};
  const result = await f.service.run({action: 'deleteApiKey'});
  assert.equal(result.hasApiKey, false);
  assert.equal(f.records.get('unrelated/account').payload.secret, 'account-secret');
  assert.deepEqual(f.config.providers.capinfo.models, models);
  assert.equal(f.mutations.length, 0); assert.equal(notified, 1);
  assert.equal(JSON.stringify(result).includes('account-secret'), false);
  assert.equal(JSON.stringify(result).includes('secret-never-output'), false);
  await f.service.run({action: 'deleteApiKey'}); // Idempotent without touching any other credentials.
});

test('deleting a read-only credential refuses and preserves the key', async () => {
  const f = fixture(); f.ctx.credentials.describe = async () => ({configured: true, writable: false});
  await assert.rejects(f.service.run({action: 'deleteApiKey'}), /只读/);
  assert.equal(f.creds.has('CAPINFO_API_KEY'), true);
  assert.equal((await f.service.status()).apiKeyWritable, false);
});

test('ambient fallback remains honestly configured after local credential deletion', async () => {
  const f = fixture();
  f.ctx.credentials.describe = async () => ({configured: true, writable: true, source: 'environment'});
  const result = await f.service.run({action: 'deleteApiKey'});
  assert.equal(result.hasApiKey, true);
  assert.equal(f.creds.has('CAPINFO_API_KEY'), false);
});

test('untrusted endpoints and arbitrary errors cannot expose credentials', async () => {
  const f = fixture(); f.service.config.baseURL = 'https://attacker.example/v1';
  await assert.rejects(f.service.run({action: 'refresh'}), /仅允许/);
  assert.equal(safeError(new Error('token=TOPSECRET')).includes('TOPSECRET'), false);
});


test('credential changes invalidate spending sampler without clearing usage or replaying model mutations', async () => {
  const f = fixture();
  let invalidations = 0;
  f.service.spending = {invalidate: () => {invalidations++; return Promise.resolve();}};
  await f.service.run({action: 'save', apiKey: ''});
  assert.equal(invalidations, 0);
  await f.service.run({action: 'save', apiKey: 'replacement-key'});
  assert.equal(invalidations, 1);
  await f.service.run({action: 'deleteApiKey'});
  assert.equal(invalidations, 2);
  f.ctx.credentials.describe = async () => ({configured: true, writable: false});
  await assert.rejects(f.service.run({action: 'deleteApiKey'}), /只读/);
  assert.equal(invalidations, 2);
});
