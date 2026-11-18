import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnedCapinfoProvider} from '../owned-provider.js';

function fixture({state = {}, failPrepare = false, failRegister = false, failStore = false} = {}) {
  const original = {api: 'openai-responses', baseURL: 'https://api.capinfo.com.cn/v1', apiKeyEnv: 'CUSTOM_KEY',
    models: [{id: 'one', contextWindow: 200000, compat: {supportsStore: false}}],
    headers: {'X-Deployment': 'example'}, compat: {supportsDeveloperRole: false}, defaultMaxTokens: 1234};
  const settings = {providers: {capinfo: structuredClone(original), other: {models: [{id: 'other'}]}}};
  let stored = {models: [{id: 'one'}], lastSynced: 'previous-sync', ...structuredClone(state)};
  let live = true, disposed = 0, rev = 1;
  const operations = [];
  const runtime = {adapter: {}, prepare: async profile => {
    operations.push('prepare'); if (failPrepare) throw Error('invalid profile'); return profile;
  }, commit: profile => {runtime.profile = structuredClone(profile);}, discover: async () => []};
  const ctx = {
    llm: {
      listConfigurableProviders: () => settings.providers.capinfo ? [{provider: 'capinfo', settingsNs: 'pi-ai'}] : [],
      listProviders: () => live ? [{id: 'capinfo'}] : [],
      registerAdapter: ids => {
        operations.push('register'); assert.deepEqual(ids, ['capinfo']);
        if (failRegister) throw Error('registration failed');
        assert.equal(settings.providers.capinfo, undefined); live = true;
        const handle = () => {live = false; disposed++;};
        handle.replace = next => {assert.deepEqual(next, ['capinfo']); operations.push('replace');};
        return handle;
      },
    },
    settings: {
      describe: () => [{ns: 'pi-ai', revision: rev, value: structuredClone(settings)}],
      mutate: async (_ns, ops, revision) => {
        assert.equal(revision, rev++);
        for (const op of ops) {
          operations.push(op.op);
          if (op.op === 'unset') {delete settings.providers.capinfo; live = false;}
          else {settings.providers.capinfo = structuredClone(op.value); live = true;}
        }
      },
    },
  };
  const store = {get: () => structuredClone(stored), set: async value => {
    operations.push('persist:' + value.migration?.phase);
    if (failStore) throw Error('disk write failed'); stored = structuredClone(value);
  }};
  return {owner: new OwnedCapinfoProvider(ctx, store, runtime), runtime, store, settings, original, operations, disposed: () => disposed};
}

test('backup and validation precede deletion; independent registration has no directory row', async () => {
  const f = fixture(); await f.owner.start();
  assert.deepEqual(f.operations.slice(0, 5), ['prepare', 'persist:prepared', 'unset', 'register', 'persist:active']);
  assert.equal(f.settings.providers.capinfo, undefined);
  assert.deepEqual(f.owner.profile(), f.original);
  assert.deepEqual(f.store.get().migration.backup.profile, f.original);
  assert.equal(f.settings.providers.other.models[0].id, 'other');
  assert.deepEqual(f.owner.inspection(), {management: 'plugin', genericSettingsVisible: false, providerRegistered: true, migrationPhase: 'active'});
  f.owner.dispose(); assert.equal(f.disposed(), 1);
});

test('validation or durable-backup failure never removes the original route', async () => {
  for (const options of [{failPrepare: true}, {failStore: true}]) {
    const f = fixture(options); await assert.rejects(f.owner.start());
    assert.deepEqual(f.settings.providers.capinfo, f.original);
    assert.equal(f.operations.includes('unset'), false);
  }
});

test('registration failure restores old route and retains durable migration backup', async () => {
  const f = fixture({failRegister: true}); await assert.rejects(f.owner.start());
  assert.deepEqual(f.settings.providers.capinfo, f.original);
  assert.equal(f.store.get().migration.phase, 'prepared');
  assert.deepEqual(f.store.get().migration.backup.profile, f.original);
});

test('restarts resume interrupted migration without overwriting newer user changes', async () => {
  const first = fixture({failRegister: true}); await assert.rejects(first.owner.start());
  const retry = fixture({state: first.store.get()}); await retry.owner.start();
  assert.equal(retry.owner.inspection().migrationPhase, 'active');
  const conflict = fixture({state: first.store.get()});
  conflict.settings.providers.capinfo.baseURL = 'https://api.capinfo.com.cn/changed';
  await assert.rejects(conflict.owner.start(), /changed after its backup/);
  assert.equal(conflict.operations.includes('unset'), false);
});

test('model selection writes plugin storage only, preserving full compatibility data', async () => {
  const f = fixture(); await f.owner.start();
  f.operations.length = 0;
  await f.owner.writeProfile({...f.owner.profile(), models: [{id: 'two', compat: {supportsStore: false}}]});
  assert.equal(f.operations.includes('set'), false); assert.equal(f.operations.includes('unset'), false);
  assert.equal(f.owner.profile().models[0].id, 'two');
  assert.equal(f.operations.includes('replace'), true);
  assert.deepEqual(f.owner.profile().headers, f.original.headers);
});

test('after migration, a plugin restart registers from its own storage without settings writes', async () => {
  const f = fixture(); await f.owner.start(); f.owner.dispose(); f.operations.length = 0;
  await f.owner.start();
  assert.equal(f.operations.includes('unset'), false); assert.equal(f.operations.includes('set'), false);
  assert.equal(f.owner.inspection().genericSettingsVisible, false);
  assert.equal(f.owner.inspection().providerRegistered, true);
});
