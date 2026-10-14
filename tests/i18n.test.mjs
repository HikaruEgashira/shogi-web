import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, translate } from '../public/i18n.mjs';
import { START, parseSfen, moveLabel, readSaved } from '../public/rules.mjs';
test('all supported languages have every UI string and resolve interpolation', () => {
  assert.deepEqual(Object.keys(messages.en).sort(), Object.keys(messages.ja).sort());
  for (const language of ['en', 'ja']) for (const key of Object.keys(messages.en)) assert.ok(translate(language, key));
  assert.equal(translate('en', 'moveCount', { count: 3 }), '3 moves');
  assert.equal(translate('ja', 'yourPiece', { piece: '歩' }), 'あなたの歩');
  assert.equal(moveLabel('7g7f', parseSfen(START), 'en'), '☗ P 7g–7f');
});
test('completed games retain only known result keys', () => {
  const save = { version: 1, human: 'b', time: 1500, moves: [], result: 'declarationWin' };
  assert.equal(readSaved(JSON.stringify(save)).result, 'declarationWin');
  assert.equal(readSaved(JSON.stringify({ ...save, result: '<script>' })).result, '');
});
