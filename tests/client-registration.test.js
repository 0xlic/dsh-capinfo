import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Verify the distributed artifact's native panel and configuration registrations.
const script = await readFile(new URL('../client.js', import.meta.url), 'utf8');

function load() {
  const modules = [];
  vm.runInNewContext(script, {
    window: {__ModuleLoader__: {load: module => modules.push(module)}},
    navigator: {userAgent: 'Node.js test runner'},
    fetch: () => {throw new Error('No network during registration tests');},
    console, setTimeout, clearTimeout, setInterval, clearInterval,
  }, {timeout: 5000});
  assert.equal(modules.length, 1);
  return modules[0];
}

const hookStub = (stateOverrides = new Map()) => {
  const hooks = [];
  return {
    createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)}),
    Fragment: 'fragment', createPortal: node => node,
    useState(initial) { const i = hooks.length; hooks.push(stateOverrides.has(i) ? stateOverrides.get(i) : initial); return [hooks[i], value => {hooks[i] = value;}]; },
    useRef(initial) { const i = hooks.length; hooks.push({current: initial}); return hooks[i]; },
    useEffect() {}, useCallback(fn) { return fn; },
    useSyncExternalStore(_subscribe, snapshot) { return snapshot(); }, useId() { return 'uid'; },
  };
};

function apply(stateOverrides) {
  const module = load();
  const React = hookStub(stateOverrides);
  const client = module.factory(name => name === 'react' ? React : {createPortal: node => node});
  const registrations = [];
  const effects = [];
  const selectedPanels = [];
  let activePanelId = null;
  const panelListeners = new Set();
  const selectPanel = value => {
    selectedPanels.push(value);
    activePanelId = value;
    for (const listener of panelListeners) listener();
  };
  client.apply({
    effect: callback => effects.push(callback()),
    locale: {register() {}, bind: () => key => key, subscribe() {}, getSnapshot() {}},
    layout: {selectPanel, panelInfo: {
      getSnapshot: () => ({activePanelId}),
      subscribe: listener => {panelListeners.add(listener); return () => panelListeners.delete(listener);},
    }},
    slots: {
      inject: (_name, callback) => callback(),
      register: (meta, component) => registrations.push({meta, component}),
    },
  });
  return {registrations, effects, selectedPanels, selectPanel, panelListeners,
    activePanel: () => activePanelId};
}

const walk = node => node && typeof node === 'object'
  ? [node, ...(node.children || []).flatMap(walk)]
  : [];

test('client registers settings, a keyed main panel and the native sidebar panel entry', () => {
  const {registrations, effects} = apply();
  assert.equal(registrations.length, 6);
  const byName = Object.fromEntries(registrations.map(row => [row.meta.name, row.meta]));
  assert.deepEqual(Object.keys(byName).sort(), ['conversation.input.right', 'main', 'settings.section', 'settings.section.icon', 'shell.overlay', 'sidebar.panellist']);
  // The tool-row list renders before the model selector; the dock below the card is not used.
  assert.equal(byName['conversation.input.right'].id, 'capinfo-session-retry');
  assert.doesNotMatch(script, /'conversation\.composer\.dock'/);
  const icon = registrations.find(row => row.meta.name === 'settings.section.icon');
  assert.equal(icon.meta.id, 'capinfo-models');
  for (const size of [16, 20, 24]) {
    const svg = icon.component({size, active: true});
    assert.equal(svg.type, 'svg');
    assert.equal(svg.props.width, size);
    assert.equal(svg.props.height, size);
    assert.equal(svg.props.stroke, 'currentColor');
    assert.equal(svg.props.viewBox, '0 0 16 16');
    assert.equal(svg.children.filter(node => node.type === 'circle').length, 1);
  }
  assert.equal(byName['settings.section'].id, 'capinfo-models');
  assert.equal(byName['settings.section'].order, 11);
  assert.equal(byName.main.key, 'capinfo-dashboard');
  assert.equal(byName['sidebar.panellist'].id, 'capinfo-dashboard');
  assert.equal(byName['sidebar.panellist'].label(), 'panel');
  for (const cleanup of effects) if (typeof cleanup === 'function') cleanup();
});

