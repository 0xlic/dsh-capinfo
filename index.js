import Schema from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { CapinfoService, safeError } from './capinfo-service.js';
import { OwnedCapinfoProvider } from './owned-provider.js';
import { createCapinfoRuntime } from './provider-runtime.js';
import { CapinfoUsage, emptyUsage } from './usage.js';
import { CapinfoUsageService } from './usage-service.js';
import { CapinfoSpending } from './spending.js';
import { SessionRetrySettings, installSupplementalRetry } from './supplemental-retry.js';

export const name = 'capinfo-models';
export const inject = ['llm', 'settings', 'credentials', 'storageDomain', 'connection'];
export const Config = Schema.object({
  baseURL: Schema.string().description('Capinfo API URL; defaults to the existing capinfo provider URL.'),
  api: Schema.union(['openai-completions', 'openai-responses', 'anthropic-messages']).description('Protocol; defaults to the existing capinfo provider protocol.'),
  retryEnabled: Schema.boolean().default(true).volatile().description('Feature switch for per-session supplemental retries of Capinfo failures after native recovery declines.'),
}).default({});

export async function apply(ctx, config) {
  ctx.effect(() => ctx.settings.configure({auto: false}));
  const model = z.object({
    id: z.string(), name: z.string().optional(), contextWindow: z.number().optional(),
    maxTokens: z.number().optional(), input: z.array(z.string()).optional(),
  }).passthrough();
  const domain = await ctx.storageDomain.open({
    name: 'capinfo_models', version: 1, layout: 'single', tables: {},
    // Additive optional fields keep v1 candidate caches readable without destructive migration.
    global: {schema: z.object({models: z.array(model), lastSynced: z.string().nullable(),
      profile: z.record(z.string(), z.unknown()).optional(),
      migration: z.object({phase: z.enum(['prepared', 'active']),
        backup: z.object({ns: z.string(), revision: z.number(), profile: z.record(z.string(), z.unknown())}).optional(),
      }).optional(),
      // Sessions that opted into supplemental retries; absent means none.
      retrySessionIds: z.array(z.string()).optional(),
    }), initial: {models: [], lastSynced: null}},
  });
  const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
  const daily = {date: z.string(), inputTokens: count, outputTokens: count,
    cacheReadTokens: count, cacheWriteTokens: count, totalTokens: count, requests: count,
    updatedAt: z.string().nullable(), amount: z.number().finite().nonnegative().nullable(),
    amountUpdatedAt: z.string().nullable(), baselineUsed: z.number().finite().nonnegative().optional(),
    lastUsed: z.number().finite().nonnegative().optional(), amountIdentity: z.string().optional()};
  const usageDomain = await ctx.storageDomain.open({
    name: 'capinfo_usage', version: 1, layout: 'single', tables: {},
    global: {schema: z.object({date: z.string(), timeZone: z.literal('Asia/Shanghai'),
      inputTokens: count, outputTokens: count, cacheReadTokens: count, cacheWriteTokens: count,
      totalTokens: count, requests: count, updatedAt: z.string().nullable(),
      history: z.array(z.object(daily)).max(30).optional()}), initial: emptyUsage(Date.now())},
  });
  const usage = new CapinfoUsage(usageDomain.global);
  const lifetime = new AbortController();
  let service, spending, starting;
  const provider = new OwnedCapinfoProvider(ctx, domain.global, createCapinfoRuntime(ctx, config, usage));
  const featureOn = () => config.retryEnabled?.get() === true;
  const sessionRetry = new SessionRetrySettings({
    get: () => ({enabledSessionIds: domain.global.get().retrySessionIds ?? []}),
    set: async ({enabledSessionIds}) => domain.global.set({...domain.global.get(), retrySessionIds: enabledSessionIds}),
  }, featureOn);
  installSupplementalRetry(ctx, sessionRetry);
  // The volatile feature switch updates in place; revoke any wait it no longer covers.
  ctx.on('loader/volatile-update', paths => {
    if (paths.some(([field]) => field === 'retryEnabled')) sessionRetry.featureChanged();
  });
  const ensureStarted = () => {
    if (!starting) starting = provider.start(lifetime.signal).catch(error => {starting = undefined; throw error;});
    return starting;
  };
  ctx.effect(() => async () => {
    lifetime.abort();
    await sessionRetry.close();
    await spending?.stop();
    await starting?.catch(() => {});
    await service?.tail;
    provider.dispose();
    await usage.close();
    await usageDomain.close();
    await domain.close();
  });
  // Loader activation is inside an HMR transaction. Migrating legacy settings there
  // would nest another transaction, so first-run migration waits for a real settings-page read.
  // Once migrated (or on a clean install), registration is safe during activation.
  if (!provider.legacy()) await ensureStarted();
  spending = new CapinfoSpending(
    () => service.route(domain.global.get().profile ?? provider.legacy()?.profile ?? provider.profile()),
    ctx.credentials, usage);
  const usageView = {snapshot: () => ({...usage.snapshot(), spending: spending.snapshot()})};
  service = new CapinfoService(ctx, config, domain.global, provider, usageView, spending);
  const usageService = new CapinfoUsageService(ctx, usageView);
  ctx.effect(() => {
    void spending.start();
    return () => spending.stop();
  });
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/plugins/capinfo/usage', methods: ['GET'], requestBody: 'buffered',
    fetch: async () => Response.json({ok: true, usage: usageService.getSnapshot()},
      {headers: {'Cache-Control': 'no-store'}}),
  }));
  const call = async (input, signal) => {
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return {ok: false, error: '操作参数无效。'};
      await ensureStarted();
      return {ok: true, ...await service.run(input, AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]))};
    } catch (error) { return {ok: false, error: safeError(error)}; }
  };
  // Connection admits authenticated same-origin browser/API peers first.
  const jsonPost = (path, handler) => ctx.effect(() => ctx.connection.fetch.register({
    path, methods: ['POST'], requestBody: 'buffered',
    fetch: async request => {
      if (!request.headers.get('content-type')?.startsWith('application/json'))
        return Response.json({ok: false, error: '仅接受 JSON 请求。'}, {status: 415});
      const text = await request.text();
      if (text.length > 131072) return Response.json({ok: false, error: '请求过大。'}, {status: 413});
      let input;
      try { input = JSON.parse(text); }
      catch { return Response.json({ok: false, error: 'JSON 格式无效。'}, {status: 400}); }
      return Response.json(await handler(input, request.signal), {headers: {'Cache-Control': 'no-store'}});
    },
  }));
  jsonPost('/api/plugins/capinfo', (input, signal) => call(input, signal));
  // Per-session retry switch. It neither needs nor starts the provider route.
  jsonPost('/api/plugins/capinfo/retry', async (input, signal) => {
    const invalid = message => ({ok: false, error: message});
    try {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('操作参数无效。');
      const {action, sessionId, enabled} = input;
      if (Object.keys(input).some(key => !['action', 'sessionId', 'enabled'].includes(key))
        || typeof sessionId !== 'string' || !sessionId || sessionId.length > 256 || /[\u0000-\u001f\u007f]/.test(sessionId))
        return invalid('会话重试参数无效。');
      // Only sessions this profile actually holds can opt in.
      if (ctx.get('sessions')?.get && !ctx.get('sessions').get(sessionId)) return invalid('会话不存在。');
      if (action === 'status') return enabled === undefined ? {ok: true, ...sessionRetry.status(sessionId)} : invalid('会话重试参数无效。');
      if (action !== 'set' || typeof enabled !== 'boolean') return invalid('未知重试操作。');
      try {
        return {ok: true, ...await sessionRetry.set(sessionId, enabled,
          AbortSignal.any([lifetime.signal, ...(signal ? [signal] : [])]))};
      } catch { return invalid('会话重试设置未能保存，请重试。'); }
    } catch (error) { return {ok: false, error: safeError(error)}; }
  });
  // First installation uses the existing key, without reading or returning its value to the agent.
  // Running sessions retain their already-captured model configuration.
  const initialization = (async () => {
    if (!provider.legacy() && !domain.global.get().lastSynced && (await service.status()).hasApiKey)
      await call({action: 'refresh'}, lifetime.signal);
  })().catch(() => {});
  ctx.effect(() => async () => { lifetime.abort(); await initialization; });
}
