/* global YaneuraOu */
importScripts('./engine/yaneuraou.js');
const commands = [];
let engine;
self.onmessage = ({ data }) => engine ? engine.postMessage(data.command) : commands.push(data.command);
async function start() {
  const files = await Promise.all(['nn.bin', 'progress.bin'].map(async name => {
    const response = await fetch(`./engine/${name}`);
    if (!response.ok) throw Error('engineLoad');
    return [name, new Uint8Array(await response.arrayBuffer())];
  }));
  engine = await YaneuraOu({
    mainScriptUrlOrBlob: new URL('./engine/yaneuraou.js', self.location.href).href,
    locateFile: name => new URL(`./engine/${name}`, self.location.href).href,
    onAbort: () => self.postMessage({ error: 'engineError' }),
  });
  engine.addMessageListener(line => self.postMessage({ line }));
  engine.FS.mkdir('/eval');
  for (const [name, bytes] of files) engine.FS.writeFile(`/eval/${name}`, bytes);
  for (const command of commands) engine.postMessage(command);
  commands.length = 0;
}
start().catch(error => self.postMessage({ error: error.message }));
