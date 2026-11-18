import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {formatUnitCost} from '../usage-chart-options.js';

const moduleSource = await readFile(new URL('../client-source.js', import.meta.url), 'utf8');
const chartImport = /^import \{createUsageChartComponent\} from '\.\/usage-chart\.js';\r?\n/m;
assert.equal((moduleSource.match(/^import /gm) || []).length, 2);
assert.match(moduleSource, chartImport);
const unitCostImport = /^import \{formatUnitCost\} from '\.\/usage-chart-options\.js';\r?\n/m;
assert.match(moduleSource, unitCostImport);
const source = moduleSource.replace(chartImport, '').replace(unitCostImport, '');
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const usage = {date: '2026-11-11', timeZone: 'Asia/Shanghai', totalTokens: 1234,
  inputTokens: 900, outputTokens: 300, cacheReadTokens: 30, cacheWriteTokens: 4, requests: 2, updatedAt: null};
const response = value => ({ok: true, json: async () => ({ok: true, usage: value})});

// Execute the actual plugin and Settings with a small hook/element harness. This
// checks rendered props and lifecycle, not browser layout or React scheduling.
function setup({lang = 'en', now = '2026-11-11T15:59:50Z', replies = [response(usage)], pick = 'shell.overlay'} = {}) {
  let clock = Date.parse(now), Settings, cursor = 0, tree;
  const hooks = [], effects = [], cleanups = [], intervals = new Map(), timeouts = new Map(), calls = [];
  const dictionaries = {};
  let timerId = 0;
  const selectedPanels = [];
  let activePanelId = null;
  const panelListeners = new Set();
  const selectPanel = value => {
    selectedPanels.push(value);
    activePanelId = value;
    for (const listener of panelListeners) listener();
  };
  const React = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity).filter(v => v !== null && v !== false)}),
    createPortal: node => node,
    Fragment: 'fragment',
    useState(initial) { const i = cursor++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => {hooks[i] = value;}]; },
    useRef(initial) { const i = cursor++; return hooks[i] ||= {current: initial}; },
    useEffect(callback) { const i = cursor++; if (!(i in hooks)) {hooks[i] = true; effects.push(callback);} },
    useCallback(callback) {cursor++; return callback;},
    useSyncExternalStore(_subscribe, snapshot) {cursor++; return snapshot();},
    useId() {cursor++; return 'settings';},
  };
  const transport = {fetch: async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/usage')) {
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return await next;
    }
    assert.equal(url, 'api/plugins/capinfo');
    assert.equal(options.method, 'POST');
    return {ok: true, json: async () => ({ok: true, hasApiKey: true, selectedIds: ['one'],
      models: [{id: 'one'}, {id: 'two'}], baseURL: 'https://example.test', api: 'openai'})};
  }};
  const context = {
    // The child is intentionally opaque: inspect its props, never simulate ECharts.
    formatUnitCost,
  createUsageChartComponent: (react, translate) => {
      assert.equal(react, React);
      assert.equal(translate('usageHistory'), lang === 'zh' ? '近 30 天用量' : 'Usage over the last 30 days');
      return 'usage-chart';
    },
    window: {__ModuleLoader__: {load(module) { module.factory(() => React).apply({
      effect: callback => callback(),
      locale: {register: (_ns, language, values) => {dictionaries[language] = values;},
        bind: () => key => dictionaries[lang][key], subscribe() {}, getSnapshot() {}},
      layout: {selectPanel, panelInfo: {
        getSnapshot: () => ({activePanelId}),
        subscribe: listener => {panelListeners.add(listener); return () => panelListeners.delete(listener);},
      }},
      slots: {inject: (_name, callback) => callback(), register: (meta, component) => {if (meta.name === pick) Settings = component;}},
    }); }}},
    __DSH_TRANSPORT__: transport, AbortController, AbortSignal,
    document: {body: {}, activeElement: null, addEventListener() {}, removeEventListener() {}},
    Date: class extends Date {static now() {return clock;}},
    setInterval: (callback, ms) => {const id = ++timerId; intervals.set(id, {callback, ms}); return id;},
    clearInterval: id => intervals.delete(id),
    setTimeout: (callback, ms) => {const id = ++timerId; timeouts.set(id, {callback, ms}); return id;},
    clearTimeout: id => timeouts.delete(id),
  };
  vm.runInNewContext(source, context);
  if (pick === 'shell.overlay') {
    selectPanel('capinfo-dashboard');
    selectedPanels.length = 0;
  }
  // Execute the registered overlay and its dashboard component directly.
  const expand = node => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map(expand);
    if (typeof node.type === 'function') return expand(node.type(node.props));
    return {...node, children: node.children.flatMap(expand)};
  };
  const render = () => {
    cursor = 0;
    tree = expand(Settings({wide: true}));
    for (const effect of effects.splice(0)) cleanups.push(effect());
    return tree;
  };
  render();
  return {render, calls, intervals, timeouts, selectedPanels,
    setTime: value => {clock = Date.parse(value);},
    tick: () => [...intervals.values()].find(timer => timer.ms === 30000).callback(),
    midnight: () => { const [id, timer] = timeouts.entries().next().value; timeouts.delete(id); timer.callback(); },
    cleanup: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}
