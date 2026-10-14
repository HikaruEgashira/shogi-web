import { translate, messages } from './i18n.mjs';
import { Engine } from './engine-client.mjs';
import { START, PIECES, RANKS, parseSfen, parseState, moveLabel, readSaved } from './rules.mjs';

const $ = id => document.getElementById(id);
const SAVE_KEY = 'shogi.v1';
let state = { ...parseSfen(START), sfen: START, legal: [], check: false };
let human = 'b', moves = [], labels = [], selected = null, engine = null;
let busy = false, started = false, result = '', resigned = false, thinkingTime = 1500;
let saved = null, promotionMoves = [], confirmAction;
let language = navigator.language.startsWith('ja') ? 'ja' : 'en';
let notation, theme = 'system';
try {
  const preferred = localStorage.getItem('shogi-language');
  if (['ja', 'en'].includes(preferred)) language = preferred;
  notation = localStorage.getItem('shogi-pieces');
  const preferredTheme = localStorage.getItem('shogi-theme');
  if (['system', 'light', 'dark'].includes(preferredTheme)) theme = preferredTheme;
} catch { /* Preferences are optional when storage is unavailable. */ }
if (!['letters', 'kanji'].includes(notation)) notation = language === 'ja' ? 'kanji' : 'letters';
const tr = (key, values) => translate(language, key, values);
const THEME_COLORS = { light: '#fcfcfd', dark: '#08090a' };
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const resolved = theme === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : theme;
  document.querySelector('meta[name="theme-color"]').setAttribute('content', THEME_COLORS[resolved]);
}
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => { if (theme === 'system') applyTheme(); });
let statusKeys = ['before', 'chooseSettings', 'setup'];
function translatePage() {
  document.documentElement.lang = language;
  document.title = tr('title');
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = tr(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-label]')) { el.setAttribute('aria-label', tr(el.dataset.i18nLabel)); el.title = tr(el.dataset.i18nLabel); }
  for (const [id, key] of [['board', 'board'], ['opponent-hand', 'opponentHand'], ['human-hand', 'yourHand'], ['history', 'record']]) $(id).setAttribute('aria-label', tr(key));
  $('language').value = language; $('notation').value = notation; $('theme').value = theme;
  status(...statusKeys);
}
function label(move) { return { ja: moveLabel(move, state, 'ja'), en: moveLabel(move, state, 'en') }; }
try { saved = readSaved(localStorage.getItem(SAVE_KEY)); } catch { /* Private browsing may disable storage. */ }
$('resume').hidden = !saved;

