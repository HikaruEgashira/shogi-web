import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { resolveBrowser } from '../scripts/play.mjs';

// Browser stubs live under the repository's .cache because some CI sandboxes mount /tmp noexec.
const repo = resolve(import.meta.dirname, '..');
async function stubDir() {
  await mkdir(join(repo, '.cache'), { recursive: true });
  return mkdtemp(join(repo, '.cache/browser-test-'));
}

test('CHROME_BIN configures the browser and skips discovery', () => {
  assert.equal(resolveBrowser({ CHROME_BIN: '/opt/browser/chrome', PATH: '' }, 'linux'), '/opt/browser/chrome');
});

test('a self-hosted ARM64 runner finds Chromium when Google Chrome is absent', async () => {
  const bin = await stubDir();
  try {
    await writeFile(join(bin, 'chromium'), '', { mode: 0o755 });
    assert.equal(resolveBrowser({ PATH: bin }, 'linux'), join(bin, 'chromium'));
  } finally { await rm(bin, { recursive: true, force: true }); }
});

test('Google Chrome is preferred over Chromium when both exist', async () => {
  const bin = await stubDir();
  try {
    await writeFile(join(bin, 'google-chrome'), '', { mode: 0o755 });
    await writeFile(join(bin, 'chromium'), '', { mode: 0o755 });
    assert.equal(resolveBrowser({ PATH: bin }, 'linux'), join(bin, 'google-chrome'));
  } finally { await rm(bin, { recursive: true, force: true }); }
});

test('a non-executable file is not treated as a browser', async () => {
  const bin = await stubDir();
  try {
    await writeFile(join(bin, 'chromium'), '', { mode: 0o644 });
    assert.equal(resolveBrowser({ PATH: bin }, 'linux'), 'google-chrome');
  } finally { await rm(bin, { recursive: true, force: true }); }
});

test('macOS falls back to the application bundle path', () => {
  assert.equal(resolveBrowser({ PATH: '' }, 'darwin'), '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
});
