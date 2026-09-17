/**
 * 在 Node 里对着某个 business 打两发只读请求，并把耗时打出来。
 *
 * 这是 01 号 ticket 的验收脚本，也是后面所有压测脚本的最小骨架：**同一份
 * 契约（`src/api.ts`）既服务页面也服务脚本**，这里证明它在 Node 里确实跑得动。
 *
 * # 怎么跑
 *
 *     HARNESS_API_ORIGIN=https://sm-test-api.smartx.io \
 *     HARNESS_TOKEN=$(cd ../../smartx-backend && go run ./scripts/devtoken -user <identifier>) \
 *     npx pnpm@10 run harness:probe
 *
 * 源仓库里这一行是 `npx vite-node scripts/probe.ts`，理由原话是：
 *
 * > 用 `vite-node` 而不是 `node`：`envs.ts` 读 `import.meta.env`，那是 vite 的东西，
 * > 裸 node 解不了。仓库里本来就装着 vite-node，不必新加依赖。
 *
 * 迁到 Next 之后那条理由不再成立，所以换成了 `tsx`：`import.meta.env` 已随
 * 环境表一起改成 `process.env.NEXT_PUBLIC_*`，而读 `localStorage` 的那半边被
 * 拆进了 `envs.browser.ts`（见该文件头部）。`tsx` 只做 TS→JS，不带任何
 * bundler 语义 —— 也就是说，这个脚本的依赖链里**不能再有任何 vite 专有的东西**，
 * 有的话是当场 `SyntaxError`，不会静默走到错的分支上。
 *
 * # 为什么 token 从环境变量来，而不是这里去签
 *
 * 签 token 要读后端仓的私钥与配置，把那段搬进来等于让这个仓库多一条对后端
 * 目录结构的依赖，而那条依赖平时不会被执行，坏掉了也没人知道。让调用方
 * 用 `$( )` 灌进来，这里只管用。
 *
 * # 为什么打的是这两条路
 *
 * `/v1/meme/chains` 不带用户维度，验的是「这个后端认得这条路由、信封层活着」；
 * `/v1/portfolio` 带用户维度，验的是「这个 token 真的被认下来了」。
 * 只打前者的话，token 是不是有效根本测不出来 —— 而 token 无效恰恰是这条路上
 * 最容易出的问题（本机签的私钥与目标环境对不上时，症状就是 400000）。
 */

import {ApiError, callWithToken, listPositions} from '../../src/features/harness/api';
import {setBaseOrigin, setTimingHook, type RequestTiming} from '../../src/features/harness/transport';

type ChainsReply = {chains: {chain: string; chain_id: number; kind: string}[]};

const origin = process.env.HARNESS_API_ORIGIN ?? '';
const token = process.env.HARNESS_TOKEN ?? '';

if (!origin || !token) {
  // 缺哪个就说哪个。只说"配置不全"的话，人得回来读源码才知道要配什么。
  console.error('缺环境变量：');
  if (!origin) console.error('  HARNESS_API_ORIGIN  后端地址，如 http://10.0.0.1');
  if (!token) console.error('  HARNESS_TOKEN       本站 JWT，用后端仓的 scripts/devtoken 签');
  process.exit(2);
}

setBaseOrigin(origin);

const timings: RequestTiming[] = [];
setTimingHook((t) => timings.push(t));

/** 毫秒，一位小数。差值一律在单调时钟之间算（见 `RequestTiming`）。 */
const ms = (a: number, b: number) => `${(b - a).toFixed(1)}ms`;

function report(): void {
  console.log('');
  console.log('耗时：');
  for (const t of timings) {
    const total = ms(t.startedAt, t.completedAt);
    // 请求没发出去时没有首字节时刻，那正是它与「后端很慢」的分辨点，
    // 所以这里写成 '-' 而不是 0 —— 0 会被读成"瞬间就回了"。
    const ttfb = t.firstByteAt === undefined ? '-' : ms(t.startedAt, t.firstByteAt);
    const body = t.firstByteAt === undefined ? '-' : ms(t.firstByteAt, t.completedAt);
    const verdict = t.ok ? 'ok' : `失败(${t.failure}${t.code === undefined ? '' : ` code=${t.code}`})`;
    console.log(
      `  ${t.method.padEnd(5)} ${t.url}\n` +
        `        总计 ${total}  首字节 ${ttfb}  读包 ${body}  ${verdict}\n` +
        `        发出 x-request-id=${t.sentRequestID}  后端 trace_id=${t.traceID ?? '(无)'}`,
    );
    if (t.traceID !== undefined && t.traceID !== t.sentRequestID) {
      // 契约说非法的 x-request-id 是**静默**丢弃，后端自己另生成一个。
      // 不比对就永远发现不了，而发现不了的后果是报障时给出的 ID 查不到东西。
      console.log('        ✗ 两个 ID 不一致 —— 我们发的那个被后端判非法丢弃了');
    }
  }
}

async function main(): Promise<void> {
  console.log(`后端：${origin}`);

  const chains = await callWithToken<ChainsReply>(token, '/v1/meme/chains');
  console.log(`链：${chains.chains.map((c) => `${c.chain}(${c.chain_id},${c.kind})`).join(' ')}`);

  const positions = await listPositions(token);
  console.log(`仓位：${positions.length} 行`);

  report();
}

main().catch((e: unknown) => {
  report();
  console.error('');
  if (e instanceof ApiError) {
    // 业务码和 trace 是报障时的全部线索，单独拎出来，别让人去长文案里找。
    console.error(`失败：${e.message}`);
    console.error(`  kind=${e.kind} code=${e.code}${e.reason ? ` reason=${e.reason}` : ''}`);
    if (e.code === 400000) {
      console.error('  400000 说的是「未认证」：多半是签这个 token 的私钥与目标环境对不上。');
    }
  } else {
    console.error(`失败：${e instanceof Error ? e.message : String(e)}`);
  }
  process.exit(1);
});