function status(title, detail, phase = 'playing') {
  statusKeys = [title, detail, phase];
  $('status').textContent = tr(title);
  $('detail').textContent = tr(detail);
  $('detail').hidden = !['loading', 'errorPhase'].includes(phase);
}
function save() {
  saved = { version: 1, human, time: thinkingTime, moves, resigned, result };
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(saved)); }
  catch { $('detail').textContent = tr('storageError'); $('detail').hidden = false; }
}
function pieceElement(piece) {
  const el = document.createElement('span');
  el.className = `piece${piece.side !== human ? ' reverse' : ''}${piece.type.startsWith('+') ? ' promoted' : ''}`;
  el.textContent = notation === 'kanji' ? PIECES[piece.type] : piece.type;
  el.classList.toggle('letters', notation === 'letters'); el.setAttribute('aria-hidden', 'true');
  return el;
}
function render() {
  document.querySelector('.human').classList.toggle('active', started && !result && state.turn === human);
  document.querySelector('.opponent').classList.toggle('active', started && !result && state.turn !== human);
  document.querySelector('.human .player-symbol').textContent = human === 'b' ? '☗' : '☖';
  document.querySelector('.opponent .player-symbol').textContent = human === 'b' ? '☖' : '☗';
  const canPlay = started && !busy && !result && state.turn === human;
  const focused = document.activeElement?.dataset.square;
  const ranks = human === 'b' ? [...'abcdefghi'] : [...'ihgfedcba'];
  const files = human === 'b' ? [...'987654321'] : [...'123456789'];
  $('files').replaceChildren(...files.map(file => Object.assign(document.createElement('span'), { textContent: file })));
  $('ranks').replaceChildren(...ranks.map(rank => Object.assign(document.createElement('span'), { textContent: language === 'ja' ? RANKS['abcdefghi'.indexOf(rank)] : rank })));
  const targets = new Set(state.legal.filter(move => move.startsWith(selected || '!')).map(move => move.slice(2, 4)));
  const squares = ranks.flatMap(rank => files.map(file => {
    const square = file + rank, piece = state.board.get(square), button = document.createElement('button');
    button.className = `square${square === selected ? ' selected' : ''}${targets.has(square) ? ' legal' : ''}${moves.at(-1)?.slice(2, 4) === square ? ' last' : ''}`;
    button.classList.toggle('last-from', moves.at(-1)?.slice(0, 2) === square);
    button.classList.toggle('in-check', Boolean(state.check && piece?.type === 'K' && piece.side === state.turn));
    button.dataset.square = square;
    button.setAttribute('aria-label', `${file}${language === 'ja' ? RANKS['abcdefghi'.indexOf(rank)] : rank} ${piece ? tr(piece.side === human ? 'yourPiece' : 'opponentPiece', { piece: notation === 'kanji' ? PIECES[piece.type] : piece.type }) : tr('emptySquare')}${targets.has(square) ? ` ${tr('legal')}` : ''}`);
    button.setAttribute('aria-pressed', String(square === selected));
    button.disabled = !canPlay;
    if (piece) button.append(pieceElement(piece));
    return button;
  }));
  $('board').replaceChildren(...squares);
  if (focused && canPlay) squares.find(button => button.dataset.square === focused)?.focus({ preventScroll: true });
  for (const [id, side] of [['human-hand', human], ['opponent-hand', human === 'b' ? 'w' : 'b']]) {
    const hand = $(id); hand.replaceChildren();
    for (const type of ['R', 'B', 'G', 'S', 'N', 'L', 'P']) {
      const count = state.hands[side][type];
      if (!count) continue;
      const button = document.createElement('button');
      button.dataset.drop = `${type}*`; button.classList.toggle('selected', selected === `${type}*`);
      button.setAttribute('aria-label', tr(side === human ? 'drop' : 'held', { piece: notation === 'kanji' ? PIECES[type] : type, count }));
      button.setAttribute('aria-pressed', String(selected === `${type}*`));
      button.disabled = side !== human || !canPlay;
      const symbol = Object.assign(document.createElement('span'), { className: 'hand-piece', textContent: notation === 'kanji' ? PIECES[type] : type });
      const number = Object.assign(document.createElement('span'), { className: 'count', textContent: `×${count}` });
      button.append(symbol, number); hand.append(button);
    }
    if (!hand.children.length) hand.append(Object.assign(document.createElement('span'), { className: 'no-hand', textContent: tr('noHand') }));
  }
  $('human-side').textContent = tr(human === 'b' ? 'sente' : 'gote');
  $('opponent-side').textContent = tr(human === 'b' ? 'gote' : 'sente');
  $('start').disabled = busy;
  $('start').textContent = tr(started ? 'newGame' : 'start');
  $('side').disabled = started && !result;
  $('time').disabled = started && !result;
  $('undo').disabled = !started || busy || moves.length < (human === 'b' ? 2 : 3);
  $('resign').disabled = !started || busy || Boolean(result);
  $('declare').hidden = !canPlay || !state.declaration;
  $('export').disabled = !moves.length;
  $('move-count').textContent = tr('moveCount', { count: moves.length });
  const list = labels.map((label, index) => {
    const item = document.createElement('li');
    item.append(Object.assign(document.createElement('span'), { className: 'move-index', textContent: index + 1 }), document.createTextNode(label[language]));
    return item;
  });
  $('history').replaceChildren(...(list.length ? list : [Object.assign(document.createElement('li'), { className: 'empty-history', textContent: tr('empty') })]));
  $('history').scrollTop = $('history').scrollHeight;
  $('piece-guide').hidden = notation !== 'letters';
}
function finish(message) {
  result = message; busy = false;
  status(message, 'resultDetail', 'finished');
  save(); render();
}
function terminal() {
  if (result) { finish(result); return true; }
  if (resigned) { finish('resigned'); return true; }
  if (state.repetition === 3) { finish('draw'); return true; }
  if ([1, 2].includes(state.repetition)) {
    const humanWins = (state.turn === human) === (state.repetition === 1);
    finish(humanWins ? 'perpetualWin' : 'perpetualLose'); return true;
  }
  if (!state.legal.length) { finish(state.turn === human ? 'mateLose' : 'mateWin'); return true; }
  return false;
}
function error(error) {
  busy = false; started = false;
  engine?.close(); engine = null;
  status('errorTitle', messages.en[error.message] ? error.message : 'engineError', 'errorPhase');
  $('resume').hidden = !saved; render();
}
async function updatePosition() { state = parseState(await engine.position(moves)); }
async function play(move) {
  if (!state.legal.includes(move)) throw Error('engineError');
  labels.push(label(move)); moves.push(move); selected = null;
  await updatePosition(); save(); render();
}
async function nextTurn() {
  if (terminal()) return;
  if (state.turn !== human) {
    busy = true; status('thinking', 'thinkingDetail'); render();
    if (state.declaration) { finish('declarationLose'); return; }
    const move = await engine.search(thinkingTime);
    if (move === 'resign') { finish('engineResigned'); return; }
    if (move === 'win') { finish('declarationLose'); return; }
    await play(move);
    if (terminal()) return;
  }
  busy = false;
  status(state.check ? 'check' : 'yourTurn', state.check ? 'resolveCheck' : 'choosePiece');
  render();
}
async function start(restore = null) {
  if (!crossOriginIsolated || typeof SharedArrayBuffer === 'undefined') {
    error(new Error('unsupported')); return;
  }
  engine?.close();
  moves = []; labels = []; selected = null; result = ''; resigned = false;
  human = restore?.human || $('side').value;
  thinkingTime = restore?.time || Number($('time').value);
  $('side').value = human; $('time').value = thinkingTime;
  busy = true; started = true; $('resume').hidden = true;
  state = { ...parseSfen(START), sfen: START, legal: [] };
  status('preparing', 'loadingDetail', 'loading'); render();
  engine = new Engine();
  try {
    await engine.ready(); await updatePosition();
    if (restore) {
      for (const move of restore.moves) {
        if (!state.legal.includes(move)) throw Error('invalidSave');
        labels.push(label(move)); moves.push(move); await updatePosition();
      }
      resigned = restore.resigned; result = restore.result || '';
    }
    save(); await nextTurn();
  } catch (err) { error(err); }
}
function confirm(title, description, action) {
  $('confirm-title').textContent = tr(title); $('confirm-description').textContent = tr(description);
  confirmAction = action; $('confirm').showModal();
}
$('confirm-yes').onclick = () => { $('confirm').close(); confirmAction?.(); };
$('confirm-no').onclick = () => $('confirm').close();
$('start').onclick = () => {
  if (moves.length || saved?.moves.length) confirm('newTitle', 'newDetail', () => start());
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
$('resign').onclick = () => confirm('resignTitle', 'resignDetail', () => { resigned = true; finish('resigned'); });
$('declare').onclick = () => { if (state.declaration) finish('declarationWin'); };
$('export').onclick = () => {
  const text = `# Shogi / TuyouraOu 11micro\n# ${tr(result || 'playing')}\nposition startpos moves ${moves.join(' ')}\n`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: `shogi-${new Date().toISOString().slice(0, 10)}.usi` });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('settings-open').onclick = () => $('settings').showModal();
$('settings-close').onclick = () => $('settings').close();
$('language').onchange = () => {
  language = $('language').value;
  try { localStorage.setItem('shogi-language', language); } catch { /* Optional preference. */ }
  translatePage(); render();
};
$('notation').onchange = () => {
  notation = $('notation').value;
  try { localStorage.setItem('shogi-pieces', notation); } catch { /* Optional preference. */ }
  render();
};
$('theme').onchange = () => {
  theme = $('theme').value;
  try { localStorage.setItem('shogi-theme', theme); } catch { /* Optional preference. */ }
  applyTheme();
};
applyTheme();
translatePage(); render();
