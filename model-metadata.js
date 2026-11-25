import { normalizeId } from './vision-capabilities.js';

/** Capinfo-specific metadata for known models whose upstream discovery omits
 * context window, max output or reasoning efforts. Match IDs only (never editable
 * display names); explicit per-model configuration always wins over this table.
 * Sources: vendor model docs and the bundled pi-ai provider catalog (2026-11).
 */
const MODEL_METADATA = Object.freeze([
  // GLM-5.3/-Flash/-5.4: 1M context, 128K output, reasoning_effort low/high/max.
  Object.freeze({id: 'glm-5.3', contextWindow: 1000000, maxTokens: 131072,
    reasoningEfforts: Object.freeze({off: null, low: 'low', high: 'high', max: 'max'})}),
  Object.freeze({id: 'glm-5.3-flash', contextWindow: 1000000, maxTokens: 131072,
    reasoningEfforts: Object.freeze({off: null, low: 'low', high: 'high', max: 'max'})}),
  Object.freeze({id: 'glm-5.4', contextWindow: 1000000, maxTokens: 131072,
    reasoningEfforts: Object.freeze({off: null, low: 'low', high: 'high', max: 'max'})}),
  // DeepSeek V4: 1M context, 384K output, thinking effort high/max (thinking default).
  Object.freeze({id: 'DeepSeek-V4-Pro', contextWindow: 1000000, maxTokens: 384000,
    reasoningEfforts: Object.freeze({off: null, high: 'high', max: 'max'})}),
  Object.freeze({id: 'DeepSeek-V4.1-Flash', contextWindow: 1000000, maxTokens: 384000,
    reasoningEfforts: Object.freeze({off: null, high: 'high', max: 'max'})}),
  // Kimi K3 series: 1,048,576 context and output, reasoning_effort low/high/max (always thinking).
  Object.freeze({id: 'kimi-k3', contextWindow: 1048576, maxTokens: 1048576,
    reasoningEfforts: Object.freeze({off: null, low: 'low', high: 'high', max: 'max'})}),
  Object.freeze({id: 'kimi-k3.1-pro', contextWindow: 1048576, maxTokens: 1048576,
    reasoningEfforts: Object.freeze({off: null, low: 'low', high: 'high', max: 'max'})}),
]);

/** Additive defaults for a model ID; undefined when the model is unknown here. */
export function modelMetadata(id) {
  const key = normalizeId(id);
  return key ? MODEL_METADATA.find(rule => normalizeId(rule.id) === key) : undefined;
}
