/** Capinfo-specific corrections for model IDs whose upstream vision metadata is incomplete.
 * Match IDs only (never editable display names); add future models as separate rules.
 * These are additive corrections, not a replacement for declared native capabilities.
 */
const VISION_RULES = Object.freeze([
  Object.freeze({id: 'glm-5.3-flash'}),
  Object.freeze({id: 'glm-5.4'}),
  // Native multimodal models the candidate cache reports without input modalities.
  Object.freeze({id: 'DeepSeek-V4.1-Flash'}),
  Object.freeze({id: 'kimi-k3'}),
  Object.freeze({id: 'kimi-k3.1-pro'}),
]);

export const normalizeId = id => typeof id === 'string' ? id.toLowerCase().replace(/[ _]/g, '-') : '';

/** Preserve unknown models and declared modalities; never mutate saved configuration. */
export function correctVisionInput(id, input) {
  const key = normalizeId(id);
  if (!key || !VISION_RULES.some(rule => normalizeId(rule.id) === key)) return input;
  return [...new Set([...(input?.length ? input : ['text']), 'image'])];
}
