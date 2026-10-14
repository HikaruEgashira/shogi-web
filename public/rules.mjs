export const START = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
export const PIECES = { P: '歩', L: '香', N: '桂', S: '銀', G: '金', B: '角', R: '飛', K: '玉', '+P': 'と', '+L': '杏', '+N': '圭', '+S': '全', '+B': '馬', '+R': '龍' };
export const RANKS = '一二三四五六七八九';
export const MOVE = /^(?:[1-9][a-i][1-9][a-i]\+?|[PLNSGBR]\*[1-9][a-i])$/;

export function parseSfen(sfen) {
  const [placement, turn, held, ply] = sfen.split(' ');
  if (!['b', 'w'].includes(turn) || !/^\d+$/.test(ply)) throw Error('Invalid SFEN');
  const board = new Map();
  const rows = placement.split('/');
  if (rows.length !== 9) throw Error('Invalid SFEN rows');
  rows.forEach((row, rank) => {
    let file = 9, promoted = false;
    for (const char of row) {
      if (/[1-9]/.test(char)) { file -= Number(char); continue; }
      if (char === '+') { promoted = true; continue; }
      const type = (promoted ? '+' : '') + char.toUpperCase();
      if (!PIECES[type] || file < 1) throw Error('Invalid SFEN piece');
      board.set(`${file}${'abcdefghi'[rank]}`, { type, side: char === char.toUpperCase() ? 'b' : 'w' });
      file--; promoted = false;
    }
    if (file !== 0 || promoted) throw Error('Invalid SFEN row');
  });
  const hands = { b: {}, w: {} };
  if (held !== '-') {
    if (!/^(?:\d*[PLNSGBRplnsgbr])+$/.test(held)) throw Error('Invalid SFEN hand');
    for (const [, count, char] of held.matchAll(/(\d*)([PLNSGBRplnsgbr])/g)) {
      hands[char === char.toUpperCase() ? 'b' : 'w'][char.toUpperCase()] = Number(count || 1);
    }
  }
  return { board, hands, turn, ply: Number(ply) };
}

export function parseState(line) {
  const [sfen, check, repetition, declaration, moves] = line.slice('webstate '.length).split('|');
  const legal = moves.trim() ? moves.trim().split(/\s+/) : [];
  if (legal.some(move => !MOVE.test(move))) throw Error('Invalid engine move');
  return { ...parseSfen(sfen), sfen, check: check === '1', repetition: Number(repetition), declaration: declaration === '1', legal };
}

export function moveLabel(move, state) {
  const target = move.slice(2, 4);
  const drop = move[1] === '*';
  const piece = drop ? move[0] : state.board.get(move.slice(0, 2))?.type;
  return `${state.turn === 'b' ? '☗' : '☖'} ${target[0]}${RANKS['abcdefghi'.indexOf(target[1])]}${PIECES[piece] || ''}${drop ? '打' : move.endsWith('+') ? '成' : ''}`;
}

export function readSaved(text) {
  try {
    const data = JSON.parse(text);
    if (data.version !== 1 || !['b', 'w'].includes(data.human) || ![300, 1500, 5000].includes(data.time) || !Array.isArray(data.moves) || data.moves.length > 1024 || data.moves.some(move => typeof move !== 'string' || !MOVE.test(move))) return null;
    return { version: 1, human: data.human, time: data.time, moves: data.moves, resigned: data.resigned === true };
  } catch { return null; }
}
