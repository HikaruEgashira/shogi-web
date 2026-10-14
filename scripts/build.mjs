import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import manifest from '../engine/manifest.json' with { type: 'json' };
for (const [name, expected] of [['nn.bin', manifest.nnSha256], ['progress.bin', manifest.progressSha256]]) {
  const hash = createHash('sha256').update(await readFile(`public/engine/${name}`)).digest('hex');
  if (hash !== expected) throw Error(`${name}: checksum mismatch`);
}
await readFile('public/engine/yaneuraou.wasm');
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