function nodes(tree, predicate) {
  if (!tree || typeof tree !== 'object') return [];
  return [...(predicate(tree) ? [tree] : []), ...tree.children.flatMap(child => nodes(child, predicate))];
}
const section = tree => nodes(tree, node => node.props.id === 'settings-usage')[0];
const rows = tree => nodes(section(tree), node => node.props.className === 'capinfo-usage-row');
const chart = tree => nodes(section(tree), node => node.type === 'usage-chart')[0];
// Normalize VM-created data into this realm for structural equality assertions.
const days = tree => JSON.parse(JSON.stringify(chart(tree).props.days));
const unknownDays = tree => days(tree).every(day => day.amount === null && day.totalTokens === null);
const amounts = tree => summary(tree).slice(1);
const summary = tree => nodes(section(tree), node => node.props.className === 'capinfo-summary-item')
  .map(item => nodes(item, node => node.type === 'strong')[0]).map(node => text(node));
const text = tree => typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree);
const usageCalls = f => f.calls.filter(call => call.url.endsWith('/usage'));

test('usage UI keeps bilingual summaries and one chart without the removed details or disclaimer', async () => {
  for (const lang of ['en', 'zh']) {
    const f = setup({lang}); await flush();
    const view = f.render();
    assert.equal(nodes(view, node => node.type === 'h2').length, 0);
    const dialog = nodes(view, node => node.props.role === 'dialog')[0];
    assert.equal(dialog.props['aria-label'], lang === 'zh' ? 'Capinfo看板' : 'Capinfo dashboard');
    const close = nodes(dialog, node => node.type === 'button' && node.props.className === 'capinfo-dialog-close')[0];
    assert.ok(close.props['aria-label']);
    const css = text(nodes(view, node => node.type === 'style')[0]);
    const closeRule = css.match(/\.capinfo-dialog-close\{([^}]+)\}/)?.[1];
    assert.match(closeRule, /position:absolute/);
    assert.match(closeRule, /top:/);
    assert.match(closeRule, /right:/);
    close.props.onClick();
    assert.deepEqual(f.selectedPanels, []);
    assert.doesNotMatch(text(view), /管理 API 密钥和可用模型|Manage your API key and available models/);
    assert.equal(section(view).props.className, 'capinfo-usage');
    assert.equal(text(nodes(section(view), node => node.type === 'h3')[0]), lang === 'zh' ? '今日用量' : 'Today’s usage');
    assert.equal(section(view).children[1].props.className, 'capinfo-summary');
    assert.equal(section(view).props['aria-labelledby'], 'settings-usage-title');
    assert.deepEqual(summary(view), ['¥0.00', '1234']);
    assert.equal(nodes(section(view), node => node.type === 'usage-chart').length, 1);
    assert.equal(chart(view).props.id, 'settings');
    assert.equal(days(view).length, 30);
    assert.equal(nodes(section(view), node => ['details', 'table', 'summary'].includes(node.type)).length, 0);
    assert.equal(rows(view).length, 0);
    assert.doesNotMatch(text(section(view)), /查看每日数据|Read daily data|本 profile 本插件|this plugin in this profile only|缓存读取|Cache read/);
    assert.equal(section(view).children.at(-1), chart(view));
    f.cleanup();
  }
});

