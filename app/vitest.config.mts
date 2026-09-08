import {defineConfig} from 'vitest/config';
import {fileURLToPath} from 'node:url';

export default defineConfig({
  resolve: {
    conditions: ['browser'],
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@solana/web3.js': fileURLToPath(new URL('./node_modules/@solana/web3.js/lib/index.browser.esm.js', import.meta.url)),
    },
  },
  test: {
    server: {
      deps: {
        inline: ['@solana/web3.js', 'rpc-websockets', 'uuid'],
      },
    },
  },
});
