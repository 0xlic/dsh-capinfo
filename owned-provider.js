export const DEFAULT_PROFILE = {
  displayName: 'Capinfo', apiKeyEnv: 'CAPINFO_API_KEY', api: 'openai-responses',
  baseURL: 'https://api.capinfo.com.cn/v1', models: [],
};

/** Owns configuration and route lifecycle, never publishes a configurable-provider row. */
export class OwnedCapinfoProvider {
  constructor(ctx, store, runtime) {
    this.ctx = ctx; this.store = store; this.runtime = runtime;
    this.disposeAdapter = null;
  }
  legacy() {
    const entry = this.ctx.llm.listConfigurableProviders().find(row => row.provider === 'capinfo');
    if (!entry) return undefined;
    const setting = this.ctx.settings.describe().find(row => row.ns === entry.settingsNs);
    const profile = setting?.value?.providers?.capinfo;
    if (!profile) return undefined;
    return {ns: setting.ns, revision: setting.revision, profile: structuredClone(profile)};
  }
  profile() { return structuredClone(this.store.get().profile ?? DEFAULT_PROFILE); }
  async restoreLegacy(legacy) {
    if (!legacy) return;
    const setting = this.ctx.settings.describe().find(row => row.ns === legacy.ns);
    if (!setting || setting.value?.providers?.capinfo) throw new Error('Capinfo migration rollback conflicts with another settings change.');
    await this.ctx.settings.mutate(legacy.ns,
      [{op: 'set', path: ['providers', 'capinfo'], value: legacy.profile}], setting.revision);
  }
  async start(signal) {
    signal?.throwIfAborted();
    const state = this.store.get();
    const legacy = this.legacy();
    if (state.migration?.phase === 'active' && legacy)
      throw new Error('Capinfo is plugin-managed; remove the separately re-created generic capinfo route before enabling this plugin.');
    if (state.migration?.phase === 'prepared' && legacy
      && JSON.stringify(legacy.profile) !== JSON.stringify(state.migration.backup.profile))
      throw new Error('Capinfo migration paused: the original provider changed after its backup.');
    const profile = structuredClone(state.profile ?? legacy?.profile ?? DEFAULT_PROFILE);
    // Build and validate without provider I/O before touching the old route.
    const prepared = await this.runtime.prepare(profile);
    signal?.throwIfAborted();
    const backup = legacy ?? state.migration?.backup;
    if (legacy) {
      await this.store.set({...state, profile, migration: {phase: 'prepared', backup: structuredClone(backup)}});
      try {
        await this.ctx.settings.mutate(legacy.ns, [{op: 'unset', path: ['providers', 'capinfo']}], legacy.revision);
      } catch (error) {
        // A failed persistence has not authorized taking over the live provider.
        throw error;
      }
      if (this.legacy()) throw new Error('Capinfo generic configuration is still inherited; migration stopped without registering a duplicate route.');
    }
    try {
      signal?.throwIfAborted();
      this.runtime.commit(prepared);
      if (profile.models?.length) this.disposeAdapter = this.ctx.llm.registerAdapter(['capinfo'], this.runtime.adapter);
      await this.store.set({...this.store.get(), profile,
        migration: {phase: 'active', ...(backup ? {backup: structuredClone(backup)} : {})}});
    } catch (error) {
      this.disposeAdapter?.(); this.disposeAdapter = null;
      if (legacy) {
        try { await this.restoreLegacy(legacy); }
        catch (rollback) { throw new AggregateError([error, rollback], 'Capinfo migration failed; durable backup retained for recovery.'); }
      }
      throw error;
    }
  }
  async writeProfile(profile) {
    const prepared = await this.runtime.prepare(profile);
    const previous = this.store.get();
    await this.store.set({...previous, profile: structuredClone(profile)});
    try {
      this.runtime.commit(prepared);
      if (this.disposeAdapter) this.disposeAdapter.replace(['capinfo']);
      else if (profile.models?.length)
        this.disposeAdapter = this.ctx.llm.registerAdapter(['capinfo'], this.runtime.adapter);
    } catch (error) {
      await this.store.set(previous);
      this.runtime.commit(await this.runtime.prepare(previous.profile ?? DEFAULT_PROFILE));
      throw error;
    }
  }
  credentialsChanged() { this.disposeAdapter?.replace(['capinfo']); }
  async discover(request, signal) { return this.runtime.discover(request, this.profile(), signal); }
  dispose() { this.disposeAdapter?.(); this.disposeAdapter = null; }
  inspection() {
    const configured = this.ctx.llm.listConfigurableProviders().some(row => row.provider === 'capinfo');
    const live = this.ctx.llm.listProviders().some(row => row.id === 'capinfo');
    return {management: 'plugin', genericSettingsVisible: configured, providerRegistered: live,
      migrationPhase: this.store.get().migration?.phase ?? null};
  }
}