test('today shows localized unit cost using raw samples, and clears it when Token is zero', async () => {
  for (const [lang, label] of [['en', 'Cost per million'], ['zh', '单位成本']]) {
    const f = setup({lang, replies: [response({...usage, amount: 7.5, totalTokens: 1504999}),
      response({...usage, amount: 7.5, totalTokens: 0})]});
    const unit = () => nodes(f.render(), node => node.props.className === 'capinfo-summary-item--unit')[0];
    assert.equal(text(unit()), `${label} —`);
    await flush();
    assert.equal(text(unit()), `${label} ¥4.98 / 1M Token`);
    f.tick(); await flush();
    assert.equal(text(unit()), `${label} —`);
    f.cleanup();
  }
});

test('initial offline dashboard displays zero summaries and unknown chart gaps without a warning', async () => {
  const f = setup({replies: [new Error('offline')]});
  assert.deepEqual(summary(f.render()), ['¥0.00', '0']);
  await flush();
  const view = f.render();
  assert.deepEqual(summary(view), ['¥0.00', '0']);
  assert.equal(unknownDays(view), true);
  assert.equal(nodes(view, node => node.props.role === 'alert' || node.props.role === 'status').length, 0);
  assert.doesNotMatch(text(section(view)), /offline|snapshot unavailable|stale|Configure an API key/);
  f.cleanup();
});

test('independent 30-second usage polling refreshes the chart without requesting balance or config', async () => {
  const f = setup({replies: [response(usage), response({...usage, totalTokens: 5678})]}); await flush();
  let view = f.render();
  assert.equal(nodes(view, node => node.type === 'input').length, 0);
  f.tick(); await flush(); view = f.render();
  assert.equal(usageCalls(f).length, 2);
  assert.equal(f.calls.filter(call => !call.url.endsWith('/usage')).length, 0);
  assert.equal(f.calls.some(call => call.url.includes('balance')), false);
  assert.deepEqual([...f.intervals.values()].map(timer => timer.ms), [30000]);
  assert.equal(usageCalls(f)[0].options.method, 'GET');
  assert.equal(usageCalls(f)[0].options.cache, 'no-store');
  assert.equal(amounts(view)[0], '5678');
  assert.equal(nodes(view, node => node.props['aria-labelledby'] === 'settings-balance').length, 0);
  f.cleanup();
});

test('settings section keeps API and model management without the usage chart', async () => {
  const f = setup({pick: 'settings.section'}); await flush();
  const view = f.render();
  assert.equal(nodes(view, node => node.type === 'usage-chart').length, 0);
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'password').length, 1);
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'search').length, 1);
  assert.equal(nodes(view, node => node.type === 'input' && node.props.type === 'checkbox').length, 2);
  assert.equal(text(nodes(view, node => node.type === 'h3')[0]), 'API connection');
  assert.equal(nodes(view, node => node.props.id === 'settings-usage').length, 0);
  f.cleanup();
});

test('Beijing midnight clears usage immediately and rejects a late previous-day response', async () => {
  let resolve;
  const f = setup({replies: [response(usage), new Promise(done => {resolve = done;})]}); await flush();
  assert.equal([...f.timeouts.values()][0].ms, 10000);
  f.tick(); await flush();
  f.setTime('2026-11-11T16:00:00Z'); f.midnight();
  assert.deepEqual(amounts(f.render()), ['0']);
  assert.equal(unknownDays(f.render()), true);
  assert.equal(usageCalls(f).length, 2); // No overlapping request.
  resolve(response(usage)); await flush();
  assert.deepEqual(amounts(f.render()), ['0']);
  assert.equal(unknownDays(f.render()), true);
  assert.equal([...f.timeouts.values()][0].ms, 86400000);
  f.cleanup();
});

test('render guard hides expired usage before delayed background timers execute', async () => {
  const f = setup(); await flush();
  f.setTime('2026-11-12T00:00:00Z');
  assert.deepEqual(amounts(f.render()), ['0']);
  assert.equal(unknownDays(f.render()), true);
  f.cleanup();
});

test('stale dates, wrong zones, failures and invalid counts stay isolated; zero is valid', async () => {
  const zero = {...usage, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0};
  const f = setup({replies: [response({...usage, date: '2026-11-10'}), response({...usage, timeZone: 'UTC'}),
    {ok: false, json: async () => ({ok: false})}, new Error('offline'),
    response({...usage, totalTokens: -1, inputTokens: NaN, outputTokens: '20', cacheReadTokens: Infinity, cacheWriteTokens: 0.5}), response(zero)]});
  await flush();
  for (let i = 0; i < 5; i++) {
    const view = f.render();
    assert.deepEqual(amounts(view), ['0']);
    assert.equal(nodes(view, node => node.props.role === 'alert').length, 0);
    f.tick(); await flush();
  }
  assert.deepEqual(amounts(f.render()), ['0']);
  f.cleanup();
});

