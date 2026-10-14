import test from 'node:test';
import assert from 'node:assert/strict';
import { START, parseSfen, parseState, moveLabel, readSaved } from '../public/rules.mjs';
test('SFEN presentation preserves sides, board coordinates and hands', () => {
  const state = parseSfen(START);
  assert.equal(state.board.size, 40);
  assert.deepEqual(state.board.get('7g'), { type: 'P', side: 'b' });
  assert.deepEqual(state.board.get('2b'), { type: 'B', side: 'w' });
  const custom = parseSfen('4k4/9/9/4+B4/9/9/9/9/4K4 w 2R3p 20');
  assert.equal(custom.board.get('5d').type, '+B');
  assert.equal(custom.hands.b.R, 2);
  assert.equal(custom.hands.w.P, 3);
  assert.equal(moveLabel('7g7f', state), '☗ 7六歩');
  assert.throws(() => parseSfen('8/9/9/9/9/9/9/9/9 b - 1'));
});
test('engine protocol distinguishes empty moves and terminal state', () => {
  const state = parseState(`webstate ${START}|1|3|0|`);
  assert.equal(state.check, true);
  assert.equal(state.repetition, 3);
  assert.deepEqual(state.legal, []);
});
test('saved records accept only bounded USI moves and supported settings', () => {
  const data = { version: 1, human: 'b', time: 1500, moves: ['7g7f', '3c3d', '8h2b+', 'R*5e'] };
  assert.deepEqual(readSaved(JSON.stringify(data)).moves, data.moves);
  assert.equal(readSaved(JSON.stringify({ ...data, moves: ['7g7f\nquit'] })), null);
  assert.equal(readSaved(JSON.stringify({ ...data, moves: Array(1025).fill('7g7f') })), null);
  assert.equal(readSaved('{'), null);
  assert.equal(readSaved(JSON.stringify({ ...data, result: 'declarationWin' })).result, 'declarationWin');
  assert.equal(readSaved(JSON.stringify({ ...data, result: '<script>' })).result, '');
});
