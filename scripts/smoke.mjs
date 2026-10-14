import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import manifest from '../engine/manifest.json' with { type: 'json' };
import { headers } from './web-headers.mjs';
const [origin, argument] = process.argv.slice(2);
assert.ok(origin, 'usage: node scripts/smoke.mjs URL [COMMIT]');
async function get(path, method = 'GET') {
  const response = await fetch(new URL(path, origin), { method, signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200, path);
  return response;
}
// Without an expected commit, verify whatever the site says it serves (scheduled production checks).
const expected = argument ?? (await (await get('./version.json')).json()).commit;
assert.ok(/^[a-f0-9]{40}$/.test(expected), 'expected a 40-hex commit');
const page = await get('');
for (const [key, value] of Object.entries(headers)) assert.equal(page.headers.get(key), value, key);
assert.ok((await page.text()).includes(`/releases/${expected}/app.mjs`));
assert.equal((await (await get('./version.json')).json()).commit, expected);
await Promise.all(['app.mjs', 'i18n.mjs', 'engine-client.mjs', 'rules.mjs', 'engine-worker.js', 'style.css', 'icon.svg', 'licenses.html', 'engine/yaneuraou.js', 'engine/yaneuraou.worker.js', 'source/yaneuraou.tar.gz', 'source/browser.patch', 'source/build-engine.sh', 'source/manifest.json', 'source/GPL-3.0.txt'].map(name => get(`/releases/${expected}/${name}`, 'HEAD')));
const wasm = await get(`/releases/${expected}/engine/yaneuraou.wasm`);
assert.equal(wasm.headers.get('content-type'), 'application/wasm');
for (const [name, hash] of [['nn.bin', manifest.nnSha256], ['progress.bin', manifest.progressSha256], ['yaneuraou.wasm', manifest.wasmSha256]]) {
  const bytes = Buffer.from(await (await get(`/releases/${expected}/engine/${name}`)).arrayBuffer());
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
}
console.log(`Verified ${origin} at ${expected}: headers, release, WASM and evaluation checksums, source.`);
