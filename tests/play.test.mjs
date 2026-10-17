import test from 'node:test';
import assert from 'node:assert/strict';
import { serve } from '../scripts/serve.mjs';
import { play } from '../scripts/play.mjs';

test('a browser under the production headers loads the engine and the engine answers a move', { timeout: 130_000 }, async () => {
  const server = await serve('public');
  try {
    const moves = await play(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(moves.length, 2);
    assert.match(moves[0], /^1☗ .*7/);
    assert.match(moves[1], /^2☖ /);
  } finally { server.closeAllConnections(); server.close(); }
});
