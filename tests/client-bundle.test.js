import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

// Verify the distributed artifact, not just the maintainable source/test seam.
test('bundled client registers the DSH factory without network access or a second React runtime', async () => {
  const script = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const modules = [];
  vm.runInNewContext(script, {
    window: {__ModuleLoader__: {load: module => modules.push(module)}},
    navigator: {userAgent: 'Node.js test runner'},
    fetch: () => {throw new Error('No CDN or network access during bundle loading');},
    console, setTimeout, clearTimeout,
  }, {timeout: 5000});
  assert.equal(modules.length, 1);
  assert.equal(modules[0].id, '@local/dsh-capinfo');
  assert.equal(typeof modules[0].factory, 'function');
  const React = {createElement() {}, useSyncExternalStore() {}, useId() {}, useRef() {}, useState() {}, useEffect() {}, useCallback() {}};
  const ReactDOM = {createPortal(node) {return node;}};
  const imports = [];
  const client = modules[0].factory(name => {
    imports.push(name);
    assert.equal(name === 'react' || name === 'react-dom', true);
    return name === 'react' ? React : ReactDOM;
  });
  assert.deepEqual(imports, ['react', 'react-dom']);
  assert.equal(typeof client.apply, 'function');
  assert.doesNotMatch(script, /<title[ >]|capinfo-chart-cursor|hoveredDay/);
});
