/** Optional custom dev server. API HTTP and WebSocket traffic is browser-direct. */
import {createServer} from 'node:http';
import next from 'next';

const port = Number(process.env.PORT || 3000);
const app = next({dev: true, hostname: '0.0.0.0', port});
await app.prepare();

const handle = app.getRequestHandler();
const upgrade = app.getUpgradeHandler();
const server = createServer((request, response) => handle(request, response));

server.on('upgrade', (request, socket, head) => upgrade(request, socket, head));
server.listen(port, () => {
  console.log(`> dev server on http://0.0.0.0:${port} (browser-direct APIs)`);
});
