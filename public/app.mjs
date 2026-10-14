import { Engine } from './engine-client.mjs';
import { START, PIECES, RANKS, parseSfen, parseState, moveLabel, readSaved } from './rules.mjs';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'hitokyoku.v1';
let state = { ...parseSfen(START), sfen: START, legal: [], check: false };
let human = 'b', moves = [], labels = [], selected = null, engine = null;
let busy = false, started = false, result = '', resigned = false, thinkingTime = 1500;
let saved = null, promotionMoves = [], confirmAction;
try { saved = readSaved(localStorage.getItem(SAVE_KEY)); } catch { /* Private browsing may disable storage. */ }
$('resume').hidden = !saved;

function status(title, detail, phase = '対局中') {
  $('status').textContent = title;
  $('detail').textContent = detail;
  $('phase').textContent = phase;
}
function save() {
  saved = { version: 1, human, time: thinkingTime, moves, resigned };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); }
  catch { $('detail').textContent = 'このブラウザでは自動保存できません。棋譜を保存してから閉じてください。'; }
}
function pieceElement(piece) {
  const el = document.createElement('span');
  el.className = `piece${piece.side !== human ? ' reverse' : ''}${piece.type.startsWith('+') ? ' promoted' : ''}`;
  el.textContent = PIECES[piece.type]; el.setAttribute('aria-hidden', 'true');
  return el;
}
function render() {
  const canPlay = started && !busy && !result && state.turn === human;
  const focused = document.activeElement?.dataset.square;
  const ranks = human === 'b' ? [...'abcdefghi'] : [...'ihgfedcba'];
  const files = human === 'b' ? [...'987654321'] : [...'123456789'];
  $('files').replaceChildren(...files.map(file => Object.assign(document.createElement('span'), { textContent: file })));
  $('ranks').replaceChildren(...ranks.map(rank => Object.assign(document.createElement('span'), { textContent: RANKS['abcdefghi'.indexOf(rank)] })));
  const targets = new Set(state.legal.filter(move => move.startsWith(selected || '!')).map(move => move.slice(2, 4)));
  const squares = ranks.flatMap(rank => files.map(file => {
    const square = file + rank, piece = state.board.get(square), button = document.createElement('button');
    button.className = `square${square === selected ? ' selected' : ''}${targets.has(square) ? ' legal' : ''}${moves.at(-1)?.slice(2, 4) === square ? ' last' : ''}`;
    button.dataset.square = square;
    button.setAttribute('aria-label', `${file}${RANKS['abcdefghi'.indexOf(rank)]} ${piece ? `${piece.side === human ? 'あなた' : '相手'}の${PIECES[piece.type]}` : '空き'}${targets.has(square) ? ' 移動可能' : ''}`);
    button.setAttribute('aria-pressed', String(square === selected));
    button.disabled = !canPlay;
    if (piece) button.append(pieceElement(piece));
    return button;
  }));
  $('board').replaceChildren(...squares);
  if (focused && canPlay) squares.find(button => button.dataset.square === focused)?.focus({ preventScroll: true });
  for (const [id, side] of [['human-hand', human], ['opponent-hand', human === 'b' ? 'w' : 'b']]) {
    const hand = $('' + id); hand.replaceChildren();
    for (const type of ['R', 'B', 'G', 'S', 'N', 'L', 'P']) {
      const count = state.hands[side][type];
      if (!count) continue;
      const button = document.createElement('button');
      button.dataset.drop = `${type}*`; button.classList.toggle('selected', selected === `${type}*`);
      button.setAttribute('aria-label', `${PIECES[type]} ${count}枚${side === human ? 'を打つ' : ''}`);
      button.setAttribute('aria-pressed', String(selected === `${type}*`));
      button.disabled = side !== human || !canPlay;
      const symbol = Object.assign(document.createElement('span'), { className: 'hand-piece', textContent: PIECES[type] });
      const number = Object.assign(document.createElement('span'), { className: 'count', textContent: `×${count}` });
      button.append(symbol, number); hand.append(button);
    }
    if (!hand.children.length) hand.append(Object.assign(document.createElement('span'), { className: 'no-hand', textContent: '持ち駒なし' }));
  }
  $('human-side').textContent = human === 'b' ? '先手' : '後手';
  $('opponent-side').textContent = human === 'b' ? '後手' : '先手';
  $('turn-tag').textContent = result ? '終局' : !started ? '準備中' : busy ? '思考中' : 'あなたの手番';
  $('start').disabled = busy;
  $('start').textContent = started ? '新しく始める' : '対局を始める';
  $('side').disabled = started && !result;
  $('time').disabled = started && !result;
  $('undo').disabled = !started || busy || moves.length < (human === 'b' ? 2 : 3);
  $('resign').disabled = !started || busy || Boolean(result);
  $('declare').hidden = !canPlay || !state.declaration;
  $('export').disabled = !moves.length;
  $('move-count').textContent = `${moves.length} 手`;
  const list = labels.map((label, index) => {
    const item = document.createElement('li');
    item.append(Object.assign(document.createElement('span'), { className: 'move-index', textContent: index + 1 }), document.createTextNode(label));
    return item;
  });
  $('history').replaceChildren(...(list.length ? list : [Object.assign(document.createElement('li'), { className: 'empty-history', textContent: '最初の一手を、ここから。' })]));
  $('history').scrollTop = $('history').scrollHeight;
}
function finish(message) {
  result = message; busy = false;
  status(message, '棋譜を保存するか、新しい対局を始められます。', '終局');
  save(); render();
}
function terminal() {
  if (resigned) { finish('あなたの投了です。'); return true; }
  if (state.repetition === 3) { finish('千日手で引き分けです。'); return true; }
  if ([1, 2].includes(state.repetition)) {
    const humanWins = (state.turn === human) === (state.repetition === 1);
    finish(`連続王手の千日手。${humanWins ? 'あなたの勝ちです。' : '相手の勝ちです。'}`); return true;
  }
  if (!state.legal.length) { finish(state.turn === human ? '詰みです。相手の勝ちです。' : '詰みです。あなたの勝ちです。'); return true; }
  return false;
}
function error(error) {
  busy = false; started = false;
  engine?.close(); engine = null;
  status('対局を開始できません', error.message, '読み込みエラー');
  $('resume').hidden = !saved; render();
}
async function updatePosition() { state = parseState(await engine.position(moves)); }
async function play(move) {
  if (!state.legal.includes(move)) throw Error('エンジンが無効な指し手を返しました。再読み込みしてください。');
  labels.push(moveLabel(move, state)); moves.push(move); selected = null;
  await updatePosition(); save(); render();
}
async function nextTurn() {
  if (terminal()) return;
  if (state.turn !== human) {
    busy = true; status('相手が考えています。', '盤面を眺めながら、次の一手を。'); render();
    if (state.declaration) { finish('相手の入玉宣言。相手の勝ちです。'); return; }
    const move = await engine.search(thinkingTime);
    if (move === 'resign') { finish('相手が投了しました。あなたの勝ちです。'); return; }
    if (move === 'win') { finish('相手の入玉宣言。相手の勝ちです。'); return; }
    await play(move);
    if (terminal()) return;
  }
  busy = false;
  status(state.check ? '王手です。' : 'あなたの手番です。', state.check ? '王手を解消する手を指してください。' : '動かす駒を選んでください。');
  render();
}
async function start(restore = null) {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    error(new Error('この環境ではWASMの共有メモリを利用できません。最新のブラウザで直接このページを開いてください。')); return;
  }
  engine?.close();
  moves = []; labels = []; selected = null; result = ''; resigned = false;
  human = restore?.human || $('side').value;
  thinkingTime = restore?.time || Number($('time').value);
  $('side').value = human; $('time').value = thinkingTime;
  busy = true; started = true; $('resume').hidden = true;
  state = { ...parseSfen(START), sfen: START, legal: [] };
  status('対局を準備しています。', '初回は数MBのデータを読み込みます。', '読み込み中'); render();
  engine = new Engine();
  try {
    await engine.ready(); await updatePosition();
    if (restore) {
      for (const move of restore.moves) {
        if (!state.legal.includes(move)) throw Error('保存された棋譜を復元できません。新しい対局を始めてください。');
        labels.push(moveLabel(move, state)); moves.push(move); await updatePosition();
      }
      resigned = restore.resigned;
    }
    save(); await nextTurn();
  } catch (err) { error(err); }
}
function confirm(title, description, action) {
  $('confirm-title').textContent = title; $('confirm-description').textContent = description;
  confirmAction = action; $('confirm').showModal();
}
$('confirm-yes').onclick = () => { $('confirm').close(); confirmAction?.(); };
$('confirm-no').onclick = () => $('confirm').close();
$('start').onclick = () => {
  if (moves.length || saved?.moves.length) confirm('新しい対局を始めますか？', '自動保存中の棋譜は置き換わります。必要なら先に棋譜を保存してください。', () => start());
  else start();
};
$('resume').onclick = () => start(saved);
$('side').onchange = () => { if (!started) { human = $('side').value; render(); } };
async function submit(move) {
  busy = true; selected = null; render();
  try { await play(move); await nextTurn(); } catch (err) { error(err); }
}
$('board').onclick = event => {
  const square = event.target.closest('[data-square]')?.dataset.square;
  if (!square || busy || result || !started || state.turn !== human) return;
  const options = state.legal.filter(move => move.startsWith(selected || '!') && move.slice(2, 4) === square);
  if (options.length === 2) { promotionMoves = options; $('promotion').showModal(); return; }
  if (options.length === 1) { submit(options[0]); return; }
  selected = state.board.get(square)?.side === human && selected !== square ? square : null;
  render();
};
$('board').onkeydown = event => {
  const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -9, ArrowDown: 9 }[event.key];
  if (!delta) return;
  event.preventDefault();
  const buttons = [...$('board').children], index = buttons.indexOf(document.activeElement);
  buttons[Math.max(0, Math.min(80, index + delta))]?.focus();
};
$('human-hand').onclick = event => {
  const drop = event.target.closest('[data-drop]')?.dataset.drop;
  if (!drop || busy || result || !started) return;
  selected = selected === drop ? null : drop; render();
};
for (const [id, promotion] of [['promote', true], ['unpromote', false]]) $(id).onclick = () => {
  const move = promotionMoves.find(move => move.endsWith('+') === promotion);
  $('promotion').close(); submit(move);
};
$('undo').onclick = async () => {
  busy = true; result = ''; resigned = false; selected = null;
  // Return to the preceding human turn, including after an engine resignation.
  const count = state.turn === human ? 2 : 1;
  moves.splice(-count); labels.splice(-count); render();
  try { await updatePosition(); save(); await nextTurn(); } catch (err) { error(err); }
};
$('resign').onclick = () => confirm('投了しますか？', 'この対局を終了します。棋譜は保存できます。', () => { resigned = true; finish('あなたの投了です。'); });
$('declare').onclick = () => { if (state.declaration) finish('入玉宣言。あなたの勝ちです。'); };
$('export').onclick = () => {
  const text = `# ひと局 / つようら王11micro\n# ${result || '対局中'}\nposition startpos moves ${moves.join(' ')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `shogi-${new Date().toISOString().slice(0, 10)}.usi` });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
render();