test('model controls hide cached models and dirty drafts without credentials, but remain with a fallback key', () => {
  for (const hasApiKey of [false, true]) {
    const state = {hasApiKey, models: [{id: 'cached-model', name: 'Cached model'}],
      selectedIds: ['cached-model'], lastSynced: '2026-11-17T09:00:00Z'};
    const {registrations, effects} = apply(new Map([
      [0, state], [1, ''], [5, ''], [6, ['unsaved-model']],
    ]));
    const settings = registrations.find(row => row.meta.name === 'settings.section').component;
    const section = walk(settings()).find(node => node.props['aria-labelledby'] === 'uid-models');
    const nodes = walk(section);
    const buttons = nodes.filter(node => node.type === 'button');
    assert.equal(buttons.find(node => node.children.includes('refresh')).props.disabled, !hasApiKey);
    assert.equal(nodes.some(node => node.type === 'input' && node.props.type === 'search'), hasApiKey);
    assert.equal(nodes.some(node => node.type === 'input' && node.props.type === 'checkbox'), hasApiKey);
    assert.equal(buttons.some(node => node.children.includes('saveSelection')), hasApiKey);
    assert.equal(nodes.some(node => node.type === 'span' && node.children.includes('count')), hasApiKey);
    if (!hasApiKey) {
      assert.equal(nodes.some(node => node.type === 'p' && node.props.role === 'status' && node.children.includes('empty')), true);
      assert.equal(nodes.some(node => node.type === 'input'), false);
      assert.equal(nodes.some(node => node.children.some(child => typeof child === 'string' && /cached-model|Cached model|synced|unsaved/.test(child))), false);
    }
    // The credential-less branch does not destroy saved models or local selection drafts.
    assert.deepEqual(state.selectedIds, ['cached-model']);
    for (const cleanup of effects) if (typeof cleanup === 'function') cleanup();
  }
});

test('retry is an accessible Capinfo settings switch, off by default and independent of credentials', () => {
  for (const {enabled, writable, busy, unverified, expectedChecked, expectedDisabled} of [
    {expectedChecked: false, expectedDisabled: false},
    {enabled: true, writable: true, expectedChecked: true, expectedDisabled: false},
    {enabled: true, writable: false, expectedChecked: true, expectedDisabled: true},
    {enabled: false, writable: true, busy: 'setRetryEnabled', expectedChecked: false, expectedDisabled: true},
    {enabled: true, writable: true, unverified: true, expectedChecked: true, expectedDisabled: true},
    {unverified: true, busy: 'status', expectedChecked: false, expectedDisabled: true},
  ]) {
    const state = {hasApiKey: false, retryEnabled: enabled, retryEnabledWritable: writable};
    const notice = unverified ? {key: 'retryModeUnverified', error: true, unverified} : null;
    const {registrations, effects} = apply(new Map([[0, state], [1, busy || ''], [7, notice]]));
    const settings = registrations.find(row => row.meta.name === 'settings.section').component;
    const section = walk(settings()).find(node => node.props['aria-labelledby'] === 'uid-retry');
    const nodes = walk(section);
    const toggle = nodes.find(node => node.props.role === 'switch');
    assert.equal(toggle.type, 'button');
    assert.equal(toggle.props['aria-checked'], expectedChecked);
    assert.equal(toggle.props.disabled, undefined, 'switch remains focusable');
    assert.equal(toggle.props['aria-disabled'], expectedDisabled);
    assert.deepEqual(nodes.find(node => node.props.id === toggle.props['aria-labelledby']).children, ['retryMode']);
    const descriptions = toggle.props['aria-describedby'].split(' ');
    assert.deepEqual(nodes.find(node => node.props.id === descriptions[0]).children, ['retryModeHint', ' ', 'retryModeCost']);
    assert.equal(descriptions.includes('uid-retry-readonly'), writable === false);
    assert.equal(descriptions.includes('uid-retry-state'), Boolean(unverified));
    const reload = nodes.find(node => node.type === 'button' && node.children.includes('retryModeReload'));
    assert.equal(Boolean(reload), Boolean(unverified));
    if (reload) assert.equal(reload.props['aria-disabled'], Boolean(busy));
    if (busy) assert.ok(nodes.some(node => node.children.includes(busy === 'status' ? 'loading' : 'saving')));
    for (const cleanup of effects) if (typeof cleanup === 'function') cleanup();
  }
});

