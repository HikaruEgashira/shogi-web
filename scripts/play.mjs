import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// Arm64 Linux has no Google Chrome, so self-hosted runners serve the DevTools protocol from Chromium.
// CHROME_BIN still wins; otherwise the first browser that exists on PATH is used.
export function resolveBrowser(env = process.env, platform = process.platform) {
  if (env.CHROME_BIN) return env.CHROME_BIN;
  const names = platform === 'darwin' ? [macChrome, 'google-chrome', 'chromium'] : ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];
  for (const name of names) {
    if (name.includes('/')) {
      try { accessSync(name, constants.X_OK); return name; } catch {}
      continue;
    }
    for (const directory of (env.PATH ?? '').split(delimiter)) {
      if (!directory) continue;
      const candidate = join(directory, name);
      try { accessSync(candidate, constants.X_OK); return candidate; } catch {}
    }
  }
  return platform === 'darwin' ? macChrome : 'google-chrome';
}

// Runs inside the page: start with the shortest thinking time, play 7六歩 and wait for the engine's reply.
const game = `(async () => {
  const $ = id => document.getElementById(id);
  const square = name => document.querySelector('[data-square="' + name + '"]');
  const until = (condition, failure) => new Promise((resolve, reject) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (condition()) { clearInterval(timer); resolve(); }
      else if (Date.now() - start > 60000) { clearInterval(timer); reject(Error(failure + ': ' + $('status').textContent + ' ' + $('detail').textContent)); }
    }, 50);
  });
  if (!crossOriginIsolated) throw Error('page is not cross-origin isolated');
  $('time').value = '300';
  $('start').click();
  await until(() => !square('7g').disabled, 'engine did not become ready');
  square('7g').click();
  square('7f').click();
  await until(() => $('history').querySelectorAll('li:not(.empty-history)').length === 2 && !square('7g').disabled, 'engine did not reply');
  return [...$('history').children].map(item => item.textContent);
})()`;

// Headers and checksums (smoke.mjs) cannot see a page that loads and then fails. This drives a real browser
// through one move over DevTools Protocol, so a release that cannot play shogi never becomes public.
export async function play(url) {
  const chrome = resolveBrowser();
  const profile = await mkdtemp(join(tmpdir(), 'shogi-chrome-'));
  const args = ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu'];
  // Containerized self-hosted runners run as root, where Chromium cannot use its setuid sandbox.
  if (process.getuid?.() === 0) args.push('--no-sandbox');
  args.push('about:blank');
  const browser = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let alive = true;
  const exited = new Promise(resolve => { browser.on('exit', () => { alive = false; resolve(); }); browser.on('error', () => { alive = false; resolve(); }); });
  try {
    const endpoint = await new Promise((resolve, reject) => {
      let stderr = '';
      browser.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\S+)/); if (match) resolve(match[1]); });
      browser.on('error', reject);
      browser.on('exit', code => reject(Error(`${chrome} exited with ${code}: ${stderr}`)));
    });
    const socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(Error(`${endpoint} refused the DevTools connection`)); });
    const replies = new Map(), events = [], watchers = new Set();
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (!message.id) { events.push(message); for (const watcher of watchers) watcher(); return; }
      const { resolve, reject } = replies.get(message.id);
      replies.delete(message.id);
      message.error ? reject(Error(message.error.message)) : resolve(message.result);
    };
    let sequence = 0;
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { replies.set(++sequence, { resolve, reject }); socket.send(JSON.stringify({ id: sequence, method, params, sessionId })); });
    const seen = condition => new Promise(resolve => { const watcher = () => { if (events.some(condition)) { watchers.delete(watcher); resolve(); } }; watchers.add(watcher); watcher(); });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    for (const method of ['Page.enable', 'Runtime.enable', 'Log.enable']) await call(method, {}, sessionId);
    await call('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId);
    const { loaderId } = await call('Page.navigate', { url }, sessionId);
    await seen(event => event.method === 'Page.lifecycleEvent' && event.params.loaderId === loaderId && event.params.name === 'load');
    const { result, exceptionDetails } = await call('Runtime.evaluate', { expression: game, awaitPromise: true, returnByValue: true }, sessionId);
    // Uncaught exceptions, CSP violations and failed loads surface here even when the page still renders.
    const problems = events
      .filter(event => event.method === 'Runtime.exceptionThrown' || (event.method === 'Log.entryAdded' && event.params.entry.level === 'error'))
      .map(event => event.params.entry?.text || event.params.exceptionDetails.exception?.description || event.params.exceptionDetails.text);
    if (exceptionDetails) problems.unshift(exceptionDetails.exception?.description || exceptionDetails.text);
    assert.deepEqual(problems, [], `${url}\n${problems.join('\n')}`);
    await call('Browser.close');
    return result.value;
  } finally {
    if (alive) { browser.kill(); await exited; }
    await rm(profile, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const url = process.argv[2];
  assert.ok(url, 'usage: bun scripts/play.mjs URL');
  console.log(`Played ${(await play(url)).join(', ')} at ${url}`);
}