test('sample failure retains the two-decimal sampled amount without error or persistence notices', async () => {
  const f = setup({lang: 'zh', replies: [response({...usage, amount: 12.345, spending: {status: 'ready'}}),
    response({...usage, amount: 12.345,
    amountUpdatedAt: '2026-11-11T12:34:56Z', persistenceError: 'disk full',
    spending: {status: 'error', error: 'sampling unavailable'}}), response({...usage, amount: 0,
    spending: {status: 'ready'}})]});
  await flush();
  assert.deepEqual(summary(f.render()), ['¥12.35', '1234']);
  f.tick(); await flush();
  let view = f.render();
  assert.deepEqual(summary(view), ['¥12.35', '1234']);
  assert.equal(nodes(view, node => node.props.role === 'alert').length, 0);
  assert.doesNotMatch(text(section(view)), /sampling unavailable|持久化失败|消费采样失败/);
  assert.doesNotMatch(text(section(view)), /Host 每 60 秒|本页每 30 秒|金额可能滞后/);
  f.tick(); await flush();
  view = f.render();
  assert.equal(summary(view)[0], '¥0.00');
  assert.equal(nodes(view, node => node.props.role === 'alert').length, 0);
  f.setTime('2026-11-11T16:00:00Z');
  assert.deepEqual(summary(f.render()), ['¥0.00', '0']);
  f.cleanup();
});

test('chart props share exactly 30 calendar dates, preserve gaps and real zero, and prefer the live snapshot', async () => {
  const history = [
    {date: '2026-10-12', amount: 99999, totalTokens: 99999}, // outside window
    {date: '2026-10-13', amount: 1, totalTokens: 100},
    {date: '2026-10-15', amount: 2, totalTokens: 200},
    {date: '2026-11-10', amount: null, totalTokens: 500},
    {date: '2026-11-11', amount: 999, totalTokens: 999}, // live snapshot wins
    {date: '2026-11-12', amount: 99999, totalTokens: 99999},
  ];
  const f = setup({replies: [response({...usage, totalTokens: 0, amount: null, history})]});
  await flush();
  const data = days(f.render());
  assert.deepEqual(data.map(day => day.date), Array.from({length: 30}, (_, index) =>
    new Date(Date.parse('2026-10-13T00:00:00Z') + index * 86400000).toISOString().slice(0, 10)));
  assert.deepEqual(data[0], {date: '2026-10-13', amount: 1, totalTokens: 100});
  assert.deepEqual(data[1], {date: '2026-10-14', amount: null, totalTokens: null});
  assert.deepEqual(data[2], {date: '2026-10-15', amount: 2, totalTokens: 200});
  assert.deepEqual(data.at(-2), {date: '2026-11-10', amount: null, totalTokens: 500});
  assert.deepEqual(data.at(-1), {date: '2026-11-11', amount: null, totalTokens: 0});
  assert.equal(data.filter(day => day.amount !== null).length, 2);
  assert.equal(data.filter(day => day.totalTokens !== null).length, 4);
  f.cleanup();
});

test('missing and invalid summary amounts display zero, with no sampling or unconfigured notices', async () => {
  for (const amount of [null, undefined, NaN, Infinity, -1, '1']) {
    const f = setup({replies: [response({...usage, amount, spending: {status: 'pending'}})]});
    await flush();
    assert.equal(summary(f.render())[0], '¥0.00');
    assert.equal(days(f.render()).at(-1).amount, null);
    assert.equal(nodes(f.render(), node => node.props.role === 'alert' || node.props.role === 'status').length, 0);
    assert.doesNotMatch(text(section(f.render())), /Sampling spending|正在采样消费金额/);
    f.cleanup();
  }
  const f = setup({replies: [response({...usage, amount: null, spending: {status: 'unconfigured'}})]});
  await flush();
  assert.equal(summary(f.render())[0], '¥0.00');
  assert.doesNotMatch(text(section(f.render())), /Configure an API key/);
  assert.equal(nodes(f.render(), node => node.props.role === 'alert' || node.props.role === 'status').length, 0);
  f.cleanup();
});

