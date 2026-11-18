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
  assert.equal(registrations.length, 5);
  const byName = Object.fromEntries(registrations.map(row => [row.meta.name, row.meta]));
  assert.deepEqual(Object.keys(byName).sort(), ['main', 'settings.section', 'settings.section.icon', 'shell.overlay', 'sidebar.panellist']);
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
