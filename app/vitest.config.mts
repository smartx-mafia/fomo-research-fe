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
    // harness 的 balance.ts 在模块顶层读 NEXT_PUBLIC_SOLANA_RPC_URL，缺了就在
    // stubFetch 生效前抛错。源仓库的同一批测试能绿，唯一原因是开发机的 .env.local
    // 里恰好有这个变量 —— 即源仓库在干净 clone / CI 上跑这 5 条同样是红的。
    // 这里注入一个显然不可路由的假值：测试全程 stub 掉 fetch，从不真的发请求，
    // 这个值只是为了越过那道非空校验。
    // 宿主自己的测试不受影响：它们读 SOLANA_RPC_URL 走的是 vi.mock('@/config')，
    // 没有任何测试断言该环境变量为空（已核）。
    env: {
      NEXT_PUBLIC_SOLANA_RPC_URL: 'https://rpc.invalid.test',
    },
    server: {
      deps: {
        inline: ['@solana/web3.js', 'rpc-websockets', 'uuid'],
      },
    },
  },
});
