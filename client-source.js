import {createUsageChartComponent} from './usage-chart.js';
import {formatUnitCost} from './usage-chart-options.js';

window.__ModuleLoader__.load({
  id: '@local/dsh-capinfo',
  factory(require) {
    const React = require('react');
    const ReactDOM = require('react-dom');
    const h = React.createElement;
    // Desktop/worker pages own a Host transport; page-origin fetch cannot reach its API.
    // Keep paths relative so browser deployments also respect their application mount.
    const fetch = (input, init) => {
      const transport = globalThis.__DSH_TRANSPORT__;
      return transport?.fetch ? transport.fetch(input, init) : globalThis.fetch(input, init);
    };
    const en = {
      title: 'Capinfo models', intro: 'Manage your API key and available models.',
      panel: 'Capinfo dashboard', close: 'Close',
      connection: 'API connection', apiKey: 'API key', configured: 'Configured', notConfigured: 'Not configured',
      credentialHint: 'Leave blank to keep the saved credential. Credentials are never displayed.',
      deleteKey: 'Delete credential', confirmDeleteKey: 'Confirm deletion', cancel: 'Cancel', secretPlaceholder: '••••••••••••',
      deleteKeyHint: 'Delete the saved API key? Model configuration will be kept.',
      keyDeleted: 'Saved API credential deleted.', keyDeletedFallback: 'Local credential deleted, but an environment fallback still supplies an API key.',
      saveKey: 'Save key and sync models', models: 'Available models', modelHint: 'Select at least one model for use in the model picker. Refresh keeps your saved selections.',
      search: 'Search models', selectAll: 'Select all results', clearAll: 'Clear results', saveSelection: 'Save selection',
      modelContext: 'Context: {length}',
      refresh: 'Refresh models', empty: 'Save an API key to load models.', noMatches: 'No matching models.',
      retryMode: 'Session retry feature',
      retryModeHint: 'On by default. While on, sessions that use a Capinfo model show a “Session retry” switch in the model menu; turning this off removes that switch and stops every pending supplemental retry. Built-in retries are unchanged.',
      retryModeReadOnly: 'This setting cannot be changed in the current profile.',
      retryModeCost: 'Changes save immediately. Retries may incur charges.',
      retryModeUnverified: 'Could not verify the current setting. Reload its status before changing it again.',
      retryModeReload: 'Reload retry status', retryModeVerified: 'Retry status verified.',
      sessionRetry: 'Session retry',
      sessionRetryHint: 'This session only. When Capinfo rate limiting (gateway_concurrency_limit) or a dropped connection (terminated) is left unhandled by built-in retries, keep retrying without a limit: wait 5, 10, then 20 seconds, then every 30 seconds. Stop the turn to cancel. Retries may incur charges.',
      count: '{selected} selected · {total} models', synced: 'Last synced: {time}', never: 'Not yet synced',
      unknown: '--', saving: 'Working…', loading: 'Loading…', retry: 'Retry', saved: 'Saved.',
      refreshed: 'Models refreshed.', error: 'The request failed. Please retry.', failed: 'Operation failed:',
      selectRequired: 'Select at least one model.', unsaved: 'Unsaved selection', endpoint: 'Endpoint', protocol: 'API protocol',
      keyRequired: 'Save an API key first.',
      usageChartKeys: 'Use Left and Right arrows to select a day, Home and End for the first and last day, and Escape to close the tooltip.',
      usageTitle: 'Today’s usage', usageChartError: 'Chart unavailable. Reopen the dashboard to retry.',
      usageAmount: 'Cost', usageTodayTokens: 'Token',
      usageHistory: 'Usage over the last 30 days', usageMissing: 'No data', usageUnitCost: 'Cost per million', usageTokenChart: 'Token usage',
      usageAmountUpdated: 'Data refreshed:',
      usageUnconfigured: 'Configure an API key to sample spending.', usageSamplingError: 'Spending sampling failed:',
      usagePersistenceError: 'Usage could not be persisted; data may be lost after restart.',
      usageChartDescription: 'Blue bars show daily token usage on Beijing calendar dates. Select a date to view cost, tokens, and cost per million tokens. Missing samples display as zero without changing recorded usage.',
      usageSnapshotError: 'Host usage snapshot unavailable. Any retained same-day data is stale; automatic retry in 30 seconds.',
    };
    const zh = {
      title: 'Capinfo 模型', intro: '管理 API 密钥和可用模型。',
      panel: 'Capinfo看板', close: '关闭',
      connection: 'API 连接', apiKey: 'API 密钥', configured: '已配置', notConfigured: '未配置',
      credentialHint: '留空保留已存凭据，页面不会回显密钥。',
      deleteKey: '删除凭证', confirmDeleteKey: '确认删除', cancel: '取消', secretPlaceholder: '••••••••••••',
      deleteKeyHint: '确定删除已保存的 API 密钥？模型配置将保留。',
      keyDeleted: '已删除保存的 API 凭证。', keyDeletedFallback: '本地凭证已删除，但环境中的备用密钥仍然生效。',
      saveKey: '保存密钥并同步模型', models: '可用模型', modelHint: '至少选择一个模型，用于模型选择器。刷新会保留已保存的勾选。',
      search: '搜索模型', selectAll: '全选搜索结果', clearAll: '清空搜索结果勾选', saveSelection: '保存勾选',
      modelContext: '上下文 {length}',
      refresh: '刷新模型', empty: '保存 API 密钥后加载模型。', noMatches: '没有匹配的模型。',
      retryMode: '会话重试功能',
      retryModeHint: '默认开启。开启时，使用 Capinfo 模型的会话会在模型菜单中显示「会话重试」开关；关闭后该开关消失，并停止所有等待中的追加重试。原生重试策略不变。',
      retryModeReadOnly: '当前配置档案不允许修改此设置。',
      retryModeCost: '更改会立即保存，重试可能产生费用。',
      retryModeUnverified: '无法确认当前设置。请重新读取状态后再更改。',
      retryModeReload: '重新读取重试状态', retryModeVerified: '已确认重试状态。',
      sessionRetry: '会话重试',
      sessionRetryHint: '仅对当前会话生效。Capinfo 限流（gateway_concurrency_limit）或连接中断（terminated）且原生重试未接手时，无限追加重试：依次等待 5、10、20 秒，之后每 30 秒一次。停止本轮可取消；重试可能产生费用。',
      count: '已选 {selected} 个 · 共 {total} 个模型', synced: '上次同步：{time}', never: '尚未同步',
      unknown: '--', saving: '处理中…', loading: '正在加载…', retry: '重试', saved: '已保存。',
      refreshed: '模型已刷新。', error: '请求失败，请重试。', failed: '操作失败：',
      selectRequired: '请至少选择一个模型。', unsaved: '勾选尚未保存', endpoint: '接口地址', protocol: 'API 协议',
      keyRequired: '请先保存 API 密钥。',
      usageChartKeys: '左右方向键切换日期，Home 和 End 跳到首日和末日，Esc 关闭提示。',
      usageTitle: '今日用量', usageChartError: '图表暂不可用，请重新打开看板重试。',
      usageAmount: '费用', usageTodayTokens: 'Token',
      usageHistory: '近 30 天用量', usageMissing: '暂无数据', usageUnitCost: '单位成本', usageTokenChart: 'Token 用量',
      usageAmountUpdated: '数据刷新时间：',
      usageUnconfigured: '配置 API 密钥后可采样消费金额。', usageSamplingError: '消费金额采样失败：',
      usagePersistenceError: '用量持久化失败，重启后数据可能丢失。',
      usageChartDescription: '蓝色柱状图展示北京时间的每日 Token 用量。选择日期可查看当天费用、Token 和每百万 Token 的单位成本。缺测按 0 展示，不修改原始统计。',
      usageSnapshotError: 'Host 用量快照读取失败；保留的同日数据已过时，30 秒后自动重试。',
    };
    // Scoped styles are owned by the mounted components; no global DOM effects.
    const css = `
.capinfo-settings{color:var(--dsw-alias-label-primary);font-size:14px;line-height:1.5;max-width:880px;width:100%;min-width:0;box-sizing:border-box;padding:24px;display:flex;flex-direction:column;gap:24px}
.capinfo-settings *{box-sizing:border-box}.capinfo-settings h2{font-size:20px;font-weight:600;line-height:1.4;margin:0 0 4px}.capinfo-settings h3{font-size:16px;font-weight:600;margin:0}.capinfo-settings p{margin:0}.capinfo-muted{color:var(--dsw-alias-label-secondary);font-size:13px}.capinfo-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:16px;background:var(--dsw-alias-bg-layer-1)}
.capinfo-overlay{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center}
.capinfo-mask{position:absolute;inset:var(--dsh-frame-chrome-top,0px) 0 0;background:var(--dsw-alias-bg-mask-1);backdrop-filter:var(--dsw-mask-blur)}
.capinfo-dialog{position:relative;z-index:1;display:flex;flex-direction:column;width:min(880px,calc(100vw - 48px));max-height:calc(100vh - 2*max(24px,var(--dsh-frame-overlay-top,24px)));border-radius:var(--dsw-radius-panel);overflow:hidden;background:var(--dsw-alias-bg-layer-2);box-shadow:var(--dsw-elevation-prominent);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2)}
.capinfo-dialog:focus{outline:none}
.capinfo-dialog-close{position:absolute;top:12px;right:12px;z-index:2;display:inline-flex;align-items:center;justify-content:center;flex:none;width:30px;height:30px;border:none;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
@media(hover:hover){.capinfo-dialog-close:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.capinfo-dialog-close:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.capinfo-dialog-body{flex:1;min-height:0;overflow-y:auto;padding:20px 24px 24px}
.capinfo-usage{display:flex;flex-direction:column;gap:6px}.capinfo-usage-updated{font-size:12px}
.capinfo-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.capinfo-summary-item{display:flex;align-items:baseline;gap:8px;min-width:0}.capinfo-summary-item>span{flex-shrink:0}.capinfo-summary-item strong{font-size:26px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.capinfo-summary-item--unit{grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:baseline;column-gap:8px;row-gap:2px;color:var(--dsw-alias-label-secondary);font-size:13px}.capinfo-summary-item--unit strong{color:var(--dsw-alias-label-primary);font-size:15px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.capinfo-chart{min-width:0;width:100%;margin:8px 0 0}.capinfo-chart figcaption{font-weight:600;margin-bottom:8px}.capinfo-chart-host{position:relative;width:100%;height:288px;min-width:0;user-select:none}.capinfo-chart-host:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.capinfo-sr-only{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}.capinfo-chart-error{padding:16px;color:var(--dsw-alias-state-error-primary)}
.capinfo-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.capinfo-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.capinfo-field{display:flex;flex-direction:column;gap:6px;min-width:0}.capinfo-field>span{font-size:13px;font-weight:500}
.capinfo-settings input:not([type=checkbox]){width:100%;min-width:0;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;padding:8px 12px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;line-height:20px}.capinfo-settings input::placeholder{color:var(--dsw-alias-label-secondary)}
.capinfo-settings button{border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);padding:7px 12px;font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}.capinfo-settings button:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}.capinfo-settings button.capinfo-primary{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);border-color:var(--dsw-alias-brand-primary)}.capinfo-settings button.capinfo-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(.96)}
.capinfo-settings :is(input,button):focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}.capinfo-settings :disabled{opacity:.5;cursor:not-allowed}.capinfo-settings input[type=checkbox]{accent-color:var(--dsw-alias-brand-primary);width:16px;height:16px;flex-shrink:0;margin:0}
.capinfo-retry-row{flex-wrap:nowrap}.capinfo-settings button.capinfo-switch{position:relative;flex:none;width:40px;height:24px;padding:0;border-radius:999px;background:var(--dsw-alias-bg-layer-2)}.capinfo-settings button.capinfo-switch:hover:not([aria-disabled=true]){border-color:var(--dsw-alias-label-secondary)}.capinfo-settings button[aria-disabled=true]{opacity:.5;cursor:not-allowed}.capinfo-settings button.capinfo-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary)}.capinfo-switch::before{content:'';position:absolute;inset-block-start:3px;inset-inline-start:3px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-label-secondary)}.capinfo-switch[aria-checked=true]::before{inset-inline-start:19px;background:var(--dsw-alias-bg-base)}
.capinfo-list{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;max-height:320px;overflow:auto}.capinfo-model{display:flex;align-items:center;gap:12px;min-height:56px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:pointer}.capinfo-model:last-child{border-bottom:0}.capinfo-model:hover{background:var(--dsw-alias-bg-layer-2)}.capinfo-model-text{min-width:0;overflow-wrap:anywhere}.capinfo-model-text small{display:block;color:var(--dsw-alias-label-secondary);font-size:12px}.capinfo-empty{padding:24px;text-align:center;color:var(--dsw-alias-label-secondary)}
.capinfo-endpoint{overflow-wrap:anywhere}.capinfo-notice{font-size:13px;color:var(--dsw-alias-state-success-primary)}.capinfo-error{color:var(--dsw-alias-state-error-primary)}.capinfo-pending{color:var(--dsw-alias-state-warn-primary)}
.capinfo-configured{color:var(--dsw-alias-state-success-primary);font-size:13px;font-weight:500}.capinfo-settings button.capinfo-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.capinfo-session-retry{display:flex;align-items:center;justify-content:space-between;box-sizing:border-box;width:100%;min-height:34px;padding:0 8px;gap:16px;border:0;border-radius:var(--dsw-radius-md);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;text-align:start;cursor:pointer}
@media(hover:hover){.capinfo-session-retry:hover:not([aria-disabled=true]){background:var(--dsw-alias-interactive-bg-hover)}}
.capinfo-session-retry:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:1px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:-1px}
.capinfo-session-retry[aria-disabled=true]{color:var(--dsw-alias-label-dimmed);cursor:default}
.capinfo-session-retry-track{position:relative;display:inline-block;flex:none;width:36px;height:20px;border-radius:999px;background:var(--dsw-alias-border-l2);transition:background-color 120ms ease-in-out}
.capinfo-session-retry-thumb{position:absolute;inset-block-start:2px;inset-inline-start:2px;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:inset-inline-start 120ms ease-in-out}
.capinfo-session-retry-track[data-on]{background:var(--dsw-alias-brand-primary)}
.capinfo-session-retry-track[data-on] .capinfo-session-retry-thumb{inset-inline-start:18px}
@media(prefers-reduced-motion:reduce){.capinfo-session-retry-track,.capinfo-session-retry-thumb{transition:none}}
@media(max-width:600px){.capinfo-chart-host{height:280px}.capinfo-summary{gap:12px}.capinfo-summary-item{gap:4px}.capinfo-summary-item strong{font-size:clamp(14px,3.5vw,22px)}.capinfo-settings{padding:16px;gap:20px}.capinfo-card{padding:16px}.capinfo-settings h2{font-size:18px}.capinfo-dialog-body{padding:16px}}`;

    // Beijing uses UTC+8 year-round; do not depend on the browser's time zone.
    const usageDay = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
    const currentUsage = value => value?.date === usageDay() && value.timeZone === 'Asia/Shanghai' ? value : null;

    const validAmount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
    const validTokens = value => Number.isSafeInteger(value) && value >= 0;
    const formatContext = value => {
      if (!validTokens(value) || value === 0) return null;
      if (value < 1e3) return String(value);
      const thousands = Math.round(value / 100) / 10;
      // A single decimal keeps 1,048,576 at the model-card shorthand of 1M.
      return thousands >= 1e3 ? `${Math.round(value / 1e5) / 10}M` : `${thousands}K`;
    };
    const currency = value => `¥${(validAmount(value) ? value : 0).toFixed(2)}`;
    // Below 10,000 the exact count is short enough to show; above it, group by
    // yi/wan and drop the sub-group remainder so the headline stays compact.
    const tokenCount = value => {
      if (!validTokens(value)) return null;
      if (value < 10000) return String(value);
      const yi = Math.floor(value / 100000000);
      const wan = Math.floor(value % 100000000 / 10000);
      return `${yi ? `${yi}亿` : ''}${wan ? `${wan}万` : ''}`;
    };
    // Calendar slots, not the last 30 samples. Missing days remain explicitly unknown.
    function usageDays(value) {
      const today = usageDay();
      const end = Date.parse(`${today}T00:00:00Z`);
      const history = new Map((Array.isArray(value?.history) ? value.history : [])
        .filter(row => row && typeof row.date === 'string').map(row => [row.date, row]));
      if (value) history.set(today, value);
      return Array.from({ length: 30 }, (_, index) => {
        const date = new Date(end - (29 - index) * 86400000).toISOString().slice(0, 10);
        const row = history.get(date);
        return { date, amount: validAmount(row?.amount) ? row.amount : null,
          totalTokens: validTokens(row?.totalTokens) ? row.totalTokens : null };
      });
    }

    // Keep the latest same-day snapshot across dashboard closes in this client.
    let latestUsage = null;
    // Profile-scoped usage has its own lifecycle, unrelated to credentials.
    function createUsageSync(onChange) {
      return {
        start() {
          let mounted = true, controller = null, midnight = null;
          let current = currentUsage(latestUsage);
          const publish = value => { current = currentUsage(value); latestUsage = current; onChange(current); };
          publish(current);
          const poll = async () => {
            if (!mounted) return;
            if (current && !currentUsage(current)) publish(null);
            if (controller) return;
            const request = new AbortController();
            controller = request;
            const active = () => mounted && controller === request;
            try {
              const response = await fetch('api/plugins/capinfo/usage', {
                method: 'GET', credentials: 'same-origin', cache: 'no-store',
                signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]),
              });
              if (!active()) return;
              const body = await response.json();
              if (!active()) return;
              if (!response.ok || body?.ok !== true || !body.usage) throw new Error('usage');
              publish(body.usage);
            } catch {
              // Isolate failures; never show yesterday's cached usage, even when offline.
              if (active()) publish(current);
            } finally {
              if (controller === request) controller = null;
            }
          };
          const scheduleMidnight = () => {
            const dayMs = 86400000;
            midnight = setTimeout(() => {
              if (!mounted) return;
              publish(null);
              void poll();
              scheduleMidnight();
            }, dayMs - ((Date.now() + 8 * 3600000) % dayMs));
          };
          void poll();
          const timer = setInterval(() => { void poll(); }, 30000);
          scheduleMidnight();
          return () => {
            mounted = false;
            clearInterval(timer);
            clearTimeout(midnight);
            if (controller) controller.abort();
            controller = null;
          };
        },
      };
    }

    // Inline monochrome glyphs inherit the host theme and need no extra module.
    const iconProps = size => ({width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true', focusable: 'false'});
    // Simplified supplied lotus: three petals, a sun and one water/bowl line.
    const lotusIcon = size => h('svg', {...iconProps(size), stroke: 'currentColor', strokeWidth: 1.25,
      strokeLinecap: 'round', strokeLinejoin: 'round'},
      h('path', {d: 'M8 1.5C5 4 5.4 6.7 8 8.5c2.6-1.8 3-4.5 0-7ZM5.3 8.7C2.5 8.5 1.8 6.4 2.1 4.5c1.2.1 2.1.5 2.8 1.2M10.7 8.7c2.8-.2 3.5-2.3 3.2-4.2-1.2.1-2.1.5-2.8 1.2'}),
      h('circle', {cx: 8, cy: 10.3, r: 1.3}),
      h('path', {d: 'M1.5 12.3c4 2.9 9 2.9 13 0M1.5 12.3h13'}));
    const closeIcon = size => h('svg', iconProps(size),
      h('path', {d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6', stroke: 'currentColor', 'stroke-width': '1.6', 'stroke-linecap': 'round'}));

    return {
      inject: ['slots', 'locale', 'layout'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('capinfo', 'en', en));
        ctx.effect(() => ctx.locale.register('capinfo', 'zh', zh));
        const t = ctx.locale.bind('capinfo');
        const UsageChart = createUsageChartComponent(React, t);
        const subscribe = (listener) => ctx.locale.subscribe(listener);
        const snapshot = () => ctx.locale.getSnapshot();

        // The settings page and every open composer share one tab: tell the
        // composer switches at once when the feature switch changes there.
        const retryFeatureListeners = new Set();
        const notifyRetryFeature = () => { for (const listener of retryFeatureListeners) listener(); };
        const subscribeRetryFeature = (listener) => {
          retryFeatureListeners.add(listener);
          return () => retryFeatureListeners.delete(listener);
        };

        // Settings keeps only configuration: API credentials, request retry and model selection.
        function SettingsSection() {
          React.useSyncExternalStore(subscribe, snapshot, snapshot);
          const [state, setState] = React.useState(null);
          const [busy, setBusy] = React.useState('status');
          const [notice, setNotice] = React.useState(null);
          const [apiKey, setApiKey] = React.useState('');
          const [confirmDelete, setConfirmDelete] = React.useState(false);
          const [search, setSearch] = React.useState('');
          const [selected, setSelected] = React.useState([]);
          const [retryNotice, setRetryNotice] = React.useState(null);
          const lifecycle = React.useRef({ mounted: false, controller: null });
          const uid = React.useId();
          const drafts = React.useRef(null);
          drafts.current = { state, selected, retryNotice };

          const request = React.useCallback(async (action, params = {}, onSuccess) => {
            const life = lifecycle.current;
            const retryWrite = action === 'setRetryEnabled';
            const retryUnverified = drafts.current.retryNotice?.unverified;
            const retryReload = action === 'status' && retryUnverified;
            if (!life.mounted || life.controller || (retryWrite && retryUnverified)) return;
            const controller = new AbortController();
            life.controller = controller;
            setBusy(action);
            if (retryWrite) setRetryNotice(null);
            else if (!retryReload) setNotice(null);
            const active = () => life.mounted && life.controller === controller;
            const send = async (operation, values = {}) => {
              const response = await fetch('api/plugins/capinfo', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action: operation, ...values }), signal: controller.signal,
              });
              const data = await response.json();
              return { response, data };
            };
            // Reconcile persisted state without overwriting any unsaved inputs.
            const acceptStatus = data => {
              const draft = drafts.current;
              const saved = draft.state?.selectedIds || [];
              const chosen = new Set(draft.selected);
              const selectionDirty = draft.selected.length !== saved.length || saved.some(id => !chosen.has(id));
              if (!draft.state || !selectionDirty) setSelected(Array.isArray(data.selectedIds) ? data.selectedIds : []);
              setState(data);
              if (retryUnverified && typeof data.retryEnabled === 'boolean') setRetryNotice({ key: 'retryModeVerified' });
            };
            const reconcile = async () => {
              try {
                const { response, data } = await send('status');
                if (!active() || !response.ok || data?.ok !== true ||
                    (retryWrite && typeof data.retryEnabled !== 'boolean')) return false;
                acceptStatus(data);
                return true;
              } catch { return false; }
            };
            const reportFailure = async (key, detail = null) => {
              // A mutation may have saved a value despite the failure. Read once; never replay it.
              const synced = action !== 'status' && await reconcile();
              if (!active() || retryReload) return;
              if (retryWrite) setRetryNotice({ error: true, key: synced ? key : 'retryModeUnverified', detail, unverified: !synced });
              else setNotice({ error: true, key, detail, retry: !synced });
            };
            try {
              const { response, data } = await send(action, params);
              if (!active()) return;
              if (!response.ok || data?.ok !== true || (retryWrite && typeof data.retryEnabled !== 'boolean')) {
                await reportFailure('failed', typeof data?.error === 'string' ? data.error : null);
                return;
              }
              if (action === 'status') acceptStatus(data);
              else {
                setState(data);
                const draft = drafts.current;
                const saved = draft.state?.selectedIds || [];
                const chosen = new Set(draft.selected);
                const selectionDirty = draft.selected.length !== saved.length || saved.some(id => !chosen.has(id));
                // Saving selections adopts the server result; other operations preserve a dirty draft.
                if (action === 'select' || (!selectionDirty && (action === 'refresh' || (action === 'save' && params.apiKey)))) {
                  setSelected(Array.isArray(data.selectedIds) ? data.selectedIds : []);
                }
              }
              if (onSuccess) onSuccess();
              if (retryWrite) { setRetryNotice({ key: 'saved' }); notifyRetryFeature(); }
              else if (action !== 'status') setNotice({ error: false,
                warning: action === 'deleteApiKey' && data.hasApiKey,
                key: action === 'deleteApiKey' ? (data.hasApiKey ? 'keyDeletedFallback' : 'keyDeleted')
                  : action === 'refresh' ? 'refreshed' : 'saved' });
            } catch (error) {
              if (active() && error.name !== 'AbortError') await reportFailure('error');
            } finally {
              if (life.controller === controller) {
                life.controller = null;
                if (life.mounted) setBusy('');
              }
            }
          }, []);

          React.useEffect(() => {
            const life = lifecycle.current;
            life.mounted = true;
            request('status');
            return () => {
              life.mounted = false;
              if (life.controller) life.controller.abort();
              life.controller = null;
            };
          }, [request]);

          const models = state && Array.isArray(state.models) ? state.models : [];
          const selectedSet = new Set(selected);
          const query = search.trim().toLocaleLowerCase();
          const filtered = models.filter((model) => `${model.id} ${model.name}`.toLocaleLowerCase().includes(query));
          const stored = state && Array.isArray(state.selectedIds) ? state.selectedIds : [];
          const dirty = selected.length !== stored.length || stored.some((id) => !selectedSet.has(id));
          const disabled = Boolean(busy);
          const retryEnabled = state?.retryEnabled === true;
          const retryReadOnly = state?.retryEnabledWritable === false;
          const retryUnverified = Boolean(retryNotice?.unverified);
          const retryDisabled = disabled || retryReadOnly || retryUnverified;
          const retryBusy = busy === 'setRetryEnabled' || (busy === 'status' && retryUnverified);
          const button = (key, onClick, unavailable = false, primary = false, danger = false) => h('button', {
            type: 'button', onClick, disabled: disabled || unavailable, className: danger ? 'capinfo-danger' : primary ? 'capinfo-primary' : undefined,
          }, t(key));
          const field = (key, value, setter, type = 'text', autocomplete = 'off') => h('label', {
            className: 'capinfo-field', htmlFor: `${uid}-${key}`,
          }, h('span', null, t(key)), h('input', {
            id: `${uid}-${key}`, type, value, autoComplete: autocomplete, disabled,
            placeholder: key === 'apiKey' && state.hasApiKey ? t('secretPlaceholder') : '',
            spellCheck: false, onChange: (event) => setter(event.target.value),
          }));
          const date = (value) => {
            if (!value) return t('unknown');
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? t('unknown') : parsed.toLocaleString();
          };
          const renderStatus = (message, working, local = false) => {
            if (!message && !working) return null;
            return h('div', { role: message?.error ? 'alert' : 'status', 'aria-live': 'polite', className: 'capinfo-actions' },
              working ? h('span', { className: 'capinfo-muted' }, t(busy === 'status' ? 'loading' : 'saving')) : null,
              message ? h('span', { id: local && retryUnverified ? `${uid}-retry-state` : undefined,
                className: message.error ? 'capinfo-notice capinfo-error' : message.warning ? 'capinfo-notice capinfo-pending' : 'capinfo-notice' }, t(message.key), message.detail ? ` ${message.detail}` : null) : null,
              local && retryUnverified ? h('button', { type: 'button', 'aria-disabled': disabled,
                onClick: () => { if (!disabled) request('status'); },
              }, t('retryModeReload')) : message?.retry && !busy ? button('retry', () => request('status')) : null);
          };

          return h('div', { className: 'capinfo-settings', 'aria-busy': disabled && !retryBusy },
            h('style', null, css),
            renderStatus(notice, disabled && !retryBusy),
            state ? h(React.Fragment, null,
              h('section', { className: 'capinfo-card', 'aria-labelledby': `${uid}-connection` },
                h('div', { className: 'capinfo-row' }, h('h3', { id: `${uid}-connection` }, t('connection')),
                  h('span', { className: state.hasApiKey ? 'capinfo-configured' : 'capinfo-muted' }, t(state.hasApiKey ? 'configured' : 'notConfigured'))),
                h('p', { className: 'capinfo-muted capinfo-endpoint' }, t('endpoint'), ': ', state.baseURL, ' · ', t('protocol'), ': ', state.api),
                field('apiKey', apiKey, setApiKey, 'password', 'new-password'),
                h('p', { className: 'capinfo-muted' }, t('credentialHint')),
                h('div', { className: 'capinfo-actions' },
                  button('saveKey', () => request('save', { apiKey: apiKey.trim() }, () => setApiKey('')), !apiKey.trim() || confirmDelete || state.apiKeyWritable === false, true),
                  confirmDelete ? h(React.Fragment, null,
                    button('confirmDeleteKey', () => request('deleteApiKey', {}, () => {setApiKey(''); setConfirmDelete(false);}), !state.hasApiKey || state.apiKeyWritable === false, false, true),
                    button('cancel', () => setConfirmDelete(false)))
                    : button('deleteKey', () => setConfirmDelete(true), !state.hasApiKey || state.apiKeyWritable === false, false, true)),
                confirmDelete ? h('p', { className: 'capinfo-muted', role: 'status' }, t('deleteKeyHint')) : null),
              h('section', { className: 'capinfo-card', 'aria-labelledby': `${uid}-retry` },
                h('div', { className: 'capinfo-row capinfo-retry-row' },
                  h('h3', { id: `${uid}-retry` }, t('retryMode')),
                  h('button', { type: 'button', role: 'switch', className: 'capinfo-switch',
                    'aria-checked': retryEnabled, 'aria-labelledby': `${uid}-retry`,
                    'aria-describedby': `${uid}-retry-hint${retryReadOnly ? ` ${uid}-retry-readonly` : ''}${retryUnverified ? ` ${uid}-retry-state` : ''}`,
                    'aria-disabled': retryDisabled,
                    onClick: () => { if (!retryDisabled) request('setRetryEnabled', { retryEnabled: !retryEnabled }); },
                  })),
                h('p', { id: `${uid}-retry-hint`, className: 'capinfo-muted' }, t('retryModeHint'), ' ', t('retryModeCost')),
                retryReadOnly ? h('p', { id: `${uid}-retry-readonly`, className: 'capinfo-muted' }, t('retryModeReadOnly')) : null,
                renderStatus(retryNotice, retryBusy, true)),
              h('section', { className: 'capinfo-card', 'aria-labelledby': `${uid}-models` },
                h('div', { className: 'capinfo-row' }, h('h3', { id: `${uid}-models` }, t('models')),
                  button('refresh', () => request('refresh'), !state.hasApiKey)),
                state.hasApiKey ? h(React.Fragment, null,
                  h('p', { className: 'capinfo-muted' }, t('modelHint')),
                  h('input', { type: 'search', value: search, placeholder: t('search'), 'aria-label': t('search'), disabled,
                    onChange: (event) => setSearch(event.target.value) }),
                  h('div', { className: 'capinfo-row' },
                    h('span', { className: 'capinfo-muted' }, t('count', { selected: selected.length, total: models.length })),
                    h('div', { className: 'capinfo-actions' },
                      button('selectAll', () => setSelected(Array.from(new Set([...selected, ...filtered.map((model) => model.id)]))), !filtered.length || filtered.every((model) => selectedSet.has(model.id))),
                      button('clearAll', () => { const ids = new Set(filtered.map((model) => model.id)); setSelected(selected.filter((id) => !ids.has(id))); }, !filtered.some((model) => selectedSet.has(model.id))))),
                  h('div', { className: 'capinfo-list' }, filtered.length ? filtered.map((model, index) => {
                    const input = Array.isArray(model.input) ? ['text', 'image'].filter(type => model.input.includes(type)).join('/') : '';
                    const length = formatContext(model.contextWindow);
                    const details = [input, length && t('modelContext', { length })].filter(Boolean).join(' · ');
                    const exactContext = length ? t('modelContext', { length: `${model.contextWindow.toLocaleString()} tokens` }) : null;
                    const rowId = `${uid}-model-${index}`;
                    const distinctName = model.name && model.name !== model.id;
                    return h('label', { className: 'capinfo-model', key: model.id },
                      h('input', { type: 'checkbox', checked: selectedSet.has(model.id), disabled,
                        'aria-labelledby': `${rowId}-name${distinctName ? ` ${rowId}-id` : ''}`,
                        'aria-describedby': details ? `${rowId}-details` : undefined,
                        onChange: (event) => setSelected(event.target.checked ? [...selected, model.id] : selected.filter((id) => id !== model.id)) }),
                      h('span', { className: 'capinfo-model-text' }, h('span', { id: `${rowId}-name` }, model.name || model.id),
                        distinctName ? h('small', { id: `${rowId}-id` }, model.id) : null,
                        details ? h('small', { id: `${rowId}-details`, title: exactContext ?? undefined },
                          exactContext ? h('span', { 'aria-hidden': true }, details) : details,
                          exactContext ? h('span', { className: 'capinfo-sr-only' },
                            [input, exactContext].filter(Boolean).join(' · ')) : null) : null));
                  }) : h('p', { className: 'capinfo-empty' }, t(models.length ? 'noMatches' : 'empty'))),
                  h('div', { className: 'capinfo-row' },
                    h('div', { className: 'capinfo-actions' }, button('saveSelection', () => request('select', { selectedIds: selected }), !dirty || selected.length === 0, true),
                      dirty ? h('span', { className: 'capinfo-muted capinfo-pending' }, t(selected.length ? 'unsaved' : 'selectRequired')) : null),
                    h('span', { className: 'capinfo-muted' }, state.lastSynced ? t('synced', { time: date(state.lastSynced) }) : t('never'))))
                  : h('p', { className: 'capinfo-empty', role: 'status' }, t('empty')))) : null);
        }

        // The sidebar entry opens the usage dashboard only; configuration stays in Settings.
        function DashboardDialog({onClose}) {
          React.useSyncExternalStore(subscribe, snapshot, snapshot);
          const [usage, setUsage] = React.useState(null);
          React.useEffect(() => createUsageSync(setUsage).start(), []);
          const uid = React.useId();
          const panel = React.useRef(null);

          // The dialog owns its modal semantics: initial focus, Escape, and focus return.
          React.useEffect(() => {
            if (typeof document === 'undefined') return undefined;
            const previous = document.activeElement;
            panel.current?.focus();
            const onKeyDown = event => {
              if (event.key === 'Tab') {
                const items = Array.from(panel.current?.querySelectorAll('button:not(:disabled), [tabindex="0"]') || []);
                const first = items[0], last = items.at(-1);
                if (!first) { event.preventDefault(); panel.current?.focus(); return; }
                if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
                  event.preventDefault(); last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault(); first.focus();
                }
                return;
              }
              if (event.key !== 'Escape' || event.defaultPrevented) return;
              event.stopPropagation();
              onClose();
            };
            document.addEventListener('keydown', onKeyDown);
            return () => {
              document.removeEventListener('keydown', onKeyDown);
              if (previous && typeof previous.focus === 'function') previous.focus();
            };
          }, [onClose]);

          const date = (value) => {
            if (!value) return t('unknown');
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? t('unknown') : parsed.toLocaleString();
          };
          const renderUsage = () => {
            const value = currentUsage(usage);
            const count = key => tokenCount(value?.[key]) ?? '0';
            const days = usageDays(value);
            return h('section', { className: 'capinfo-usage', id: `${uid}-usage`, 'aria-labelledby': `${uid}-usage-title` },
              h('h3', { id: `${uid}-usage-title` }, t('usageTitle')),
              h('div', { className: 'capinfo-summary' },
                h('div', { className: 'capinfo-summary-item' }, h('span', null, t('usageAmount')), h('strong', null, currency(value?.amount))),
                h('div', { className: 'capinfo-summary-item' }, h('span', null, t('usageTodayTokens')), h('strong', null, count('totalTokens'))),
                h('div', { className: 'capinfo-summary-item--unit' }, h('span', null, t('usageUnitCost')), h('strong', null, formatUnitCost(value) ?? '—'))),
              h('p', { className: 'capinfo-muted capinfo-usage-updated' }, t('usageAmountUpdated'), ' ', date(value?.amountUpdatedAt)),
              h(UsageChart, {days, id: uid}));
          };

          const dialog = h('div', { ref: panel, tabIndex: -1, className: 'capinfo-dialog', role: 'dialog', 'aria-modal': 'true',
            'aria-label': t('panel'), 'data-shortcut-modal': 'capinfo' },
            h('style', null, css),
            h('button', { type: 'button', className: 'capinfo-dialog-close', 'aria-label': t('close'), onClick: onClose }, closeIcon(16)),
            h('div', { className: 'capinfo-dialog-body' }, renderUsage()));

          return ReactDOM.createPortal(h('div', { className: 'capinfo-overlay' },
            h('div', { className: 'capinfo-mask', 'aria-hidden': 'true', onClick: onClose }),
            dialog), document.body);
        }

        // Use the native upper-left navigation: the host owns row styling,
        // collapsed tooltips, ordering and the More menu's pin/unpin behavior.
        // A sidebar panel id is required by the native navigation contract, but
        // this destination is a modal, not a replacement for the selected page.
        // Restore selection synchronously, before React commits a different main
        // panel, and keep the dialog in the independent shell overlay lifecycle.
        let dashboardOpen = false;
        const dashboardListeners = new Set();
        const dashboardSnapshot = () => dashboardOpen;
        const subscribeDashboard = listener => {
          dashboardListeners.add(listener);
          return () => dashboardListeners.delete(listener);
        };
        const setDashboardOpen = value => {
          if (dashboardOpen === value) return;
          dashboardOpen = value;
          for (const listener of dashboardListeners) listener();
        };
        function DashboardOverlay() {
          const open = React.useSyncExternalStore(subscribeDashboard, dashboardSnapshot, dashboardSnapshot);
          const onClose = React.useCallback(() => setDashboardOpen(false), []);
          return open ? h(DashboardDialog, {onClose}) : null;
        }

        // Contribute to the root of the native model menu, not the composer toolbar.
        function SessionRetryToggle({sessionId, locked, reportFailure}) {
          React.useSyncExternalStore(subscribe, snapshot, snapshot);
          const [state, setState] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const lifecycle = React.useRef({ mounted: false, controller: null, action: null });
          const failureReporter = React.useRef(reportFailure);
          failureReporter.current = reportFailure;
          // Follow the session's model selection so picking another model updates the switch.
          // ModelDirectory exposes the shared store, not the snapshot methods themselves.
          const directory = React.useMemo(() => {
            if (sessionId === undefined) return undefined;
            try {
              const store = ctx.get('modelDirectories')?.directoryFor(sessionId)?.store;
              // Never crash the slot when a host API drifts: hide the switch instead.
              return store && typeof store.subscribe === 'function' && typeof store.getSnapshot === 'function'
                ? store : undefined;
            } catch { return undefined; }
          }, [sessionId]);
          const selection = React.useSyncExternalStore(
            (listener) => directory?.subscribe(listener) ?? (() => {}),
            () => directory?.getSnapshot().current ?? null,
            () => directory?.getSnapshot().current ?? null,
          );
          const send = React.useCallback(async (action, enabled) => {
            const life = lifecycle.current;
            if (!life.mounted || life.controller) return;
            const controller = new AbortController();
            life.controller = controller;
            life.action = action;
            if (action === 'set') setBusy(true);
            let reconcile = false;
            try {
              const response = await fetch('api/plugins/capinfo/retry', {
                method: 'POST', credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ action, sessionId, ...(action === 'set' ? { enabled } : {}) }),
                signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
              });
              const data = await response.json();
              // Adopt only confirmed Host state; a failed write never flips the switch here.
              if (life.mounted && life.controller === controller && response.ok && data?.ok === true)
                setState({ sessionId, available: data.available === true, enabled: data.enabled === true });
              else reconcile = action === 'set';
            } catch { reconcile = action === 'set'; }
            finally {
              if (life.controller === controller) {
                life.controller = null;
                life.action = null;
                if (life.mounted) setBusy(false);
              }
            }
            // A failed write may still have saved; read once, never replay the write.
            if (reconcile && life.mounted && !controller.signal.aborted) {
              failureReporter.current?.(t('error'));
              await send('status');
            }
          }, [sessionId]);
          React.useEffect(() => {
            if (sessionId === undefined || selection?.provider !== 'capinfo') return;
            const life = lifecycle.current;
            life.mounted = true;
            void send('status');
            const unsubscribe = subscribeRetryFeature(() => { void send('status'); });
            return () => {
              life.mounted = false;
              unsubscribe();
              // Closing the menu must not cancel an explicit save already in flight.
              if (life.action === 'status') life.controller?.abort();
              life.controller = null;
              life.action = null;
            };
          }, [send, sessionId, selection?.provider]);
          if (sessionId === undefined || selection?.provider !== 'capinfo' || state?.sessionId !== sessionId || !state.available) return null;
          const disabled = locked || busy;
          return h(React.Fragment, null, h('style', null, css),
            h('button', { type: 'button', role: 'switch', className: 'capinfo-session-retry',
              'aria-checked': state.enabled === true, 'aria-label': t('sessionRetry'),
              'aria-description': t('sessionRetryHint'), title: t('sessionRetryHint'),
              'aria-disabled': !!disabled, onClick: () => { if (!disabled) void send('set', !(state.enabled === true)); },
            }, h('span', null, t('sessionRetry')),
            h('span', { className: 'capinfo-session-retry-track', 'data-on': state.enabled === true || undefined,
              'aria-hidden': 'true' }, h('span', { className: 'capinfo-session-retry-thumb' }))));
        }

        ctx.slots.inject('conversation.input.model.options', () => ctx.slots.register({
          name: 'conversation.input.model.options', id: 'capinfo-session-retry', order: 10,
        }, SessionRetryToggle));
        ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'capinfo-models',
        }, ({size = 16}) => lotusIcon(size)));
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'capinfo-models', order: 11, label: () => t('title'),
        }, SettingsSection));

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main', key: 'capinfo-dashboard', locale: 'capinfo',
        }, () => null));
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay', id: 'capinfo-dashboard-overlay', locale: 'capinfo',
        }, DashboardOverlay));
        ctx.effect(() => {
          const panelInfo = ctx.layout.panelInfo;
          let previousPanel = panelInfo.getSnapshot().activePanelId;
          if (previousPanel === 'capinfo-dashboard') previousPanel = null;
          const onPanelChange = () => {
            const activePanel = panelInfo.getSnapshot().activePanelId;
            if (activePanel !== 'capinfo-dashboard') {
              previousPanel = activePanel;
              return;
            }
            ctx.layout.selectPanel(previousPanel);
            setDashboardOpen(true);
          };
          const unsubscribe = panelInfo.subscribe(onPanelChange);
          onPanelChange();
          return () => {
            unsubscribe();
            setDashboardOpen(false);
          };
        });
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: 'capinfo-dashboard', label: () => t('panel'), locale: 'capinfo',
        }, ({size}) => lotusIcon(size)));
      },
    };
  },
});
