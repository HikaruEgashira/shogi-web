export class Engine {
  constructor(onInfo = () => {}) {
    this.worker = new Worker(new URL('./engine-worker.js', import.meta.url));
    this.worker.onmessage = ({ data }) => {
      if (data.error) { this.fail(new Error(data.error)); return; }
      if (data.line?.startsWith('info depth')) onInfo(data.line);
      if (this.pending?.matches(data.line)) {
        const { resolve, timer } = this.pending;
        clearTimeout(timer); this.pending = null; resolve(data.line);
      }
    };
    this.worker.onerror = event => this.fail(new Error(`思考エンジンを起動できませんでした。${event.message || 'ページを再読み込みしてください。'}`));
  }
  fail(error) {
    this.error = error;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
  }
  send(command) { this.worker.postMessage({ command }); }
  request(command, matches, timeout = 20000) {
    if (this.error) return Promise.reject(this.error);
    if (this.pending) return Promise.reject(new Error('Engine request already pending'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.fail(new Error('エンジンの応答がありません。棋譜は保存されています。再読み込みして再開してください。')), timeout);
      this.pending = { matches, resolve, reject, timer };
      this.send(command);
    });
  }
  async ready() {
    await this.request('usi', line => line === 'usiok', 90000);
    for (const command of ['setoption name EvalDir value /eval', 'setoption name FV_SCALE value 24', 'setoption name USI_Hash value 16', 'setoption name Threads value 1', 'setoption name BookFile value no_book', 'setoption name EnteringKingRule value CSARule27', 'setoption name GenerateAllLegalMoves value true']) this.send(command);
    await this.request('isready', line => line === 'readyok', 60000);
    this.send('usinewgame');
  }
  async position(moves, root = 'startpos') {
    this.send(`position ${root}${moves.length ? ` moves ${moves.join(' ')}` : ''}`);
    return this.request('webstate', line => line?.startsWith('webstate '));
  }
  async search(time) {
    const line = await this.request(`go movetime ${time}`, line => line?.startsWith('bestmove '), time + 30000);
    return line.split(' ')[1];
  }
  close() { this.fail(new Error('対局を終了しました。')); this.worker.terminate(); }
}
