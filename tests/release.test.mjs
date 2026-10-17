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
    for (const path of ['public', 'engine', 'scripts/build-engine.sh']) await cp(join(repo, path), join(root, path), { recursive: true });
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
    await run(process.execPath, [join(repo, 'scripts/smoke.mjs'), origin]);
    await writeFile(join(release, 'version.json'), JSON.stringify({ commit: 'b'.repeat(40) }));
    await assert.rejects(smoke(candidate));
  } finally {
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});

test('build refuses a WASM or shipped source that does not match the pinned inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-build-'));
  try {
    await cp(join(repo, 'public'), join(root, 'public'), { recursive: true });
    for (const path of ['engine', 'scripts/build-engine.sh']) await cp(join(repo, path), join(root, path), { recursive: true });
    const build = () => run(process.execPath, [join(repo, 'scripts/build.mjs')], { cwd: root });
    await build();
    await writeFile(join(root, 'engine/browser.patch'), 'changed');
    await assert.rejects(build(), /browser\.patch differs/);
    await cp(join(repo, 'engine/browser.patch'), join(root, 'engine/browser.patch'));
    await writeFile(join(root, 'public/engine/yaneuraou.wasm'), 'changed');
    await assert.rejects(build(), /yaneuraou\.wasm: checksum mismatch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// Stub `aws` and `bun` so the shell scripts are exercised against a command log instead of AWS.
async function stubs(root, previous) {
  await mkdir(join(root, 'bin'));
  await writeFile(join(root, 'bin/aws'), `#!/bin/sh
printf "aws %s\\n" "$*" >> "$TEST_LOG"
case "$*" in
  *"version.json -") printf '{"commit":"${previous}","engine":"${previous}"}\\n' ;;
  *create-invalidation*) echo I1 ;;
esac
`, { mode: 0o755 });
  await writeFile(join(root, 'bin/bun'), '#!/bin/sh\nprintf "%s %s\\n" "$1" "$2" >> "$TEST_LOG"\nexit "$TEST_VERIFY_EXIT"\n', { mode: 0o755 });
  return (script, args, exit, revision = commit) => {
    const logPath = join(root, 'commands.log');
    return { logPath, result: writeFile(logPath, '').then(() => run('bash', [join(repo, 'scripts', script), ...args], {
      cwd: root,
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, TEST_LOG: logPath, TEST_VERIFY_EXIT: exit,
        SITE_BUCKET: 'test-site', DISTRIBUTION_ID: 'test-distribution', SITE_URL: 'https://example.test/', GITHUB_SHA: revision },
    })) };
  };
}

test('publishing verifies the candidate over the CDN and never touches the public entry page', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-publish-'));
  try {
    await mkdir(join(root, 'dist/engine'), { recursive: true });
    for (const file of ['nn.bin', 'progress.bin', 'yaneuraou.wasm']) await writeFile(join(root, 'dist/engine', file), 'fixture');
    const publish = await stubs(root, 'b'.repeat(40));
    const candidate = `https://example.test/releases/${commit}/index.html`;
    for (const exit of ['1', '0']) {
      const { logPath, result } = publish('publish.sh', [], exit);
      if (exit === '1') await assert.rejects(result);
      else await result;
      const log = await readFile(logPath, 'utf8');
      assert.ok(log.indexOf(`scripts/smoke.mjs ${candidate}`) > log.indexOf('engine/yaneuraou.wasm --content-type'));
      assert.doesNotMatch(log, /s3:\/\/test-site\/(index\.html|licenses\.html|version\.json)/);
      assert.doesNotMatch(log, /cloudfront/);
      if (exit === '0') assert.ok(log.indexOf(`scripts/play.mjs ${candidate}`) > log.indexOf(`scripts/smoke.mjs ${candidate}`));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('promotion switches the entry page last, verifies the public site, and restores the previous release on failure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-promote-'));
  const previous = 'b'.repeat(40);
  try {
    const promote = await stubs(root, previous);
    for (const exit of ['1', '0']) {
      const { logPath, result } = promote('promote.sh', [commit], exit);
      if (exit === '1') await assert.rejects(result);
      else await result;
      const log = await readFile(logPath, 'utf8');
      const entry = log.indexOf(`aws s3 cp s3://test-site/releases/${commit}/index.html s3://test-site/index.html --metadata-directive REPLACE --content-type text/html --cache-control no-cache,max-age=0,must-revalidate`);
      assert.equal(log.match(/aws s3 cp s3:\/\/test-site\/version.json -/g).length, 1);
      assert.ok(log.indexOf('aws s3 cp s3://test-site/version.json -') < entry);
      assert.ok(log.indexOf(`releases/${commit}/version.json s3://test-site/version.json --metadata-directive REPLACE --content-type application/json`) < entry);
      const invalidation = log.indexOf('aws cloudfront create-invalidation');
      assert.ok(invalidation > entry);
      assert.doesNotMatch(log, /aws cloudfront wait/);
      assert.ok(log.indexOf(`scripts/smoke.mjs https://example.test/`) > invalidation);
      const restore = log.indexOf(`aws s3 cp s3://test-site/releases/${previous}/index.html s3://test-site/index.html`);
      if (exit === '1') {
        assert.ok(restore > log.indexOf('scripts/smoke.mjs'));
        assert.equal(log.match(/create-invalidation/g).length, 2);
      } else {
        assert.equal(restore, -1);
        assert.ok(log.indexOf('scripts/play.mjs https://example.test/') > log.indexOf('scripts/smoke.mjs https://example.test/'));
        assert.equal(log.match(/create-invalidation/g).length, 1);
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('a stale automatic promotion keeps the newer public release while an explicit rollback is allowed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'shogi-stale-release-'));
  const git = args => run('git', args, { cwd: root });
  try {
    await git(['init']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'old']);
    const old = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '--allow-empty', '-m', 'new']);
    const current = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const promote = await stubs(root, current);
    const automatic = promote('promote.sh', [old], '0', old);
    await automatic.result;
    assert.doesNotMatch(await readFile(automatic.logPath, 'utf8'), /aws s3 cp .*releases\/|create-invalidation|scripts\/smoke/);
    const rollback = promote('promote.sh', [old], '0', current);
    await rollback.result;
    assert.match(await readFile(rollback.logPath, 'utf8'), new RegExp(`releases/${old}/index.html`));
  } finally { await rm(root, { recursive: true, force: true }); }
});
