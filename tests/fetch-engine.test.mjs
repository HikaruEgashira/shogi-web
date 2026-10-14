import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const commit = 'c'.repeat(40);

test('fetches the published engine only when its build inputs match, verifying checksums', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-fetch-'));
  const site = join(root, 'site');
  const release = join(site, 'releases', commit);
  const server = createServer(async (request, response) => {
    try {
      response.writeHead(200).end(await readFile(join(site, new URL(request.url, 'http://localhost').pathname)));
    } catch { response.writeHead(404).end(); }
  });
  try {
    for (const path of ['engine', 'scripts/build-engine.sh']) await cp(join(repo, path), join(root, path), { recursive: true });
    for (const directory of ['engine', 'source']) await cp(join(repo, 'public', directory), join(release, directory), { recursive: true });
    // A real build publishes the inputs it was built from; the local public/source may predate an input edit.
    for (const [name, path] of [['manifest.json', 'engine/manifest.json'], ['browser.patch', 'engine/browser.patch'], ['build-engine.sh', 'scripts/build-engine.sh']]) await cp(join(repo, path), join(release, 'source', name));
    await writeFile(join(site, 'version.json'), JSON.stringify({ commit }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const fetchEngine = () => run(process.execPath, [join(repo, 'scripts/fetch-engine.mjs'), origin], { cwd: root });

    await fetchEngine();
    for (const file of ['engine/yaneuraou.wasm', 'engine/nn.bin', 'source/yaneuraou.tar.gz']) {
      assert.deepEqual(await readFile(join(root, 'public', file)), await readFile(join(repo, 'public', file)), file);
    }

    await rm(join(root, 'public'), { recursive: true });
    await writeFile(join(release, 'engine/nn.bin'), 'corrupt');
    await assert.rejects(fetchEngine(), /nn\.bin: checksum mismatch/);
    await assert.rejects(access(join(root, 'public')));

    await cp(join(repo, 'public/engine/nn.bin'), join(release, 'engine/nn.bin'));
    await appendFile(join(root, 'engine/browser.patch'), '\n');
    await assert.rejects(fetchEngine(), /browser\.patch differs/);
    await assert.rejects(access(join(root, 'public')));
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
