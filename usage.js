export const USAGE_TIME_ZONE = 'Asia/Shanghai';
export const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'totalTokens'];
export const usageDate = now => new Date(Number(now) + 8 * 3600_000).toISOString().slice(0, 10);
export const emptyUsage = now => ({date: usageDate(now), timeZone: USAGE_TIME_ZONE,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
  totalTokens: 0, requests: 0, updatedAt: null});
const valid = value => Number.isSafeInteger(value) && value >= 0;

/** Profile-scoped local accounting, independent of configuration and credentials. */
export class CapinfoUsage {
  constructor(store, {now = Date.now} = {}) {
    this.store = store; this.now = now; this.tail = Promise.resolve(); this.closed = false;
    this.state = structuredClone(store.get()); this.persistenceError = false;
    const history = Array.isArray(this.state.history) ? this.state.history : [this.state];
    this.state.history = history.map(row => this.normalize(row));
    this.prune();
  }
  normalize(row) {
    const result = {date: row.date, ...Object.fromEntries([...TOKEN_FIELDS, 'requests'].map(key => [key, valid(row[key]) ? row[key] : 0])),
      updatedAt: row.updatedAt ?? null, amount: Number.isFinite(row.amount) && row.amount >= 0 ? row.amount : null,
      amountUpdatedAt: row.amountUpdatedAt ?? null};
    for (const key of ['baselineUsed', 'lastUsed']) if (Number.isFinite(row[key]) && row[key] >= 0) result[key] = row[key];
    if (typeof row.amountIdentity === 'string' && /^[a-f0-9]{64}$/.test(row.amountIdentity)) result.amountIdentity = row.amountIdentity;
    return result;
  }
  persist() {
    const next = structuredClone(this.state);
    this.tail = this.tail.then(async () => {
      try { await this.store.set(next); this.persistenceError = false; }
      catch { this.persistenceError = true; }
    });
  }
  prune() {
    if (this.closed) return;
    const today = usageDate(this.now());
    const cutoff = usageDate(this.now() - 29 * 86400_000);
    this.state.history = this.state.history.filter(row => row.date >= cutoff && row.date <= today)
      .sort((a, b) => a.date.localeCompare(b.date)).slice(-30);
    const current = this.state.history.find(row => row.date === today);
    this.state = {...emptyUsage(this.now()), ...(current || {}), history: this.state.history};
    // Private amount baselines live only in history, never in the legacy today fields.
    for (const key of ['baselineUsed', 'lastUsed', 'amountIdentity', 'amount', 'amountUpdatedAt']) delete this.state[key];
    this.persist();
  }
  current() {
    this.prune();
    let row = this.state.history.find(row => row.date === this.state.date);
    if (!row) { row = this.normalize(this.state); this.state.history.push(row); }
    return row;
  }
  snapshot() {
    const now = this.now(), today = usageDate(now), cutoff = usageDate(now - 29 * 86400_000);
    const history = this.state.history.filter(row => row.date >= cutoff && row.date <= today).map(row => {
      const {baselineUsed, lastUsed, amountIdentity, ...publicRow} = row;
      return publicRow;
    });
    const current = history.find(row => row.date === today);
    return structuredClone({...emptyUsage(now), amount: null, amountUpdatedAt: null, ...(current || {}),
      history, persistenceError: this.persistenceError});
  }
  recordAmount(used, identity) {
    if (this.closed || !Number.isFinite(used) || used < 0 || typeof identity !== 'string' || !/^[a-f0-9]{64}$/.test(identity)) return;
    const row = this.current();
    const same = row.amountIdentity === identity && Number.isFinite(row.lastUsed) && used >= row.lastUsed;
    const amount = (row.amount ?? 0) + (same ? used - row.lastUsed : 0);
    if (!Number.isFinite(amount)) return;
    row.amount = amount;
    if (!same) row.baselineUsed = used;
    row.lastUsed = used; row.amountIdentity = identity;
    row.amountUpdatedAt = new Date(this.now()).toISOString();
    this.prune();
  }
  record(usage) {
    if (this.closed || !usage || !valid(usage.inputTokens) || !valid(usage.outputTokens)) return;
    const values = {};
    for (const key of TOKEN_FIELDS) {
      const value = usage[key];
      if (value !== undefined && !valid(value)) return;
      values[key] = value ?? 0;
    }
    // pi-ai total includes cached tokens; never add caches to a reported total again.
    if (usage.totalTokens === undefined) values.totalTokens = values.inputTokens + values.outputTokens + values.cacheReadTokens + values.cacheWriteTokens;
    if (!valid(values.totalTokens)) return;
    const now = this.now();
    const previous = this.current();
    const next = {...previous, requests: previous.requests + 1, updatedAt: new Date(now).toISOString()};
    for (const key of TOKEN_FIELDS) next[key] = previous[key] + values[key];
    if (!valid(next.requests) || TOKEN_FIELDS.some(key => !valid(next[key]))) return;
    Object.assign(previous, next);
    this.prune();
  }
  async close() { this.closed = true; await this.tail; }
}

/** Observe both public dispatch paths without changing prepared-call model snapshots. */
export function observeAdapterUsage(adapter, usage) {
  const observe = async function* (source, provider) {
    let recorded = false;
    for await (const chunk of source) {
      // Current PiAiAdapter emits one cumulative usage event per terminal response,
      // including error responses with reported usage. Never sum repeated snapshots.
      if (provider === 'capinfo' && chunk.type === 'usage' && !recorded) {
        recorded = true;
        usage.record(chunk.usage);
      }
      yield chunk;
    }
  };
  const stream = adapter.stream.bind(adapter);
  const prepareCall = adapter.prepareCall.bind(adapter);
  adapter.stream = options => observe(stream(options), options.provider);
  adapter.prepareCall = async (...args) => {
    const call = await prepareCall(...args);
    return {...call, stream: options => observe(call.stream(options), args[0])};
  };
  return adapter;
}
