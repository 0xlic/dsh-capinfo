import { PiAiAdapter, Config as PiAiConfig } from '@deepseek-ai/dsh-llm-pi-ai';
import { LlmError, assertUsableApiKey, resolveRetryPolicy, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createProvider } from '@earendil-works/pi-ai/models';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { capinfoModelFields } from './provider-profile.js';
import { discoverCapinfoModels } from './model-discovery.js';
import { DEFAULT_PROFILE } from './owned-provider.js';
import { observeAdapterUsage } from './usage.js';

const factories = {'openai-responses': openAIResponsesApi, 'openai-completions': openAICompletionsApi,
  'anthropic-messages': anthropicMessagesApi};

/** Reuses the installed Harness history, tools, images, replay and streaming implementation. */
export function createCapinfoRuntime(ctx, config, usage) {
  let current = new Map();
  const adapterConfig = profiles => ({
    profiles,
    resolveApiKey: async (_provider, profile) => {
      const ref = profile.apiKeyEnv;
      const value = (await ctx.credentials.resolve(ref))?.value;
      if (!value) throw new LlmError('Capinfo API credential is not configured.', 'MISSING_CREDENTIAL');
      return assertUsableApiKey(value, 'capinfo', ref);
    },
    // Capinfo auth is exclusively the explicit, per-operation Harness credential.
    auth: {authContext: {env: async () => undefined, fileExists: async () => false}},
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
  });
  const adapter = new PiAiAdapter(adapterConfig(() => current));
  if (usage) observeAdapterUsage(adapter, usage);
  return {
    adapter,
    async prepare(raw) {
      const source = {...DEFAULT_PROFILE, ...structuredClone(raw),
        ...(config.baseURL ? {baseURL: config.baseURL} : {}), ...(config.api ? {api: config.api} : {})};
      const normalized = PiAiConfig({providers: {capinfo: source}}).providers.get().capinfo;
      const {models, configuredMaxTokens} = capinfoModelFields(normalized);
      if (!models.length) return new Map();
      const displayName = !normalized.displayName || normalized.displayName === 'capinfo'
        ? 'Capinfo' : normalized.displayName;
      const piProvider = createProvider({
        id: 'capinfo', name: displayName, baseUrl: normalized.baseURL, models,
        api: factories[normalized.api](),
        auth: {apiKey: {name: 'Capinfo', resolve: ({credential}) => Promise.resolve({
          auth: credential?.key === undefined ? {} : {apiKey: credential.key}, source: 'Capinfo',
        })}},
      });
      const profile = {...normalized, provider: 'capinfo', displayName,
        apiKeyEnv: credentialRef(normalized.apiKeyEnv || 'CAPINFO_API_KEY'),
        retryPolicy: resolveRetryPolicy(normalized.retryPolicy, 'capinfo'),
        configuredMaxTokens, modelErrors: new Map(), piProvider};
      const profiles = new Map([['capinfo', profile]]);
      const candidate = new PiAiAdapter(adapterConfig(() => profiles));
      // Resolve each exact model without credentials or network I/O before adoption.
      for (const model of models) await candidate.resolveModel('capinfo', model.id);
      return profiles;
    },
    commit(profiles) {current = profiles;},
    discover: (request, profile, signal) => discoverCapinfoModels(request, profile, signal),
  };
}
