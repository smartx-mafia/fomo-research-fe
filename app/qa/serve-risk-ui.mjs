// Reuse Vitest's installed Vite; no new dependency or lockfile needed.
import {createRequire} from 'node:module';
import {fileURLToPath, pathToFileURL} from 'node:url';
const require = createRequire(import.meta.url);
const vite = require.resolve('vite', {paths: [require.resolve('vitest/package.json')]});
const {createServer} = await import(pathToFileURL(vite).href);
const server = await createServer({
  root: fileURLToPath(new URL('..', import.meta.url)),
  configFile: false,
  resolve: {alias: {'@': fileURLToPath(new URL('../src', import.meta.url))}},
  define: {'process.env': '{}'},
  server: {host: '127.0.0.1', port: 3197, strictPort: true},
});
await server.listen();
console.log('Risk component fixtures: http://127.0.0.1:3197/qa/risk-ui.html');
