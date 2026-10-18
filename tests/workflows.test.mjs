import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const workflows = resolve(import.meta.dirname, '../.github/workflows');
const runner = 'runs-on: [self-hosted, linux, arm64, hikae-flash]';

async function sources() {
  const names = (await readdir(workflows)).filter(name => name.endsWith('.yml'));
  return Promise.all(names.map(async name => [name, await readFile(join(workflows, name), 'utf8')]));
}

test('every job runs on the hikae ARM64 self-hosted runner', async () => {
  const files = await sources();
  assert.ok(files.length > 0);
  for (const [name, yaml] of files) {
    const jobs = yaml.match(/^\s+runs-on:.*$/gm) ?? [];
    assert.ok(jobs.length > 0, `${name} has no runs-on`);
    for (const line of jobs) assert.equal(line.trim(), runner, `${name}: ${line.trim()}`);
    assert.doesNotMatch(yaml, /ubuntu-latest/, name);
  }
});

// Native Emscripten tools and compiler objects are architecture-specific; the WASM engine itself is not.
test('architecture-specific engine caches are keyed by runner.arch', async () => {
  const yaml = await readFile(join(workflows, 'release.yml'), 'utf8');
  for (const name of ['emsdk-3.1.43', 'ccache-']) {
    const key = yaml.match(new RegExp(`^\\s+key: ${name}[^\\n]*`, 'm'));
    assert.ok(key, `${name} cache key missing`);
    assert.match(key[0], /\$\{\{ runner\.arch \}\}/, key[0]);
  }
});
