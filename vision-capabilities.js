/** Capinfo-specific corrections for model IDs whose upstream vision metadata is incomplete.
 * Match IDs only (never editable display names); add future models as separate rules.
 * These are additive corrections, not a replacement for declared native capabilities.
 */
const VISION_RULES = Object.freeze([
  Object.freeze({id: 'glm-5.3-flash'}),
  Object.freeze({id: 'glm-5.4'}),
]);

const normalizeId = id => typeof id === 'string' ? id.toLowerCase().replace(/[ _]/g, '-') : '';

/** Preserve unknown models and declared modalities; never mutate saved configuration. */
export function correctVisionInput(id, input) {
  if (!VISION_RULES.some(rule => rule.id === normalizeId(id))) return input;
  return [...new Set([...(input?.length ? input : ['text']), 'image'])];
}
