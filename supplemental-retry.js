import {randomUUID} from 'node:crypto';
import {setTimeout as sleep} from 'node:timers/promises';

// Exact waits requested for session-level recovery: 5 s, 10 s, 20 s, then 30 s forever.
const DELAYS_MS = [5000, 10000, 20000, 30000];
// Deliberately distinct from the policy keys used by the built-in executor.
const POLICY_KEY = 'capinfo:supplemental-retry:v2';

/**
 * Per-session opt-ins backed by plugin storage. Only explicit opt-ins are stored;
 * every open backoff observes a cancellable signal so switching a session (or the
 * whole feature) off stops pending retries without touching other sessions.
 */
export class SessionRetrySettings {
  constructor(store, available) {
    this.store = store;
    this.available = available;
    this.enabled = new Set(store.get().enabledSessionIds);
    this.controllers = new Map();
    this.tail = Promise.resolve();
    this.closed = false;
  }
  status(sessionId) {
    const available = !this.closed && this.available();
    return {available, enabled: available && this.enabled.has(sessionId)};
  }
  /** Signal that aborts when this session's opt-in ends; undefined while it is off. */
  signal(sessionId) {
    if (!this.status(sessionId).enabled) return undefined;
    let controller = this.controllers.get(sessionId);
    if (!controller) this.controllers.set(sessionId, controller = new AbortController());
    return controller.signal;
  }
  cancel(sessionId) {
    const controller = this.controllers.get(sessionId);
    this.controllers.delete(sessionId);
    controller?.abort();
  }
  /** Abort every pending backoff that the feature switch no longer covers. */
  featureChanged() {
    if (this.closed || !this.available()) for (const id of [...this.controllers.keys()]) this.cancel(id);
  }
  /** Persist one opt-in; a failed write leaves memory and pending waits untouched. */
  set(sessionId, enabled, signal) {
    const operation = this.tail.then(async () => {
      signal?.throwIfAborted();
      if (this.closed || !this.available() || this.enabled.has(sessionId) === enabled) return this.status(sessionId);
      const next = new Set(this.enabled);
      if (enabled) next.add(sessionId);
      else next.delete(sessionId);
      await this.store.set({enabledSessionIds: [...next]});
      this.enabled = next;
      if (!enabled) this.cancel(sessionId);
      return this.status(sessionId);
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
  async close() {
    this.closed = true;
    this.featureChanged();
    await this.tail;
  }
}

function isSupplementalFailure(failure) {
  const message = typeof failure?.message === 'string' ? failure.message.trim() : '';
  return (failure?.code === 'PI_AI_ERROR' && /^gateway_concurrency_limit(?:\s*:|$)/i.test(message))
    || (failure?.code === 'TRANSPORT' && /^terminated$/i.test(message));
}

/**
 * Add session-opt-in retries at the existing failed-step recovery boundary,
 * after built-in and other recovery paths decline. Provider retry policies are untouched.
 */
export function installSupplementalRetry(ctx, sessionSettings, {wait = sleep} = {}) {
  const lifetime = new AbortController();
  // Track the retry chain per running step without strong references to sessions.
  const steps = new WeakMap();
  const remove = ctx.on('agent/request-error', async (event, next) => {
    const {agent, provider, turn, step, failure, signal} = event;
    // Ask native recovery first, even for failures we could handle ourselves.
    const action = await next();
    if (action !== undefined || lifetime.signal.aborted || signal.aborted
      || provider !== 'capinfo' || !isSupplementalFailure(failure)) return action;

    const session = agent.session;
    const sessionSignal = sessionSettings.signal(session.id);
    // Not opted in: the turn fails exactly as it would without this plugin.
    if (sessionSignal === undefined) return action;

    let entry = steps.get(session);
    if (!entry || entry.turn !== turn || entry.step !== step) {
      entry = {turn, step, retry: 0, retryId: randomUUID()};
      steps.set(session, entry);
    }
    const retry = ++entry.retry;
    const {retryId} = entry;
    const delayMs = DELAYS_MS[Math.min(retry, DELAYS_MS.length) - 1];
    const waitSignal = AbortSignal.any([signal, lifetime.signal, sessionSignal]);
    // Standard non-surface events power DSH's own "（n/∞）" retry row; never model history.
    session.append('llm/retry', {retryId, turn, step, provider, mode: 'always',
      policyKey: POLICY_KEY, retry, delayMs, failure});
    try {
      await wait(delayMs, undefined, {signal: waitSignal});
    } catch (error) {
      if (waitSignal.aborted) return;
      throw error;
    }
    // The opt-in or the feature may have been switched off while waiting.
    if (waitSignal.aborted || !sessionSettings.status(session.id).enabled) return;
    session.append('llm/retry-started', {retryId, turn, step, retry});
    return {kind: 'retry'};
  }, {prepend: true});
  ctx.effect(() => () => {
    remove?.();
    lifetime.abort();
  });
}
