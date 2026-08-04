import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os'; import path from 'node:path';
const ui = path.resolve('public/ui');
const manifest = JSON.parse(await readFile(path.join(ui, 'source.json'), 'utf8'));
assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.sourceRepository, 'rusDad/layment-designer'); assert.equal(manifest.sourceDirectory, 'frontend/public/ui'); assert.match(manifest.sourceCommit, /^[0-9a-f]{40}$/);
assert.deepEqual(Object.keys(manifest.files), ['tokens.css', 'foundation.css', 'components.css']);
for (const name of Object.keys(manifest.files)) { const bytes = await readFile(path.join(ui, name)); assert.equal(manifest.files[name].bytes, bytes.length); assert.equal(manifest.files[name].sha256, `sha256:${createHash('sha256').update(bytes).digest('hex')}`); }
execFileSync(process.execPath, ['scripts/shared-ui.mjs', 'verify'], { stdio: 'pipe' });
const temporary = await mkdtemp(path.join(os.tmpdir(), 'viewer-shared-ui-')); await cp(ui, temporary, { recursive: true }); await writeFile(path.join(temporary, 'tokens.css'), 'controlled mismatch');
assert.notEqual(spawnSync(process.execPath, ['scripts/shared-ui.mjs', 'verify'], { env: { ...process.env, SHARED_UI_OUTPUT_DIR: temporary } }).status, 0);
console.log('Shared UI bundle tests passed');
