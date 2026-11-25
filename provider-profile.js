import { CapinfoError } from './capinfo-service.js';
import { correctVisionInput } from './vision-capabilities.js';
import { modelContextWindow, modelMetadata } from './model-metadata.js';

// Capinfo-only projection of the public pi-ai Model vocabulary. Compatibility semantics
// follow DSH llm-pi-ai@0.2.2-rc.1 (MIT); full history/stream conversion is NOT copied.
const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const FIELDS = {
  'openai-responses': ['supportsDeveloperRole', 'supportsMaxOutputTokens', 'supportsStrictMode', 'supportsLongCacheRetention'],
  'anthropic-messages': ['supportsEagerToolInputStreaming', 'supportsLongCacheRetention', 'supportsCacheControlOnTools', 'supportsTemperature', 'forceAdaptiveThinking', 'allowEmptySignature', 'supportsStrictTools'],
  'openai-completions': ['supportsStore', 'supportsDeveloperRole', 'supportsReasoningEffort', 'supportsUsageInStreaming', 'supportsFinishReason', 'maxTokensField', 'requiresToolResultName', 'requiresAssistantAfterToolResult', 'requiresThinkingAsText', 'requiresReasoningContentOnAssistantMessages', 'thinkingFormat', 'chatTemplateKwargs', 'chatTemplateArgs', 'supportsThinkingTokenBudget', 'thinkingTokenBudgetField', 'vllmPriority', 'supportsStrictMode', 'cacheControlFormat', 'supportsLongCacheRetention'],
};
const fail = () => {throw new CapinfoError('Capinfo 模型配置无效，迁移或保存已停止，原配置已保留。');};
const entries = object => Object.entries(object || {}).filter(([, value]) =>
  !(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0));
const positive = value => {if (!Number.isSafeInteger(value) || value <= 0) fail(); return value;};

export function capinfoModelFields(profile) {
  const api = profile.api;
  if (!FIELDS[api]) fail();
  let url;
  try {url = new URL(profile.baseURL);} catch {fail();}
  if (url.protocol !== 'https:' || url.hostname !== 'api.capinfo.com.cn' || url.port || url.username || url.password) fail();
  if (Object.keys(profile.modelOverrides || {}).length) fail();
  const allowed = new Set(FIELDS[api]);
  const routeCompat = entries(profile.compat);
  for (const [key, value] of routeCompat) if (!allowed.has(key) || value == null) fail();
  const defaultInput = profile.defaultInput ?? ['text'];
  const inputOf = input => {
    if (!Array.isArray(input) || !input.length || input.some(value => value !== 'text' && value !== 'image')) fail();
    return [...new Set(input)];
  };
  inputOf(defaultInput);
  const configuredMaxTokens = new Map(), seen = new Set();
  if (!Array.isArray(profile.models)) fail();
  const models = profile.models.map(entry => {
    if (typeof entry.id !== 'string' || !entry.id.length || seen.has(entry.id)) fail();
    seen.add(entry.id);
    const compat = Object.fromEntries(routeCompat);
    for (const [key, value] of entries(entry.compat)) {
      if (!allowed.has(key) || value == null) fail();
      compat[key] = value;
    }
    // Maintained metadata fills gaps only; explicit saved values keep precedence.
    const meta = modelMetadata(entry.id);
    const model = {id: entry.id, name: entry.name ?? entry.id, provider: 'capinfo', api, baseUrl: profile.baseURL,
      input: correctVisionInput(entry.id, inputOf(entry.input?.length ? entry.input : defaultInput)),
      cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
      contextWindow: positive(modelContextWindow(entry, profile, meta)),
      maxTokens: positive(entry.maxTokens ?? meta?.maxTokens ?? profile.defaultMaxTokens ?? 32768), reasoning: false};
    if (!model.name) fail();
    if (entry.maxTokens !== undefined) configuredMaxTokens.set(entry.id, entry.maxTokens);
    if (Object.keys(compat).length) model.compat = compat;
    const declared = entry.reasoningEfforts !== undefined ? entry.reasoningEfforts : meta?.reasoningEfforts;
    if (declared !== undefined && declared !== false) {
      const efforts = declared;
      if (!efforts || typeof efforts !== 'object' || Array.isArray(efforts)
        || Object.keys(efforts).some(level => !LEVELS.includes(level))
        || !LEVELS.some(level => level !== 'off' && efforts[level] !== undefined)) fail();
      const mapping = {};
      for (const level of LEVELS) {
        const wire = efforts[level];
        if (wire === undefined) mapping[level] = null;
        else if (wire === null) {if (level !== 'off') fail();}
        else if (typeof wire !== 'string' || !wire.length) fail();
        else mapping[level] = wire;
      }
      model.reasoning = true; model.thinkingLevelMap = mapping;
    }
    return model;
  });
  for (const value of [profile.streamIdleTimeoutMs ?? 300000, profile.maxRequestImageBytes ?? 20971520,
    profile.requestImagePixelBudget ?? 4194304, profile.requestImageMaxBytes ?? 1048576]) positive(value);
  if ((profile.streamIdleTimeoutMs ?? 300000) > 2147483647) fail();
  for (const [key, value] of Object.entries(profile.headers || {})) {
    try {new Headers([[key, value]]);} catch {fail();}
  }
  return {models, configuredMaxTokens};
}
