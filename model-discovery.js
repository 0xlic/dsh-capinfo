import { CapinfoError } from './capinfo-service.js';
import { correctVisionInput } from './vision-capabilities.js';

/** Capinfo-only model discovery, independent of the generic adapter directory. */
export async function discoverCapinfoModels(request, profile, signal, fetcher = fetch) {
  const base = new URL(request.baseURL || profile.baseURL);
  if (base.protocol !== 'https:' || base.hostname !== 'api.capinfo.com.cn' || base.port || base.username || base.password)
    throw new CapinfoError('Capinfo 接口仅允许 https://api.capinfo.com.cn。');
  const anthropic = (request.api || profile.api) === 'anthropic-messages';
  const path = base.pathname.replace(/\/$/, '');
  base.pathname = anthropic ? path.replace(/\/v1$/, '') + '/v1/models' : path + '/models';
  base.search = anthropic ? '?limit=1000' : '';
  base.hash = '';
  const headers = new Headers(profile.headers || {});
  headers.set('Accept', 'application/json');
  if (anthropic) {
    headers.set('x-api-key', request.apiKey);
    headers.set('anthropic-version', '2023-06-01');
  } else headers.set('Authorization', `Bearer ${request.apiKey}`);
  const response = await fetcher(base, {headers, signal, redirect: 'error'});
  if (!response.ok) throw new CapinfoError(response.status === 401 || response.status === 403
    ? '模型接口认证失败，请检查 API 密钥。' : '模型接口暂不可用，请稍后重试。');
  const reader = response.body.getReader();
  const chunks = []; let size = 0;
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2097152) {await reader.cancel(); throw new CapinfoError('模型列表响应过大。');}
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
  let body;
  try {body = JSON.parse(new TextDecoder().decode(bytes));}
  catch {throw new CapinfoError('模型接口返回格式无效。');}
  const rows = Array.isArray(body.data) ? body.data.map(row => [row?.id, row])
    : body.models && typeof body.models === 'object' && !Array.isArray(body.models) ? Object.entries(body.models) : [];
  const seen = new Set(), result = [];
  for (const [id, row] of rows) {
    if (typeof id !== 'string' || !id.trim() || !row || typeof row !== 'object' || Array.isArray(row) || seen.has(id)) continue;
    seen.add(id);
    const model = {id, name: typeof row.name === 'string' ? row.name : typeof row.display_name === 'string' ? row.display_name : id};
    const context = row.contextWindow ?? row.context_window ?? row.context_length ?? row.max_input_tokens;
    const cap = row.maxTokens ?? row.max_tokens ?? row.max_output_tokens;
    if (Number.isSafeInteger(context) && context > 0) model.contextWindow = context;
    if (Number.isSafeInteger(cap) && cap > 0) model.maxTokens = cap;
    const input = row.inputModalities ?? row.input_modalities ?? row.input;
    if (Array.isArray(input)) model.inputModalities = input.filter(item => item === 'text' || item === 'image');
    const correctedInput = correctVisionInput(id, model.inputModalities);
    if (correctedInput !== undefined) model.inputModalities = correctedInput;
    result.push(model);
  }
  return result;
}