test('sidebar opens an independent overlay without replacing the previous main page', () => {
  const {registrations, effects, selectedPanels, selectPanel, activePanel, panelListeners} = apply();
  const settings = registrations.find(row => row.meta.name === 'settings.section').component;
  const icon = registrations.find(row => row.meta.name === 'sidebar.panellist').component;
  const main = registrations.find(row => row.meta.name === 'main').component;

  const settingsTree = settings();
  assert.equal(settingsTree.type, 'div');
  assert.equal(settingsTree.children[0].type, 'style');
  assert.equal(walk(settingsTree).some(node => node.type === 'usage-chart'), false);

  const iconTree = icon({size: 16});
  assert.equal(iconTree.type, 'svg');
  assert.ok(walk(iconTree).some(node => node.type === 'path'));
  assert.equal(walk(iconTree).some(node => node.type === 'button' || node.props['aria-haspopup']), false);

  const overlay = registrations.find(row => row.meta.name === 'shell.overlay').component;
  assert.equal(main(), null, 'main key is only a native navigation target');
  assert.equal(overlay(), null);
  for (const background of [null, 'plugins', 'automation']) {
    selectPanel(background);
    selectPanel('capinfo-dashboard');
    assert.equal(activePanel(), background, 'original panel is restored synchronously');
    const dialog = overlay();
    assert.equal(typeof dialog.type, 'function');
    selectPanel('capinfo-dashboard');
    assert.equal(activePanel(), background, 'repeat activation does not lose the background');
    const beforeClose = selectedPanels.length;
    dialog.props.onClose();
    assert.equal(overlay(), null);
    assert.equal(selectedPanels.length, beforeClose, 'closing does not navigate');
  }
  // A genuine later navigation must not be undone by closing the modal.
  selectPanel('capinfo-dashboard');
  selectPanel('plugins');
  overlay().props.onClose();
  assert.equal(activePanel(), 'plugins');
  for (const cleanup of effects) if (typeof cleanup === 'function') cleanup();
  assert.equal(panelListeners.size, 0, 'unload releases the navigation subscription');
});

// A hooks stub that supports re-rendering: cells are indexed per render pass and
// dependency arrays decide whether effects and callbacks are refreshed.
function renderableReact() {
  const cells = [];
  let index = 0, pending = [];
  const changed = (i, deps) => {
    const prev = cells[i];
    if (prev && deps && prev.deps && deps.length === prev.deps.length && deps.every((d, k) => d === prev.deps[k])) return false;
    cells[i] = {deps};
    return true;
  };
  return {
    Fragment: 'fragment', createPortal: node => node,
    createElement: (type, props, ...children) => ({type, props: props || {}, children: children.flat(Infinity)}),
    useState(initial) { const i = index++; if (!(i in cells)) cells[i] = {value: initial};
      return [cells[i].value, value => {cells[i] = {...(cells[i] || {}), value: typeof value === 'function' ? value(cells[i].value) : value};}]; },
    useRef(initial) { const i = index++; return (cells[i] ??= {value: {current: initial}}).value; },
    useMemo(fn, deps) { const i = index++; if (changed(i, deps)) cells[i] = {deps, value: fn()}; return cells[i].value; },
    useCallback(fn, deps) { const i = index++; if (changed(i, deps)) cells[i] = {deps, value: fn}; return cells[i].value; },
    useEffect(fn, deps) { const i = index++; if (changed(i, deps)) pending.push(fn); },
    useSyncExternalStore: (_subscribe, snapshot) => snapshot(),
    beginRender() { index = 0; pending = []; },
    flushEffects() { const run = pending; pending = []; for (const fn of run) fn(); },
  };
}

