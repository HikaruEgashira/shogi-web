import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const repo = resolve(import.meta.dirname, '..');
const directory = join(repo, '.github/workflows');

test('every workflow job runs on the self-hosted hikae-2vcpu-ubuntu-2404 ARM64 runner', async () => {
  const files = (await readdir(directory)).filter(name => name.endsWith('.yml'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const yaml = await readFile(join(directory, file), 'utf8');
    const runners = [...yaml.matchAll(/^\s*runs-on:\s*(.+)$/gm)].map(match => match[1].trim());
    assert.ok(runners.length > 0, `${file} has no runs-on`);
    for (const runner of runners) {
      assert.equal(runner, 'hikae-2vcpu-ubuntu-2404', `${file}: ${runner}`);
    }
  }
});
