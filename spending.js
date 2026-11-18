import {createHash} from 'node:crypto';

const ERROR = '消费统计暂不可用，请稍后重试。';
const ENDPOINT = 'https://api.capinfo.com.cn/v1/user/balance';

/** Samples only the trusted Capinfo balance endpoint; never exposes response bodies or credentials. */
export class CapinfoSpending {
  constructor(routeFunction, credentials, usage, options = {}) {
    this.routeFunction = routeFunction; this.credentials = credentials; this.usage = usage;
    this.fetch = options.fetch ?? globalThis.fetch; this.now = options.now ?? Date.now;
    this.setInterval = options.setInterval ?? globalThis.setInterval;
    this.clearInterval = options.clearInterval ?? globalThis.clearInterval;
    this.state = {status: 'pending', checkedAt: null, error: null};
    this.generation = 0; this.stopped = false; this.timer = null; this.inflight = null; this.controller = null;
  }
  snapshot() { return {...this.state}; }
  start() {
    this.stopped = false;
    if (this.timer === null) {
      this.timer = this.setInterval(() => {void this.refresh();}, 60_000);
      this.timer?.unref?.();
    }
    return this.refresh();
  }
  cancel() {
    this.generation++;
    this.controller?.abort(); this.controller = null; this.inflight = null;
  }
  stop() {
    this.stopped = true;
    if (this.timer !== null) this.clearInterval(this.timer);
    this.timer = null; this.cancel();
  }
  invalidate() {
    this.cancel();
    if (this.stopped) return Promise.resolve(this.snapshot());
    return this.refresh();
  }
  refresh() {
    if (this.stopped) return Promise.resolve(this.snapshot());
    if (this.inflight) return this.inflight;
    const generation = this.generation;
    const controller = new AbortController(); this.controller = controller;
    const live = () => !this.stopped && generation === this.generation && !controller.signal.aborted;
    this.state = {...this.state, status: 'pending', error: null};
    let timeout;
    const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(new Error('cancelled')), {once: true}));
    const work = async () => {
      this.usage.prune?.();
      const route = this.routeFunction();
      if (!route?.keyRef || !route?.baseURL) return 'unconfigured';
      const base = new URL(route.baseURL);
      if (base.origin !== 'https://api.capinfo.com.cn' || base.username || base.password) throw new Error('origin');
      const credential = await this.credentials.resolve(route.keyRef);
      if (!live()) return;
      const key = credential?.value;
      if (typeof key !== 'string' || !key.trim()) return 'unconfigured';
      const response = await this.fetch(ENDPOINT, {method: 'GET', redirect: 'error', signal: controller.signal,
        headers: {'Authorization': `Bearer ${key}`, 'User-Agent': 'cc-switch/1.0', 'Accept': 'application/json'}});
      if (!live()) return;
      if (!response.ok || response.redirected) throw new Error('http');
      const body = await response.json();
      if (!live()) return;
      if (!body || body.success !== true || body.source !== 'api_key' || body.currency !== 'CNY' || body.unit !== 'CNY'
          || body.is_active !== true || (body.status !== undefined && body.status !== 'active')
          || typeof body.used !== 'number' || !Number.isFinite(body.used) || body.used < 0) throw new Error('format');
      const identity = createHash('sha256').update(key).digest('hex');
      this.usage.recordAmount(body.used, identity);
      return 'ready';
    };
    timeout = setTimeout(() => controller.abort(), 20_000); timeout.unref?.();
    const pending = Promise.race([Promise.resolve().then(work), aborted]).then(status => {
      if (live()) this.state = {status, checkedAt: new Date(this.now()).toISOString(), error: null};
    }, () => {
      // Timeout is an error, but superseded/stopped requests may not change any state.
      if (!this.stopped && generation === this.generation)
        this.state = {status: 'error', checkedAt: new Date(this.now()).toISOString(), error: ERROR};
    }).finally(() => {
      clearTimeout(timeout);
      if (this.inflight === pending) {this.inflight = null; this.controller = null;}
    }).then(() => this.snapshot());
    this.inflight = pending;
    return pending;
  }
}