function loadDock(provider) {
  const calls = [], responses = [];
  const modules = [];
  vm.runInNewContext(script, {
    window: {__ModuleLoader__: {load: module => modules.push(module)}},
    navigator: {userAgent: 'Node.js test runner'},
    __DSH_TRANSPORT__: {fetch: async (url, init) => {
      calls.push({url, body: JSON.parse(init.body)});
      const response = responses.shift();
      // Mirror the Host envelope: successful calls carry `ok: true` next to their payload.
      return {ok: true, json: async () => response.ok === undefined ? {ok: true, ...response} : response};
    }},
    console, setTimeout, clearTimeout, setInterval, clearInterval, AbortController, AbortSignal,
  }, {timeout: 5000});
  const React = renderableReact();
  const client = modules[0].factory(name => name === 'react' ? React : {createPortal: node => node});
  const registrations = [];
  // ModelDirectory hands out its shared store; the component reads snapshot methods from it.
  const directory = {store: {subscribe: () => () => {}, getSnapshot: () => ({current: {provider, model: 'any-model'}})}};
  client.apply({
    effect: callback => callback(),
    get: name => name === 'modelDirectories' ? {directoryFor: () => directory} : undefined,
    locale: {register() {}, bind: () => key => key, subscribe() {}, getSnapshot() {}},
    layout: {selectPanel() {}, panelInfo: {getSnapshot: () => ({activePanelId: null}), subscribe: () => () => {}}},
    slots: {inject: (_name, callback) => callback(), register: (meta, component) => registrations.push({meta, component})},
  });
  const Toggle = registrations.find(row => row.meta.name === 'conversation.input.right').component;
  const render = sessionId => { React.beginRender(); const tree = Toggle({sessionId}); React.flushEffects(); return tree; };
  return {render, calls, respond: (...rows) => responses.push(...rows)};
}

test('tool-row switch appears only for Capinfo sessions while the feature is on, and follows confirmed state', async () => {
  const tick = () => new Promise(resolve => setImmediate(resolve));
  for (const [provider, status, shown] of [['capinfo', {available: true, enabled: false}, true],
    ['capinfo', {available: false, enabled: false}, false], ['deepseek-official', {available: true, enabled: false}, false]]) {
    const f = loadDock(provider);
    f.respond(status);
    assert.equal(f.render('session-1'), null, 'nothing renders before the Host confirms');
    await tick();
    const tree = f.render('session-1');
    if (!shown) { assert.equal(tree, null, `${provider}/${status.available}`); continue; }
    const toggle = walk(tree).find(node => node.type === 'button');
    assert.equal(toggle.props.role, 'switch');
    assert.equal(toggle.props['aria-checked'], false);
    assert.equal(toggle.props.disabled, false);
    // The control is a host-style switch: label + track/thumb, not a tinted link.
    const track = node => walk(node).find(child => child.props?.className === 'capinfo-session-retry-track');
    assert.equal(track(tree).props['data-on'], undefined, 'off: track has no on marker');
    assert.equal(walk(track(tree)).filter(child => child.props?.className === 'capinfo-session-retry-thumb').length, 1);
    // Toggling posts one write for this session and adopts the returned state only.
    f.respond({available: true, enabled: true});
    toggle.props.onClick();
    assert.equal(f.render('session-1').children.find(node => node.type === 'button').props.disabled, true, 'busy while saving');
    await tick();
    assert.deepEqual(f.calls.map(call => [call.url, call.body]), [
      ['api/plugins/capinfo/retry', {action: 'status', sessionId: 'session-1'}],
      ['api/plugins/capinfo/retry', {action: 'set', sessionId: 'session-1', enabled: true}],
    ]);
    const enabled = f.render('session-1');
    assert.equal(enabled.children.find(node => node.type === 'button').props['aria-checked'], true);
    assert.equal(track(enabled).props['data-on'], true, 'on: the track carries the on marker');
    assert.equal(f.render(undefined), null, 'no bound session, no switch');
  }
  // A failed write is read back once and never replayed or flipped optimistically.
  const f = loadDock('capinfo');
  f.respond({available: true, enabled: false});
  f.render('session-1'); await tick();
  f.respond({ok: false, error: 'offline'}, {available: true, enabled: false});
  walk(f.render('session-1')).find(node => node.type === 'button').props.onClick();
  await tick(); await tick();
  assert.deepEqual(f.calls.map(call => call.body.action), ['status', 'set', 'status']);
  assert.equal(walk(f.render('session-1')).find(node => node.type === 'button').props['aria-checked'], false);
});
