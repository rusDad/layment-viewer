import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = process.env.SHARED_UI_OUTPUT_DIR
  ? path.resolve(process.env.SHARED_UI_OUTPUT_DIR)
  : path.join(ROOT, 'public', 'ui');
const FILES = ['tokens.css', 'foundation.css', 'components.css'];
const REPOSITORY = 'rusDad/layment-designer';
const DIRECTORY = 'frontend/public/ui';
const SHA_RE = /^[0-9a-f]{40}$/;

function fail(message) { throw new Error(`Shared UI: ${message}`); }
function digest(bytes) { return `sha256:${createHash('sha256').update(bytes).digest('hex')}`; }
async function atomicWrite(destination, bytes) {
  const temporary = `${destination}.tmp-${process.pid}`;
  try { await writeFile(temporary, bytes); await rename(temporary, destination); }
  finally { await rm(temporary, { force: true }); }
}
function validateManifest(value) {
  const topKeys = ['schemaVersion', 'sourceRepository', 'sourceCommit', 'sourceDirectory', 'files'];
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value)) !== JSON.stringify(topKeys)) fail('source.json has an unexpected structure');
  if (value.schemaVersion !== 1 || value.sourceRepository !== REPOSITORY || value.sourceDirectory !== DIRECTORY || !SHA_RE.test(value.sourceCommit)) fail('source.json provenance is invalid');
  if (!value.files || JSON.stringify(Object.keys(value.files)) !== JSON.stringify(FILES)) fail('source.json file inventory is invalid');
  for (const name of FILES) {
    const record = value.files[name];
    if (!record || JSON.stringify(Object.keys(record)) !== JSON.stringify(['sha256', 'bytes']) ||
        !/^sha256:[0-9a-f]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.bytes) || record.bytes < 0) fail(`${name} metadata is invalid`);
  }
  return value;
}
async function verify() {
  let manifest;
  try { manifest = validateManifest(JSON.parse(await readFile(path.join(OUTPUT, 'source.json'), 'utf8'))); }
  catch (error) { fail(`cannot verify source.json: ${error.message}`); }
  for (const name of FILES) {
    let bytes;
    try { bytes = await readFile(path.join(OUTPUT, name)); } catch { fail(`${name} is missing`); }
    if (bytes.length !== manifest.files[name].bytes || digest(bytes) !== manifest.files[name].sha256) fail(`${name} does not match source.json`);
  }
  console.log(`Verified Shared UI bundle from ${manifest.sourceRepository}@${manifest.sourceCommit}`);
}
async function sync(source) {
  const checkout = path.resolve(source);
  const sourceDirectory = path.join(checkout, DIRECTORY);
  let commit;
  try { commit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { fail(`cannot determine git commit for ${checkout}`); }
  if (!SHA_RE.test(commit)) fail('source commit must be a full lowercase SHA');
  const contents = {};
  for (const name of FILES) {
    try { contents[name] = await readFile(path.join(sourceDirectory, name)); }
    catch { fail(`${path.join(sourceDirectory, name)} is missing or unreadable`); }
  }
  await mkdir(OUTPUT, { recursive: true });
  for (const name of FILES) await atomicWrite(path.join(OUTPUT, name), contents[name]);
  const manifest = { schemaVersion: 1, sourceRepository: REPOSITORY, sourceCommit: commit, sourceDirectory: DIRECTORY, files: {} };
  for (const name of FILES) manifest.files[name] = { sha256: digest(contents[name]), bytes: contents[name].length };
  await atomicWrite(path.join(OUTPUT, 'source.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Synchronized Shared UI from ${REPOSITORY}@${commit}`);
}

const [mode, ...args] = process.argv.slice(2);
try {
  if (mode === 'verify' && args.length === 0) await verify();
  else if (mode === 'sync') {
    const index = args.indexOf('--source');
    if (args.length && (index < 0 || args.length !== 2)) fail('usage: sync [--source <checkout>]');
    await sync(index < 0 ? path.join(ROOT, '..', 'layment-designer') : args[index + 1]);
  } else fail('usage: shared-ui.mjs <sync [--source <checkout>]|verify>');
} catch (error) { console.error(error.message); process.exitCode = 1; }
