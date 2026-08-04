import assert from 'node:assert/strict'; import { readFile } from 'node:fs/promises';
const html = await readFile('public/nc/index.html', 'utf8'); const ui = await readFile('public/nc/NcUi.js', 'utf8'); const css = await readFile('public/style.css', 'utf8');
const links = [...html.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
assert.deepEqual(links, ['../ui/tokens.css', '../ui/foundation.css', '../ui/components.css', '../style.css']); assert.ok(links.every((link) => link.startsWith('../') && !link.includes('://'))); assert.doesNotMatch(`${html}\n${ui}`, /\/dev\/ui\/|onerror\s*=|raw\.githubusercontent/);
for (const hook of ['id="nc-preview"', 'id="nc-download-normalized"', 'data-nc-pane="preview"', 'data-nc-pane-content="source"']) assert.ok(html.includes(hook));
for (const primitive of ['ui-button--primary', 'ui-button--danger', 'ui-panel', 'ui-card', 'ui-field', 'ui-select', 'ui-badge', 'ui-status']) assert.ok(html.includes(primitive));
for (const primitive of ['ui-input', 'ui-select', 'ui-button', 'ui-card', 'ui-toolbar', 'ui-status']) assert.ok(ui.includes(primitive)); assert.match(css, /\.nc-app \{/); for (const motion of ['G0','G1','G2','G3']) assert.ok(html.includes(`>${motion}<`));
console.log('NC Shared UI structure tests passed');
