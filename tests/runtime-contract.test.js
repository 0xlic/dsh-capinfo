import test from 'node:test';
import assert from 'node:assert/strict';
import {createCapinfoRuntime} from '../provider-runtime.js';
import * as plugin from '../index.js';
import {readFileSync} from 'node:fs';
import semver from 'semver';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const dshPeers = ['@deepseek-ai/dsh-credentials', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-llm-pi-ai'];

test('DSH accepts later 0.2.x patches and prereleases without admitting 0.3 prereleases', () => {
  for (const name of dshPeers) assert.equal(manifest.peerDependencies[name], manifest.engines.dsh, name);
  for (const [version, hostSupported, peerSupported = hostSupported] of [
    ['0.2.2-rc.2', false], ['0.2.2-rc.3', true], ['0.2.2-rc.5', true],
    ['0.2.2-rc.6', true], ['0.2.2', true], ['0.2.3-rc.1', true, false], ['0.2.3', true],
    ['0.3.0-alpha.1', false], ['0.3.0', false],
  ]) {
    assert.equal(semver.satisfies(version, manifest.engines.dsh, {includePrerelease: true}), hostSupported,
      `engines.dsh on ${version}`);
    // Package managers using default SemVer rules exclude prereleases of later patch tuples.
    for (const name of dshPeers) {
      assert.equal(semver.satisfies(version, manifest.peerDependencies[name]), peerSupported, `${name} on ${version}`);
    }
  }
});

test('runtime contracts exercise one exact, supported DSH package set', () => {
  const testVersion = manifest.devDependencies[dshPeers[0]];
  assert.ok(semver.valid(testVersion));
  assert.ok(semver.satisfies(testVersion, manifest.engines.dsh, {includePrerelease: true}));
  for (const name of dshPeers) {
    const installed = JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
    assert.equal(manifest.devDependencies[name], testVersion, `${name} dev dependency`);
    assert.equal(installed.version, testVersion, `${name} installed version`);
  }
});

const profile = api => ({api, baseURL: 'https://api.capinfo.com.cn/v1', apiKeyEnv: 'CAPINFO_API_KEY',
  models: [{id: 'contract-model', name: 'Contract model', contextWindow: 8192, maxTokens: 512,
    input: ['text', 'image'], reasoningEfforts: {off: null, high: 'high'}}]});
const context = resolve => ({credentials: {resolve}, get: () => undefined});

test('host entry imports against current DSH dependencies', () => {
  assert.equal(typeof plugin.apply, 'function');
  assert.ok(plugin.inject.includes('llm'));
});

for (const api of ['openai-responses', 'openai-completions', 'anthropic-messages']) {
  test(`current PiAiAdapter resolves ${api} models without credential or network access`, async () => {
    let reads = 0;
    const runtime = createCapinfoRuntime(context(async () => {reads++; return {value: 'test-only-key'};}), {});
    const prepared = await runtime.prepare(profile(api));
    assert.equal(reads, 0);
    runtime.commit(prepared);
    const model = await runtime.adapter.resolveModel('capinfo', 'contract-model');
    assert.equal(model.id, 'contract-model');
    assert.equal(model.context.contextWindow, 8192);
    assert.equal(model.defaultMaxTokens, 512);
    assert.deepEqual(model.inputModalities, ['text', 'image']);
    assert.deepEqual(model.reasoning.efforts.map(effort => effort.id), ['off', 'high']);
    const call = await runtime.adapter.prepareCall('capinfo', 'contract-model');
    assert.equal(typeof call.stream, 'function');
    assert.equal(reads, 0);
    assert.equal((await runtime.adapter.listModels('capinfo'))[0].id, 'contract-model');
    assert.equal(reads, 1);
    runtime.commit(await runtime.prepare({...profile(api), models: [{id: 'replacement'}]}));
    assert.equal(call.model.id, 'contract-model');
    await assert.rejects(runtime.adapter.resolveModel('capinfo', 'contract-model'), {code: 'UNKNOWN_MODEL'});
    assert.equal((await runtime.adapter.resolveModel('capinfo', 'replacement')).id, 'replacement');
    assert.deepEqual((await runtime.adapter.resolveModel('capinfo', 'replacement')).inputModalities, ['text']);
    runtime.commit(await runtime.prepare({...profile(api), defaultInput: ['text'],
      models: [{id: 'legacy', input: ['text']}]}));
    assert.deepEqual((await runtime.adapter.resolveModel('capinfo', 'legacy')).inputModalities, ['text']);
    assert.deepEqual((await runtime.adapter.listModels('capinfo'))[0].inputModalities, ['text']);
  });
}

for (const api of ['openai-responses', 'openai-completions', 'anthropic-messages']) {
  for (const legacyInput of [true, false]) {
    test(`GLM vision models correct ${legacyInput ? 'legacy text-only' : 'omitted'} input through ${api} runtime contracts`, async () => {
      const correctedIds = ['glm-5.3-flash', 'GLM-5.3-FLASH', 'GLM 5.3 FLASH', 'glm_5.3_flash',
        'glm-5.4', 'GLM-5.4', 'GLM 5.4', 'glm_5.4'];
      const unchangedIds = ['glm-5.3', 'glm-5.3-flash-preview', 'glm-5.4-preview', 'vendor/glm-5.4', 'contract-model'];
      const raw = {...profile(api), models: [...correctedIds, ...unchangedIds].map(id => ({
        id, ...(legacyInput ? {input: ['text']} : {}),
      }))};
      const original = structuredClone(raw);
      const runtime = createCapinfoRuntime(context(async () => ({value: 'test-only-key'})), {});
      const prepared = await runtime.prepare(raw);
      assert.deepEqual(raw, original, 'prepare must not mutate the persisted profile');
      const piModels = prepared.get('capinfo').piProvider.getModels();
      runtime.commit(prepared);
      const listed = await runtime.adapter.listModels('capinfo');
      assert.deepEqual(listed.map(model => model.id), [...correctedIds, ...unchangedIds]);
      for (const id of [...correctedIds, ...unchangedIds]) {
        const expected = correctedIds.includes(id) ? ['text', 'image'] : ['text'];
        assert.deepEqual(piModels.find(model => model.id === id).input, expected, `${id}: underlying Pi model input`);
        assert.deepEqual(listed.find(model => model.id === id).inputModalities, expected, `${id}: listModels`);
        assert.deepEqual((await runtime.adapter.resolveModel('capinfo', id)).inputModalities, expected, `${id}: resolveModel`);
        const call = await runtime.adapter.prepareCall('capinfo', id);
        assert.equal(call.model.id, id);
        assert.deepEqual(call.model.inputModalities, expected, `${id}: prepareCall.model`);
      }
      assert.deepEqual(raw, original, 'runtime lookups must not mutate the persisted profile');
    });
  }
}

test('provider registration uses Capinfo while preserving its route and custom names', async () => {
  const runtime = createCapinfoRuntime(context(async () => ({value: 'test-only-key'})), {});
  for (const [displayName, expected] of [[undefined, 'Capinfo'], ['capinfo', 'Capinfo'], ['Custom', 'Custom']]) {
    const raw = profile('openai-responses');
    if (displayName !== undefined) raw.displayName = displayName;
    const prepared = await runtime.prepare(raw);
    assert.deepEqual([...prepared.keys()], ['capinfo']);
    assert.equal(prepared.get('capinfo').displayName, expected);
    assert.equal(prepared.get('capinfo').piProvider.name, expected);
  }
});

test('current adapter hides models without a configured credential', async () => {
  const runtime = createCapinfoRuntime(context(async () => undefined), {});
  runtime.commit(await runtime.prepare(profile('openai-responses')));
  assert.deepEqual(await runtime.adapter.listModels('capinfo'), []);
});
