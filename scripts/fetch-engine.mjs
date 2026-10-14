import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { engineInputs } from './engine-inputs.mjs';
// The published site is the authoritative artifact store: fetch the engine instead of building it
// whenever the published build inputs equal the local ones.
const site = process.argv[2] || process.env.SITE_URL || 'https://shogi.egahika.dev/';
const files = {
  engine: ['yaneuraou.js', 'yaneuraou.worker.js', 'yaneuraou.wasm', 'nn.bin', 'progress.bin', 'eval_options.txt', 'tag.json'],
  source: ['yaneuraou.tar.gz', 'browser.patch', 'build-engine.sh', 'manifest.json', 'GPL-3.0.txt'],
};
async function get(path) {
  const response = await fetch(new URL(path, site), { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw Error(`${response.status} ${path}`);
  return Buffer.from(await response.arrayBuffer());
}
const manifest = JSON.parse(await readFile('engine/manifest.json', 'utf8'));
const { commit } = JSON.parse(await get('version.json'));
if (!/^[a-f0-9]{40}$/.test(commit)) throw Error('Invalid published commit');
const release = `releases/${commit}/`;
for (const [name, local] of Object.entries(engineInputs)) {
  if (!(await get(`${release}source/${name}`)).equals(await readFile(local))) throw Error(`${local} differs from the published build ${commit.slice(0, 7)}; run \`bun run engine\``);
}
const fetched = [];
for (const [directory, names] of Object.entries(files)) for (const name of names) fetched.push([`public/${directory}/${name}`, await get(`${release}${directory}/${name}`)]);
const bytes = Object.fromEntries(fetched);
for (const [name, expected] of [['nn.bin', manifest.nnSha256], ['progress.bin', manifest.progressSha256], ['yaneuraou.wasm', manifest.wasmSha256]]) {
  if (createHash('sha256').update(bytes[`public/engine/${name}`]).digest('hex') !== expected) throw Error(`${name}: checksum mismatch`);
}
// Write only after every file is verified so a failure never leaves a half-fetched engine.
for (const directory of Object.keys(files)) await mkdir(`public/${directory}`, { recursive: true });
for (const [path, content] of fetched) await writeFile(path, content);
console.log(`Fetched engine ${manifest.commit.slice(0, 7)} published at ${commit.slice(0, 7)} from ${site}`);
