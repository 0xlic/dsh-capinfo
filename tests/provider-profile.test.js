import test from 'node:test';
import assert from 'node:assert/strict';
import {capinfoModelFields} from '../provider-profile.js';
import {discoverCapinfoModels} from '../model-discovery.js';

const profile = extra => ({api: 'openai-responses', baseURL: 'https://api.capinfo.com.cn/v1', models: [{id: 'one'}], ...extra});
test('Capinfo defaults to text-only without inventing a request cap', () => {
  const result = capinfoModelFields(profile());
  assert.equal(result.models[0].provider, 'capinfo');
  assert.equal(result.models[0].contextWindow, 262144);
  assert.equal(result.models[0].maxTokens, 32768);
  assert.equal(result.configuredMaxTokens.size, 0);
  assert.equal(result.models[0].reasoning, false);
  assert.deepEqual(result.models[0].input, ['text']);
});

test('explicit capacities, input and compat survive with per-model precedence', () => {
  const result = capinfoModelFields(profile({defaultMaxTokens: 100, compat: {supportsDeveloperRole: false, chatTemplateKwargs: {}},
    models: [{id: 'one', maxTokens: 42, contextWindow: 500, input: ['text', 'image'], compat: {supportsDeveloperRole: true}}]}));
  assert.equal(result.configuredMaxTokens.get('one'), 42);
  assert.equal(result.models[0].compat.supportsDeveloperRole, true);
  assert.deepEqual(result.models[0].input, ['text', 'image']);
});

test('input metadata is preserved without adding images or mutating saved input', () => {
  for (const defaultInput of [undefined, ['text'], ['text', 'image']]) {
    for (const input of [undefined, [], ['text'], ['text', 'image'], ['image'], ['text', 'text']]) {
      const saved = profile({defaultInput, models: [{id: 'one', input}]});
      const before = structuredClone(saved);
      const expected = [...new Set(input?.length ? input : defaultInput ?? ['text'])];
      assert.deepEqual(capinfoModelFields(saved).models[0].input, expected);
      assert.deepEqual(saved, before);
    }
  }
  assert.throws(() => capinfoModelFields(profile({models: [{id: 'one', input: ['audio']}]})));
});

test('reasoning map offers exactly declared levels, including off with no wire value', () => {
  const model = capinfoModelFields(profile({models: [{id: 'one', reasoningEfforts: {off: null, high: 'high'}}]})).models[0];
  assert.equal(model.reasoning, true);
  assert.equal('off' in model.thinkingLevelMap, false);
  assert.equal(model.thinkingLevelMap.high, 'high');
  assert.equal(model.thinkingLevelMap.low, null);
  assert.equal(model.thinkingLevelMap.max, null);
});

test('invalid reasoning, unsupported compat, duplicates and unsafe URLs refuse adoption', () => {
  for (const changes of [
    {models: [{id: 'one', reasoningEfforts: {off: null}}]},
    {models: [{id: 'one', reasoningEfforts: {high: null}}]},
    {models: [{id: 'one'}, {id: 'one'}]},
    {compat: {supportsMidConvoSystemMessages: true}},
    {models: [{id: 'one', compat: {supportsStore: false}}]},
    {models: [{id: 'one', maxTokens: 0}]},
    {baseURL: 'https://example.com/v1'},
  ]) assert.throws(() => capinfoModelFields(profile(changes)));
});

test('discovery preserves deployment headers and uses explicit credential without redirect', async () => {
  let called = 0;
  const rows = await discoverCapinfoModels({baseURL: 'https://api.capinfo.com.cn/v1', api: 'openai-responses', apiKey: 'secret'},
    {headers: {'X-Deployment': 'example'}}, undefined, async (url, options) => {
      called++;
      assert.equal(String(url), 'https://api.capinfo.com.cn/v1/models');
      assert.equal(options.headers.get('X-Deployment'), 'example');
      assert.equal(options.headers.get('Authorization'), 'Bearer secret');
      assert.equal(options.redirect, 'error');
      return Response.json({data: [{id: 'one'}, {id: 'one'}, {id: 'two', context_window: 123, max_output_tokens: 42}]});
    });
  assert.equal(called, 1); assert.deepEqual(rows.map(row => row.id), ['one', 'two']);
  assert.equal(rows[1].contextWindow, 123); assert.equal(rows[1].maxTokens, 42);
});

test('enriched discovery preserves request map keys and ignores primitive values', async () => {
  const rows = await discoverCapinfoModels({baseURL: 'https://api.capinfo.com.cn/v1', apiKey: 'secret'}, {}, undefined,
    async () => Response.json({models: {alias: {id: 'canonical', name: 'Name'}, invalid: 'value'}}));
  assert.deepEqual(rows, [{id: 'alias', name: 'Name'}]);
});
