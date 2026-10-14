import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

// Files that decide what public/engine and public/source contain, mapped to the name
// they are published under. Everything that asks "is the engine current?" reads this map.
export const engineInputs = {
  'manifest.json': 'engine/manifest.json',
  'browser.patch': 'engine/browser.patch',
  'build-engine.sh': 'scripts/build-engine.sh',
};

// Content key for the built engine, shared by the fetch/skip decision and the CI cache.
export async function engineInputKey() {
  const hash = createHash('sha256');
  for (const [name, path] of Object.entries(engineInputs)) hash.update(`${name}\0`).update(await readFile(path)).update('\0');
  return hash.digest('hex');
}

if (import.meta.main) console.log(await engineInputKey());
