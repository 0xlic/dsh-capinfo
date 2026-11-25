import test from 'node:test';
import assert from 'node:assert/strict';
import {capinfoModelFields} from '../provider-profile.js';
import {discoverCapinfoModels} from '../model-discovery.js';

const profile = extra => ({api: 'openai-responses', baseURL: 'https://api.capinfo.com.cn/v1', ...extra});

/** The IDs actually present in the current candidate cache, exactly as synced. */
const CURRENT = ['DeepSeek-V4-Pro', 'DeepSeek-V4.1-Flash', 'glm-5.3', 'glm-5.3-flash', 'glm-5.4',
  'kimi-k3', 'kimi-k3.1-pro'];

test('maintained metadata fills context, output and thinking levels for known models', () => {
  const {models, configuredMaxTokens} = capinfoModelFields(profile({models: CURRENT.map(id => ({id}))}));
  const byId = Object.fromEntries(models.map(model => [model.id, model]));
  assert.equal(configuredMaxTokens.size, 0);
  assert.deepEqual(Object.fromEntries(models.map(model => [model.id, model.contextWindow])), {
    'DeepSeek-V4-Pro': 1000000, 'DeepSeek-V4.1-Flash': 1000000,
    'glm-5.3': 1000000, 'glm-5.3-flash': 1000000, 'glm-5.4': 1000000,
    'kimi-k3': 1048576, 'kimi-k3.1-pro': 1048576});
  assert.deepEqual(Object.fromEntries(models.map(model => [model.id, model.maxTokens])), {
    'DeepSeek-V4-Pro': 384000, 'DeepSeek-V4.1-Flash': 384000,
    'glm-5.3': 131072, 'glm-5.3-flash': 131072, 'glm-5.4': 131072,
    'kimi-k3': 1048576, 'kimi-k3.1-pro': 1048576});
  // Declared off:null is validated then omitted, matching the existing projection convention.
  const glmMap = {minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max'};
  const deepseekMap = {minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max'};
  for (const [id, map] of [['glm-5.3', glmMap], ['glm-5.3-flash', glmMap], ['glm-5.4', glmMap],
    ['kimi-k3', glmMap], ['kimi-k3.1-pro', glmMap], ['DeepSeek-V4-Pro', deepseekMap],
    ['DeepSeek-V4.1-Flash', deepseekMap]]) {
    assert.equal(byId[id].reasoning, true, id);
    assert.deepEqual(byId[id].thinkingLevelMap, map, id);
  }
});

test('metadata spelling variants match while other models keep route defaults', () => {
  for (const id of ['DEEPSEEK V4 PRO', 'deepseek_v4.1_flash', 'Kimi K3', 'KIMI_K3.1_PRO']) {
    const model = capinfoModelFields(profile({models: [{id}]})).models[0];
    assert.equal(model.reasoning, true, id);
    assert.notEqual(model.contextWindow, 262144, id);
  }
  for (const id of ['glm-5.2', 'glm-5.4-preview', 'kimi-k2.5', 'deepseek-v4', 'vendor/kimi-k3', 'kimi-k3-pro']) {
    const model = capinfoModelFields(profile({models: [{id}]})).models[0];
    assert.equal(model.contextWindow, 262144, id);
    assert.equal(model.maxTokens, 32768, id);
    assert.equal(model.reasoning, false, id);
  }
});

test('explicit configuration wins over metadata and false reasoning stays off', () => {
  const saved = profile({models: [
    {id: 'glm-5.3', contextWindow: 500, maxTokens: 42, reasoningEfforts: {off: null, high: 'high'}},
    {id: 'kimi-k3', reasoningEfforts: false},
  ]});
  const before = structuredClone(saved);
  const [glm, kimi] = capinfoModelFields(saved).models;
  assert.equal(glm.contextWindow, 500);
  assert.equal(glm.maxTokens, 42);
  assert.deepEqual(glm.thinkingLevelMap,
    {minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: null});
  assert.equal(kimi.reasoning, false);
  assert.equal(kimi.thinkingLevelMap, undefined);
  assert.deepEqual(saved, before);
  // Route defaults still lose to metadata but beat nothing configured anywhere.
  assert.equal(capinfoModelFields(profile({defaultContextWindow: 512, models: [{id: 'glm-5.4'}]})).models[0]
    .contextWindow, 1000000);
});

test('discovery leaves metadata application to the profile projection', async () => {
  const rows = await discoverCapinfoModels({baseURL: 'https://api.capinfo.com.cn/v1', apiKey: 'secret'}, {}, undefined,
    async () => Response.json({data: CURRENT.map(id => ({id}))}));
  assert.deepEqual(rows.map(row => [row.id, row.contextWindow, row.reasoningEfforts]),
    CURRENT.map(id => [id, undefined, undefined]));
});
