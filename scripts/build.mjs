import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from '../engine/manifest.json' with { type: 'json' };
import { engineInputs } from './engine-inputs.mjs';
for (const [name, expected] of [['nn.bin', manifest.nnSha256], ['progress.bin', manifest.progressSha256], ['yaneuraou.wasm', manifest.wasmSha256]]) {
  const hash = createHash('sha256').update(await readFile(`public/engine/${name}`)).digest('hex');
  if (hash !== expected) throw Error(`${name}: checksum mismatch`);
}
// The GPL source we ship must be the source the binary was built from.
for (const [name, input] of Object.entries(engineInputs)) {
  if (!(await readFile(`public/source/${name}`)).equals(await readFile(input))) throw Error(`public/source/${name} differs from ${input}; run \`bun run engine\``);
}
await readFile('public/source/yaneuraou.tar.gz');
await rm('dist', { recursive: true, force: true });
await mkdir('dist');
await cp('public', 'dist', { recursive: true, filter: path => !path.endsWith('banner.png') });
if (process.env.GITHUB_SHA) {
  if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA)) throw Error('Invalid release SHA');
  for (const file of ['index.html', 'licenses.html']) {
    const html = await readFile(`dist/${file}`, 'utf8');
    await writeFile(`dist/${file}`, html.replaceAll(/\.\/(style\.css|app\.mjs|icon\.svg|source\/[^" ]+)/g, `/releases/${process.env.GITHUB_SHA}/$1`));
  }
}
await writeFile('dist/version.json', JSON.stringify({ commit: process.env.GITHUB_SHA || 'local', engine: manifest.commit }) + '\n');
console.log('Built dist/');
