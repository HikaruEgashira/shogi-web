import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { access, cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { headers } from '../scripts/web-headers.mjs';

const run = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const commit = 'a'.repeat(40);

test('built release works at its candidate URL and after promotion; wrong versions fail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-release-'));
  const server = createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    try {
      const bytes = await readFile(join(root, pathname === '/' ? 'index.html' : pathname));
      response.writeHead(200, { ...headers, 'Content-Type': pathname.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream' });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { response.writeHead(404).end(); }
  });
  try {
    await cp(join(repo, 'public'), join(root, 'public'), { recursive: true });
    await run(process.execPath, [join(repo, 'scripts/build.mjs')], { cwd: root, env: { ...process.env, GITHUB_SHA: commit } });
    const release = join(root, 'releases', commit);
    await mkdir(join(root, 'releases'));
    await rename(join(root, 'dist'), release);
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}/`;
    const candidate = `${origin}releases/${commit}/index.html`;
    for (const page of ['index.html', 'licenses.html']) {
      const html = await readFile(join(release, page), 'utf8');
      for (const [, href] of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
        if (href.startsWith('https:') || !/\.(mjs|css|svg|gz|patch|sh|json|txt)$/.test(href)) continue;
        const url = new URL(href, new URL(page, candidate));
        assert.ok(url.pathname.startsWith(`/releases/${commit}/`), href);
        await access(join(root, url.pathname));
      }
    }
    const smoke = url => run(process.execPath, [join(repo, 'scripts/smoke.mjs'), url, commit]);
    await smoke(candidate);
    for (const file of ['index.html', 'licenses.html', 'version.json']) await cp(join(release, file), join(root, file));
    await smoke(origin);
    await writeFile(join(release, 'version.json'), JSON.stringify({ commit: 'b'.repeat(40) }));
    await assert.rejects(smoke(candidate));
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('deployment verifies before switching pages and never promotes a failed candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-deploy-'));
  try {
    await mkdir(join(root, 'bin'));
    await mkdir(join(root, 'dist/engine'), { recursive: true });
    for (const file of ['nn.bin', 'progress.bin', 'yaneuraou.wasm']) await writeFile(join(root, 'dist/engine', file), 'fixture');
    await writeFile(join(root, 'bin/aws'), '#!/bin/sh\nprintf "aws %s\\n" "$*" >> "$TEST_LOG"\n', { mode: 0o755 });
    await writeFile(join(root, 'bin/bun'), '#!/bin/sh\nprintf "verify %s\\n" "$2" >> "$TEST_LOG"\nexit "$TEST_VERIFY_EXIT"\n', { mode: 0o755 });
    for (const exit of ['1', '0']) {
      const logPath = join(root, 'commands.log');
      await writeFile(logPath, '');
      const result = run('bash', [join(repo, 'scripts/deploy.sh')], {
        cwd: root,
        env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TEST_LOG: logPath, TEST_VERIFY_EXIT: exit,
          SITE_BUCKET: 'test-site', DISTRIBUTION_ID: 'test-distribution', SITE_URL: 'https://example.test/', GITHUB_SHA: commit },
      });
      if (exit === '1') await assert.rejects(result);
      else await result;
      const log = await readFile(logPath, 'utf8');
      const candidate = log.indexOf(`verify https://example.test/releases/${commit}/index.html`);
      assert.ok(candidate > log.indexOf('engine/yaneuraou.wasm --content-type'));
      if (exit === '1') {
        assert.doesNotMatch(log, /s3:\/\/test-site\/(index.html|licenses.html|version.json)/);
        assert.doesNotMatch(log, /cloudfront create-invalidation/);
      } else {
        const promotion = log.indexOf('aws s3 cp dist/index.html');
        assert.ok(promotion > candidate);
        assert.ok(log.indexOf('aws cloudfront wait') > promotion);
        assert.ok(log.indexOf('verify https://example.test/\n') > log.indexOf('aws cloudfront wait'));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