test('all 30 chart days retain exact amounts and safe-integer token counts without display rounding', async () => {
  const history = Array.from({length: 29}, (_, index) => ({
    date: new Date(Date.parse('2026-10-13T00:00:00Z') + index * 86400000).toISOString().slice(0, 10),
    amount: 1234567890.12 + index / 100,
    totalTokens: Number.MAX_SAFE_INTEGER - index,
  }));
  const today = {date: usage.date, amount: 1234567890.12, totalTokens: Number.MAX_SAFE_INTEGER};
  const f = setup({replies: [response({...usage, ...today, history})]});
  await flush();
  const view = f.render();
  assert.deepEqual(days(view), [...history, today]);
  assert.deepEqual(summary(view), ['¥1234567890.12', '90071992亿5474万']);
  f.cleanup();
});

test('network failure silently retains the last valid same-day snapshot but never leaks it across midnight', async () => {
  const snapshot = {...usage, amount: 3.5, history: [{date: '2026-11-10', amount: 1, totalTokens: 20}]};
  const f = setup({replies: [response(snapshot), new Error('offline'), response(snapshot), new Error('offline')]});
  await flush();
  f.tick(); await flush();
  let view = f.render();
  assert.deepEqual(summary(view), ['¥3.50', '1234']);
  assert.equal(nodes(view, node => node.props.role === 'alert').length, 0);
  assert.doesNotMatch(text(section(view)), /offline|snapshot unavailable|stale/);
  assert.deepEqual(days(view).at(-2), {date: '2026-11-10', amount: 1, totalTokens: 20});
  f.tick(); await flush();
  assert.equal(nodes(f.render(), node => node.props.role === 'alert').length, 0);
  f.setTime('2026-11-11T16:00:00Z'); f.midnight(); await flush();
  view = f.render();
  assert.deepEqual(summary(view), ['¥0.00', '0']);
  assert.equal(nodes(view, node => node.props.role === 'alert').length, 0);
  assert.doesNotMatch(text(section(view)), /snapshot unavailable/);
  assert.equal(unknownDays(view), true);
  assert.equal(days(view)[0].date, '2026-10-14');
  assert.equal(days(view).at(-1).date, '2026-11-12');
  f.cleanup();
});

test('unmount cancels usage request and timers and ignores late completion', async () => {
  let resolve;
  const f = setup({replies: [new Promise(done => {resolve = done;})]});
  f.tick(); assert.equal(usageCalls(f).length, 1);
  const request = usageCalls(f)[0];
  f.cleanup();
  assert.equal(request.options.signal.aborted, true);
  assert.equal(f.intervals.size, 0); assert.equal(f.timeouts.size, 0);
  resolve(response(usage)); await flush();
  assert.deepEqual(amounts(f.render()), ['0']);
  assert.equal(unknownDays(f.render()), true);
});


test('today summary shows exact counts under 10k and drops the remainder above it', async () => {
  for (const [totalTokens, expected] of [[0, '0'], [9999, '9999'], [10000, '1万'], [10001, '1万'],
    [2643486, '264万'], [99999999, '9999万'], [100000000, '1亿'], [213750000, '2亿1375万'],
    [213751234, '2亿1375万'], [NaN, '0']]) {
    const f = setup({lang: 'zh', replies: [response({...usage, amount: 1.3, totalTokens})]});
    await flush();
    const view = f.render();
    assert.equal(text(section(view).children[0]), '今日用量');
    const items = nodes(view, node => node.props.className === 'capinfo-summary-item');
    assert.equal(text(items[0]), '费用 ¥1.30');
    assert.equal(text(items[1]), `Token ${expected}`);
    assert.equal(items.length, 2);
    f.cleanup();
  }
});


test('invalid historical samples remain unknown while exact zero is forwarded to the chart', async () => {
  const history = [
    {date: '2026-11-08', amount: -1, totalTokens: Number.MAX_SAFE_INTEGER + 1},
    {date: '2026-11-09', amount: '1', totalTokens: 1.5},
    {date: '2026-11-10', amount: 0, totalTokens: 0},
  ];
  const f = setup({replies: [response({...usage, amount: Infinity, totalTokens: -1, history})]});
  await flush();
  assert.deepEqual(days(f.render()).slice(-4), [
    {date: '2026-11-08', amount: null, totalTokens: null},
    {date: '2026-11-09', amount: null, totalTokens: null},
    {date: '2026-11-10', amount: 0, totalTokens: 0},
    {date: '2026-11-11', amount: null, totalTokens: null},
  ]);
  f.cleanup();
});
