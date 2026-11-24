export class CapinfoError extends Error {}
const DEFAULT_URL = 'https://api.capinfo.com.cn/v1';
const clone = value => structuredClone(value);

/** Shared Host operations: settings UI actions call run(). */
export class CapinfoService {
  constructor(ctx, config, store, provider, usage, spending) {
    this.usage = usage;
    this.spending = spending;
    this.ctx = ctx; this.config = config; this.store = store;
    this.provider = provider;
    this.tail = Promise.resolve();
  }
  route(profile = this.provider.profile()) {
    const baseURL = this.config.baseURL || profile.baseURL || DEFAULT_URL;
    const url = new URL(baseURL);
    // API credentials must never be forwarded to arbitrary origins.
    if (url.protocol !== 'https:' || url.hostname !== 'api.capinfo.com.cn' || url.port || url.username || url.password)
      throw new CapinfoError('Capinfo 接口仅允许 https://api.capinfo.com.cn。');
    return { profile, baseURL,
      api: this.config.api || profile.api || 'openai-responses',
      keyRef: profile.apiKeyEnv || 'CAPINFO_API_KEY' };
  }
  async status() {
    const route = this.route();
    const cache = this.store.get();
    const configured = await this.ctx.credentials.describe(route.keyRef);
    const models = cache.models.length ? cache.models : (route.profile.models ?? []);
    const selectedIds = (route.profile.models ?? []).map(model => model.id);
    return { baseURL: route.baseURL, api: route.api, hasApiKey: configured.configured,
      apiKeyWritable: configured.writable !== false,
      retryEnabled: this.config.retryEnabled?.get() === true,
      retryEnabledWritable: !!this.ctx.fiber?.entry && !!this.ctx.get('configEditor'),
      models: models.map(model => ({id: model.id, name: model.name || model.id})),
      selectedIds, lastSynced: cache.lastSynced,
      ...(this.usage ? {usage: this.usage.snapshot()} : {}), ...this.provider.inspection() };
  }
  run(input, signal) {
    // ConfigEditor owns its own serialization through HMR. Do not put an edit
    // in the queue that plugin disposal waits on.
    if (input.action === 'setRetryEnabled') return this.setRetryEnabled(input, signal);
    // Serialize the storage and credential operations; failures never poison the queue.
    const result = this.tail.then(async () => {
      signal?.throwIfAborted();
      switch (input.action) {
        case 'status': return this.status();
        case 'save': return this.save(input, signal);
        case 'refresh': return this.refresh(signal);
        case 'select': return this.select(input.selectedIds, signal);
        case 'deleteApiKey': return this.deleteApiKey();
        default: throw new CapinfoError('未知 Capinfo 操作。');
      }
    });
    this.tail = result.catch(() => {});
    return result;
  }
  async setRetryEnabled(input, signal) {
    if (typeof input.retryEnabled !== 'boolean' || Object.keys(input).some(key => !['action', 'retryEnabled'].includes(key)))
      throw new CapinfoError('会话重试设置格式无效。');
    signal?.throwIfAborted();
    const entry = this.ctx.fiber?.entry;
    const editor = this.ctx.get('configEditor');
    if (!entry || !editor) throw new CapinfoError('当前配置无法保存会话重试设置。');
    try {
      await editor.edit(entry, current => ({...current, retryEnabled: input.retryEnabled}));
    } catch {
      throw new CapinfoError('会话重试设置未能保存，请刷新设置页后重试。');
    }
    return this.status();
  }
  async save(input, signal) {
    if (Object.keys(input).some(key => !['action', 'apiKey'].includes(key)))
      throw new CapinfoError('操作参数无效，请刷新设置页后重试。');
    if (input.apiKey !== undefined && (typeof input.apiKey !== 'string' || input.apiKey.length > 8192))
      throw new CapinfoError('凭据格式无效。');
    const route = this.route();
    const apiKey = input.apiKey?.trim();
    if (apiKey) {
      if (/[\r\n]/.test(apiKey)) throw new CapinfoError('API 密钥格式无效。');
      await this.ctx.credentials.set(route.keyRef, apiKey);
      void this.spending?.invalidate();
    }
    if (apiKey) {
      try { return await this.refresh(signal, true); }
      catch (error) { throw new CapinfoError('API 密钥已保存，但模型同步失败。' + safeError(error)); }
    }
    return this.status();
  }
  async refresh(signal, selectAll = false) {
    const route = this.route();
    const credential = await this.ctx.credentials.resolve(route.keyRef);
    if (!credential?.value) throw new CapinfoError('请先填写并保存 API 密钥。');
    const discovered = await this.provider.discover({
      provider: 'capinfo', baseURL: route.baseURL, api: route.api, apiKey: credential.value,
    }, AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20000)]));
    if (!Array.isArray(discovered) || !discovered.length)
      throw new CapinfoError('接口未返回模型，原有模型配置已保留。');
    if (discovered.length > 10000) throw new CapinfoError('接口返回的模型数量异常。');
    const previous = new Map([...(this.store.get().models ?? []), ...(route.profile.models ?? [])].map(row => [row.id, row]));
    const models = [];
    const seen = new Set();
    for (const row of discovered) {
      if (typeof row.id !== 'string' || !row.id.trim() || row.id.length > 512 || seen.has(row.id)) continue;
      seen.add(row.id);
      const model = {...previous.get(row.id), id: row.id, name: row.name || row.id};
      if (Number.isSafeInteger(row.contextWindow) && row.contextWindow > 0) model.contextWindow = row.contextWindow;
      if (Number.isSafeInteger(row.maxTokens) && row.maxTokens > 0) model.maxTokens = row.maxTokens;
      if (row.inputModalities?.length) model.input = row.inputModalities.filter(item => item === 'text' || item === 'image');
      models.push(model);
    }
    if (!models.length) throw new CapinfoError('接口未返回有效模型，原有配置已保留。');
    const cache = this.store.get();
    const priorIds = new Set((route.profile.models ?? []).map(row => row.id));
    const ids = selectAll || !cache.lastSynced ? models.map(row => row.id) : models.filter(row => priorIds.has(row.id)).map(row => row.id);
    // All previous selections vanished: keep configuration unchanged until user adopts replacements.
    if (!ids.length) {
      await this.store.set({...this.store.get(), models, lastSynced: new Date().toISOString()});
      throw new CapinfoError('原选中模型已全部下架，请从新列表勾选并保存；原接口配置暂时保留。');
    }
    signal?.throwIfAborted();
    await this.writeModels(models, ids, route);
    await this.store.set({...this.store.get(), models, lastSynced: new Date().toISOString()});
    return this.status();
  }
  async select(ids, signal) {
    if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string'))
      throw new CapinfoError('模型选择格式无效。');
    ids = [...new Set(ids)];
    if (!ids.length) throw new CapinfoError('自定义模型接口至少需要选择一个模型。');
    const route = this.route();
    const models = this.store.get().models.length ? this.store.get().models : (route.profile.models ?? []);
    const available = new Set(models.map(row => row.id));
    if (ids.some(id => !available.has(id))) throw new CapinfoError('所选模型不在列表中，请重新拉取。');
    signal?.throwIfAborted();
    await this.writeModels(models, ids, route);
    return this.status();
  }
  async writeModels(models, ids, route) {
    const selected = new Set(ids);
    const profile = {...clone(route.profile), displayName: 'capinfo', api: route.api,
      baseURL: route.baseURL, apiKeyEnv: route.keyRef, models: models.filter(model => selected.has(model.id))};
    delete profile.modelOverrides;
    try {
      await this.provider.writeProfile(profile);
    } catch { throw new CapinfoError('保存插件模型配置失败，原配置已保留，请重试。'); }
    // Respect the optional native-picker filter, leaving every other provider untouched.
    const filter = this.ctx.settings.describe().find(row => /(?:^|:)scoped-models$/.test(row.ns));
    if (filter?.value?.enabled && Array.isArray(filter.value.models)) {
      const next = [...filter.value.models.filter(row => row.provider !== 'capinfo'), ...ids.map(model => ({provider: 'capinfo', model}))];
      try { await this.ctx.settings.mutate(filter.ns, [{op: 'set', path: ['models'], value: next}], filter.revision); }
      catch { throw new CapinfoError('接口模型已保存，但模型筛选同步失败，请重新保存勾选。'); }
    }
  }
  async deleteApiKey() {
    const {keyRef} = this.route();
    const info = await this.ctx.credentials.describe(keyRef);
    if (info.writable === false) throw new CapinfoError('当前凭据存储只读，无法删除 API 密钥。');
    await this.ctx.credentials.unset(keyRef);
    void this.spending?.invalidate();
    this.provider.credentialsChanged?.();
    // Ambient fallbacks may still resolve after deleting the locally saved value.
    // Do not remove the model configuration.
    return this.status();
  }

}

export function safeError(error) {
  // Do not leak remote response bodies, headers, tokens, or arbitrary thrown text.
  return error instanceof CapinfoError
    ? error.message : '请求失败，请检查网络、密钥或接口状态后重试。';
}
