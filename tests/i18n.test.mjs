import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, translate } from '../public/i18n.mjs';
import { START, parseSfen, moveLabel } from '../public/rules.mjs';
test('all supported languages have every UI string and resolve interpolation', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ja).sort());
  for (const language of ['en', 'ja']) for (const key of Object.keys(messages.en)) assert.ok(translate(language, key));
  assert.equal(translate('en', 'moveCount', { count: 3 }), '3');
  assert.equal(translate('ja', 'yourPiece', { piece: '歩' }), 'あなたの歩');
  assert.equal(moveLabel('7g7f', parseSfen(START), 'en'), '☗ P 7g–7f');
});
