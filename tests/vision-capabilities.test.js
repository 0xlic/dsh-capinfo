import test from 'node:test';
import assert from 'node:assert/strict';
import {correctVisionInput} from '../vision-capabilities.js';
import {capinfoModelFields} from '../provider-profile.js';
import {discoverCapinfoModels} from '../model-discovery.js';

const profile = {api: 'openai-responses', baseURL: 'https://api.capinfo.com.cn/v1'};

test('vision correction matches only the registered ID and safe spelling variants', () => {
  for (const id of ['glm-5.3-flash', 'GLM-5.3-Flash', 'Glm 5.3 Flash', 'glm_5.3_flash']) {
    for (const input of [undefined, [], ['text'], ['text', 'image'], ['image']]) {
      const before = structuredClone(input);
      const actual = correctVisionInput(id, input);
      assert.deepEqual(actual, [...new Set([...(input?.length ? input : ['text']), 'image'])]);
      assert.deepEqual(input, before);
      assert.deepEqual(correctVisionInput(id, actual), actual);
      assert.notEqual(actual, input);
    }
  }
  for (const id of ['glm-5.3', 'glm-5-flash', 'glm-5.3-flash-preview', 'glm-5.3-flash-extra',
    'vendor/glm-5.3-flash', 'not-glm-5.3-flash', '', undefined]) {
    assert.equal(correctVisionInput(id, undefined), undefined);
    const input = ['text'];
    assert.equal(correctVisionInput(id, input), input);
    assert.deepEqual(correctVisionInput(id, ['text', 'image']), ['text', 'image']);
  }
});

test('profile correction respects validation and does not trust display names', () => {
  const saved = {...profile, defaultInput: ['text'], models: [
    {id: 'glm-5.3-flash', input: ['text']},
    {id: 'other', name: 'GLM 5.3 Flash'},
    {id: 'native', input: ['text', 'image']},
  ]};
  const before = structuredClone(saved);
  assert.deepEqual(capinfoModelFields(saved).models.map(model => model.input),
    [['text', 'image'], ['text'], ['text', 'image']]);
  assert.deepEqual(saved, before);
  assert.throws(() => capinfoModelFields({...profile, models: [{id: 'glm-5.3-flash', input: ['audio']}]}));
});

test('discovery corrects absent and text-only metadata in both response shapes', async () => {
  for (const api of ['openai-responses', 'openai-completions', 'anthropic-messages']) {
    for (const metadata of [{}, {input: ['text']}, {input_modalities: ['text']}, {inputModalities: ['text', 'image']}]) {
      const target = {id: 'glm-5.3-flash', ...metadata};
      for (const body of [
        {data: [target, {id: 'glm-5.3', name: 'GLM 5.3 Flash'}, {id: 'native', input: ['text', 'image']}]},
        {models: {'glm-5.3-flash': target, 'glm-5.3': {name: 'GLM 5.3 Flash'}, native: {input: ['text', 'image']}}},
      ]) {
        const rows = await discoverCapinfoModels({api, apiKey: 'test-only-key'}, profile, undefined,
          async () => Response.json(body));
        assert.deepEqual(rows[0].inputModalities, ['text', 'image']);
        assert.equal(rows[1].inputModalities, undefined);
        assert.deepEqual(rows[2].inputModalities, ['text', 'image']);
      }
    }
  }
});
