'use client';

import {useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {
  getIdentityToken,
  useCreateWallet as useCreateEvmWallet,
  useLoginWithEmail,
  useLoginWithOAuth,
  usePrivy,
  useWallets as useEvmWallets,
} from '@privy-io/react-auth';
import {
  useCreateWallet as useCreateSolanaWallet,
  useSignAndSendTransaction,
  useWallets,
} from '@privy-io/react-auth/solana';

import {
  ApiError,
  AUTH_METHOD_PRIVY_TYPE,
  login as loginBackend,
  getUserInfo,
  listPositions,
  positionKey,
  timestampMs,
  type AuthMethod,
  type Position,
  type UserInfo,
} from './api';
import {BUSINESS_LABEL, PRIVY_APP_ID} from './config';
// `envs.ts` 迁移时拆成了两半（migration-spec §5.5）：环境表与 `pickEnv()` 是纯的、
// 留在 `envs.ts`；`localStorage` 态（`CURRENT_ENV` / `switchEnv`）挪到
// `envs.browser.ts`。这里只是跟着换 import 来源，取到的值与从前逐字段相同。
import {ENVS, type EnvKey} from './envs';
import {CURRENT_ENV, ENV_DROPPED, switchEnv} from './envs.browser';
import {ErrorPanel} from './errors';
import {decodeJwtPayload, humanDuration, secondsLeft} from './jwt';
import {oauthBlockedReason, useOAuthAvail} from './oauth';
import {runSelfCheck, type SelfCheckResult} from './selfcheck';
import {clearToken, loadToken, saveToken} from './tokencache';
import {signerStatusLabel, useWalletSigners, type SignerStatus} from './signers';
import {SwapPanel, type SellPrefill} from './fastswap/SwapPanel';
import {caipOf, chainOfID} from './chains';
import {codeInfo} from './codes';
import {readiness} from './identity';
import {
  fetchTokenBalance,
  fetchUsdcBalance,
  formatUnits,
  USDC_MINT,
  type UsdcBalance,
} from './balance';
import {
  buildSplTransfer,
  checkDestination,
  encodeBase58,
  fetchDestInfo,
  fetchMintInfo,
  parseUnits,
  type DestInfo,
  type MintInfo,
} from './transfer';
import {
  Badge,
  Btn,
  Card,
  Chip,
  Field,
  GlobalStyles,
  IconSpin,
  IconWarn,
  Info,
  Copy,
  KV,
  Log,
  Mono,
  Note,
  Popover,
  Tabs,
  type Step,
} from './ui';

// 这个页面是 **Fast Swap v2（`/v2/swaps`）的浏览器端参考实现**（2026-09-17 起，v1 `/v1/meme/trades` 已删）：
//
//   capabilities → quote（只看不签）→ 建单 → 可签版本 →（签前核对）→ 浏览器里用
//   embedded 钱包只签不发 →（签后核对）→ 产物落盘 → executions 上报 → 轮询 events 到终态
//
// 协议逻辑全在 src/fastswap/，这个文件只管身份、钱包、持仓、转出与日志。术语见 CONTEXT.md。
//
// 与后端那条 Go harness 的区别仍是那一处：签名发生在**浏览器里**，用的是 Privy 用户自己
// 持有的钥匙。服务端签不动 embedded 钱包 —— app/business/internal/privy/privy_smoke_test.go
// 实测过（401）。

// **「token 过期」这个失败模式已经不存在了**（2026-09-02）。
//
// 这里从前有一个 jwtExpiry()：把 JWT 的 exp 解出来给页面显示，因为过期的
// token 与好用的 token 在页面上长得一模一样 —— 都躺在 localStorage 里，都让
// 那处 custom auth 订阅的 isAuthenticated 保持 true，于是 Privy 每次都拿它去
// 换、每次都被回一句 400 Invalid auth token，而页面上只写着「未认证」。
//
// 现在 token 不进 localStorage、只活在内存里，页面一加载就用 Privy 会话重换
// 一个（见 App 里那个 effect）。所以既没有陈旧的 token，也不需要一个徽章去
// 解释它。这段注释留着是为了说明**为什么少了那个显示**，不是为了纪念。


export function App() {
  const {ready, authenticated, user, logout} = usePrivy();
  const {createWallet: createSolanaWallet} = useCreateSolanaWallet();
  const {createWallet: createEvmWallet} = useCreateEvmWallet();
  const {wallets} = useWallets();
  const {signAndSendTransaction} = useSignAndSendTransaction();
  // token **只活在内存里，不进 localStorage**（2026-09-02 改）。
  //
  // **存 localStorage，按「环境 + Privy DID」分桶**（2026-09-18 改，见 tokencache.ts）。
  //
  // 从前不存，理由是"存着会出现『Privy 已认证（30 天）但本站 token 已过期（72 小时）』"。
  // 那条理由只在没有过期校验时成立 —— 缓存读的时候就查 `exp`，过期与快过期的当作没有。
  //
  // 不存的代价是每次刷新都要重跑 `getIdentityToken()` + `/v1/auth/login`，而调试时刷新
  // 是最高频的动作：2026-09-18 因此撞上 Privy 的 429「Too many requests」，冷却之前谁都
  // 登不进来。
  const [token, setToken] = useState('');

  // identifier 由 `/v1/auth/login` 的回包给出，**页面上只读**。
  //
  // 从前它是一个输入框，因为身份来自 /dev/token 那条只有开发服务器才有的
  // 路。现在身份的唯一来源是真实登录链路 —— 手填一个 identifier 等于声称
  // 自己是别人，而服务端会照着它去查钱包。
  //
  // 它同时是 Privy 那侧 custom_auth 的 custom_user_id（见 identity.ts）。
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [identifier, setIdentifier] = useState('');

  /**
   * 这次会话实际用的登录方式。**它必须与 identity token 里真实存在的绑定
   * 一致**，否则 `/v1/auth/login` 回 100107（见 api.ts 的 login）。
   *
   * 从前它是写死的常量，因为页面只有邮箱一条路。现在有三条（email / Google /
   * Apple，照 `../privy-login-demo`），于是它必须跟着**这一次是怎么登进来的**
   * 走 —— 记错了不会有任何编译错误，只会让登录端点回一个说"登录方式不支持"
   * 的码，而登录方式明明是支持的。
   */
  const [authMethod, setAuthMethod] = useState<AuthMethod>('AUTH_METHOD_EMAIL');
  /**
   * 同一个值的 ref 副本。**换取 token 那一步只能读这一份。**
   *
   * 自动换取跑在一个 effect 里，而它是被 `authenticated` 翻成 true 触发的 ——
   * 那一次渲染里 `authMethod` 这个 state 有没有更新过，取决于 Privy 的
   * onComplete 与它自己的状态更新谁先落到哪一批渲染里，没有保证。
   * 猜错的后果不是崩溃，是 Google 登进来的人被声称成 email 登的，
   * 然后后端回 100107 说"登录方式不支持"。
   */
  const authMethodRef = useRef<AuthMethod>('AUTH_METHOD_EMAIL');
  const pickAuthMethod = useCallback((m: AuthMethod) => {
    authMethodRef.current = m;
    setAuthMethod(m);
  }, []);
  const [oauthBusy, setOauthBusy] = useState<'google' | 'apple' | null>(null);
  const oauthAvail = useOAuthAvail();

  /** 后端自检（两个探针）的结果。null = 还没跑过。 */
  const [probes, setProbes] = useState<SelfCheckResult | null>(null);
  const [probing, setProbing] = useState(false);

  /** `GET /v1/user/info` 的回包。登录的验收物：identifier 要与登录回包一致。 */
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);

  /**
   * 最近一次**业务失败**的完整信息。日志里只有一行文案，而排障要的是
   * 六位码的含义、trace_id、我们发出的 x-request-id、以及"这个码该重试还是
   * 该重新发起" —— 那些由 `ErrorPanel` 展开（照 demo 的 ErrorPanel）。
   *
   * 只留最近一次：留一串的话，人分不清哪条是刚才那次的。
   */
  const [lastErr, setLastErr] = useState<ApiError | null>(null);

  // **手写路由整块删掉（迁移，migration-spec §5.7 / N4）。**
  //
  // 这里从前是 `view: 'main' | 'x'` 一个 state、一个 popstate 监听、一个
  // `history.pushState` 的 navigate —— 原话是「整个站只有两个视图，一个
  // pushState + 一个 popstate 监听就够了，为此装一个路由库不划算」。
  // 那**第二个视图就是 X 绑定台**，而 X 绑定台不迁移（宿主已有 `/login/x`）。
  // 视图只剩一个，这套路由也就没有了存在的理由：留着等于在 Next 的
  // App Router 底下再压一层自己的地址栏管理，两者会打架。
  //
  // 随它一起消失的还有 `import.meta.env.BASE_URL`（Vite 专有），
  // 这个文件里它只有这一处使用点。

  /**
   * 「我」那块浮层开着没有。同一个入口的两副面孔：没登录时是登录表单，
   * 登录之后是个人信息（identifier / Privy DID / SVM / EVM / 登录方式 / JWT）。
   *
   * 身份从前是第 1 张卡片，顶着三段解释常驻在下单卡上方；中间当过一版横贯
   * 整宽的抽屉 —— 两者都在为"办完就走"的事改变整页布局。浮层办完就收。
   *
   * 后端自检连浮层都没有：它一天点一次、只答一个是非题，顶栏一个按钮就够 ——
   * 两条探针的原文进「过程」日志，没过时另有一块标注顶到工作栏最上面。
   */
  const [meOpen, setMeOpen] = useState(false);


  const [log, setLog] = useState<Step[]>([]);
  const say = useCallback((text: string, bad = false) => {
    setLog((l) => [...l, {at: new Date().toLocaleTimeString(), text, bad}]);
  }, []);
  // 日志会长到几百行（一个下午的联调）。清空是为了把**这一笔**摘出来 ——
  // 报障时截一屏就够，不用请人从两百行里数出哪一段是刚才那次。
  const clearLog = useCallback(() => setLog([]), []);


  // **只认 Privy 托管的 embedded 钱包。** 用户自己连上来的外部钱包
  //（Phantom 之类）也在这个列表里，形状几乎一样，但它不是 business 向
  // Privy 问到的那一个 —— 用它签出来的签名会对不上服务端存着的那笔交易，
  // 而报错要到广播那一刻才出现。
  const embedded = useMemo(
    () => wallets.find((w) => w.standardWallet.name === 'Privy'),
    [wallets],
  );

  // EVM 那只 embedded 钱包。**与上面那只是同一个用户的两个钱包，不是同一个**
  // —— Solana 与 EVM 的地址体系不同，Privy 分别建。买 BSC 上的币时它只是
  // 收货地址（全程不签），卖 BSC 上的币时签名才由它出。
  // **只取列表，不在这里挑一只。** 挑哪一只由服务端点名（见 pickByAddress）——
  // getEmbeddedConnectedWallet 会在多只 embedded 钱包时给出与服务端不同的
  // 那一只，而两边分叉的症状是签名验不过、报错指向密钥。
  const {wallets: evmWallets} = useEvmWallets();

  // 服务端代签授权。**只影响 Node 侧压测脚本那条路，不参与页面上的任何下单**
  // —— 页面永远在浏览器里自己签（`stepSign`），授权与否都一样。
  const signers = useWalletSigners();

  const [positions, setPositions] = useState<Position[] | null>(null);
  // ── 转账（把币转出这只 embedded 钱包）─────────────────────────────
  //
  // 目标地址预填一个值只是省事，**不是默认收款人**。地址在页面上必须
  // 全文显示（不截断）—— 截断显示是转错地址最常见的来路：中间那几十个
  // 字符正好是肉眼最不会去比对的部分。
  const [pane, setPane] = useState<'trade' | 'transfer'>('trade');
  // 持仓「填充卖出数据」交给 Swap 卡的那一份。nonce 让同一行点第二次也生效。
  const [sellPrefill, setSellPrefill] = useState<SellPrefill | null>(null);
  const [xDest, setXDest] = useState('AR3DWmCyV17KRqbaKtEMKwgi1hQWFmNSUDTojMhuEafc');
  const [xMint, setXMint] = useState(USDC_MINT);
  const [xAmount, setXAmount] = useState('');
  const [xMintInfo, setXMintInfo] = useState<MintInfo | null>(null);
  const [xDestInfo, setXDestInfo] = useState<DestInfo | null>(null);
  const [xSig, setXSig] = useState('');

  const [busy, setBusy] = useState(false);

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);


  /** Privy 上真实存在的绑定类型。100107 的排查全靠它。 */
  const linkedTypes = useMemo(
    () => (user?.linkedAccounts ?? []).map((a) => a.type as string),
    [user],
  );

  /**
   * 个人信息里要显示的邮箱。**Privy 是唯一来源** —— `/v1/user/info` 的回包里
   * 根本没有邮箱字段（见 api.ts 的 `UserInfo`），后端也不按邮箱查任何东西。
   *
   * 三条登录路把邮箱放在不同的字段上，而且**它们不一定是同一个串**：
   *
   * - `email` 账号：用户自己填的那个，在 `address` 上；
   * - `google_oauth` / `apple_oauth`：由 IdP 交出来，在 `email` 上。Apple 开着
   *   「隐藏邮件地址」时给的是 `…@privaterelay.appleid.com` 的中转地址，
   *   **不是**用户的真实邮箱 —— 拿它去人工找人会找不到。所以来源必须跟着
   *   地址一起显示：一个孤零零的地址不足以判断它能不能用来找人。
   *
   * 按上面的顺序取第一条有邮箱的。登录框里那个 `email` state **不能拿来当
   * 这个用**：它是待提交的输入 —— OAuth 登录时它是空的，验证码还没过时它
   * 却已经有值了，照它显示等于把"我输了什么"说成"我是谁"。
   */
  const accountEmail = useMemo(() => {
    for (const a of user?.linkedAccounts ?? []) {
      const v = a.type === 'email' ? a.address : 'email' in a ? a.email : undefined;
      if (typeof v === 'string' && v) return {address: v, via: a.type as string};
    }
    return null;
  }, [user]);

  /**
   * 本站 JWT 的 payload，**仅本地解码、未验签**（见 jwt.ts）。
   *
   * 它只回答一件事：这个 token 还剩多久。72 小时听起来很长，但一个开着页面
   * 调一下午的人是真会撞到过期的 —— 而过期后每个 /v1 请求回 400000，
   * 那个码说的是"未认证"，看起来像登录本身出了问题。
   */
  const tokenClaims = useMemo(() => (token ? decodeJwtPayload(token) : null), [token]);
  const tokenLeft = secondsLeft(tokenClaims, now);

  const guard = async (what: string, fn: () => Promise<void>) => {
    setBusy(true);
    // 新动作开始 = 上一次那块红面板该退场了。留着的话，一次成功的重试之后
    // 页面上还挂着上一次的六位码，而那是"现在仍然是坏的"的意思。
    setLastErr(null);
    try {
      await fn();
    } catch (e) {
      const msg =
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
      // ApiError 另存一份完整的：日志那一行只放得下一句话，而排障要的是
      // 六位码的含义、trace_id、以及"该重试还是该重新发起"（见 ErrorPanel）。
      if (e instanceof ApiError) setLastErr(e);
      say(`${what} 失败：${msg}`, true);
    } finally {
      setBusy(false);
    }
  };

  // **不校验"必须是 32 位 hex"。** 这一层只挡住会变成子进程参数的危险字符
  // （另见 vite.config.ts 的同一道校验），形态由身份服务定 —— 写死 hex 的话，
  // 登入 = 一条**四步**的链，任一步没过就不算登录成功。
  //
  //   ① 邮箱验证码登录（headless，见下）
  //   ② useIdentityToken() 拿 identity token
  //   ③ POST /v1/auth/login 换本站 JWT + identifier
  //   ④ 把 custom_auth link 到同一个 Privy DID 上
  //
  // ④ 不是可选的增强：business 查钱包走的是
  // `POST /users/custom_auth/id`（按 identifier 查），而登录建出来的
  // Privy 用户身上只有 email 那条 linked account —— 不 link 就查无此人，
  // 下单在 business 的 resolveWallets 就被拒。判定与理由都在 identity.ts。
  //
  // **顺序不能反。** createOnLogin 在 ① 那一刻就把钱包建在了这个 DID 上；
  // ④ 只是往同一个 DID 上再挂一条 linked account，所以服务端后来查到的
  // 就是前端会话里那批钱包。
  //
  // ── ① 为什么是 headless，不用 Privy 的 modal ──────────────────────
  //
  // 照 `../privy-login-demo/src/components/EmailOtpCard.tsx`，那条已经联调
  // 跑通。邮箱 OTP **没有重定向**，headless 只是两个输入框加两次调用 ——
  // 而它换来的是每一步都能进这个页面的过程日志。modal 那条路里，"验证码
  // 发出去没有"、"是第几次试"全都发生在一个我们看不见的组件里，
  // 而这个 harness 存在的意义就是把每一步摊开。
  //
  // **状态完全由 SDK 的 OtpFlowState 驱动，不自己维护第二份**（同 demo）：
  // 两份状态一定会有对不上的时候，而对不上的表现是按钮该亮时不亮。
  const {state: otpState, sendCode, loginWithCode} = useLoginWithEmail({
    onComplete: ({isNewUser}) =>
      say(`① Privy 登录完成${isNewUser ? '（新用户，钱包刚建）' : ''}，开始换本站 token`),
    onError: (e) => say(`① Privy 登录失败：${String(e)}`, true),
  });
  const otpSending = otpState.status === 'sending-code';
  const otpSubmitting = otpState.status === 'submitting-code';
  const otpAwaiting = otpState.status === 'awaiting-code-input' || otpSubmitting;

  // ── ①b Google / Apple：整页重定向，所以接线必须常驻 ────────────────
  //
  // 照 `../privy-login-demo/src/App.tsx` 的 useLoginWithOAuth。
  //
  // **这个 hook 不能挂在"未登录时才渲染"的那段里。** OAuth 是整页跳转：
  // 从 Google 跳回来的那一刻，React 树是全新挂载的，回调参数在地址栏上，
  // 而收尾（把 `privy_oauth_code` 换成会话、洗掉地址栏）由这个 hook 做。
  // 挂在条件分支里的话，跳回来时它可能根本没挂载，于是登录"没有完成"，
  // 而地址栏里明明带着回调参数 —— 那个症状看起来像 Privy 坏了。
  const oauth = useLoginWithOAuth({
    onComplete: ({isNewUser}) => {
      setOauthBusy(null);
      say(`① OAuth 登录完成${isNewUser ? '（新用户）' : ''}，开始换本站 token`);
      // 洗掉 URL 上的回调参数：留着的话刷新会重放一次登录，
      // 症状是「我明明退了，刷新又登进去了」。
      history.replaceState(null, '', location.pathname);
    },
    onError: (e) => {
      setOauthBusy(null);
      say(`① OAuth 登录失败：${String(e)}`, true);
    },
  });

  const doOAuth = (provider: 'google' | 'apple') => {
    setOauthBusy(provider);
    // **先记下这次是哪种方式，再跳走。** 跳走之后这个 React 树就没了，
    // 回来时是全新挂载 —— 而换 token 那一步需要知道声称哪个 auth_method。
    // pickAuthMethod 同时写 ref 与 state，理由见 authMethodRef 的注释。
    pickAuthMethod(provider === 'google' ? 'AUTH_METHOD_GOOGLE' : 'AUTH_METHOD_APPLE');
    say(`① 发起 ${provider} 登录（整页跳转）`);
    void oauth.initOAuth({provider}).catch((e: unknown) => {
      setOauthBusy(null);
      say(`① initOAuth 失败：${String(e)}`, true);
    });
  };

  const doSendCode = () =>
    guard('发送验证码', async () => {
      const to = email.trim();
      if (!to.includes('@')) throw new Error('邮箱格式不对');
      pickAuthMethod('AUTH_METHOD_EMAIL');
      say(`① 发送验证码到 ${to}`);
      await sendCode({email: to});
    });

  const doVerifyCode = () =>
    guard('提交验证码', async () => {
      if (otp.length !== 6) throw new Error('验证码是 6 位');
      say('① 提交验证码');
      await loginWithCode({code: otp});
      // ②③④ 不在这里调：登录完成后 authenticated 与 identityToken 才会
      // 就位，交给下面那个 effect 统一接手 —— 与"刷新页面后自动续上"
      // 共用同一条路，不写两份。
      setOtp('');
    });

  // ②③④。**与 doLogin 共用同一个实现** —— 它既被登录按钮调用，也被
  // 「Privy 已认证但还没换到 token」这个状态下的 effect 调用（页面刷新后
  // Privy 会话还在，但 token 只活在内存里，已经没了）。
  // Privy DID 走 ref 而不是进依赖：finishLogin 被一个只认四项的 effect 调用，
  // 把 user 放进它的依赖会让这个回调每次渲染都是新的。
  const didRef = useRef<string | null>(null);
  didRef.current = user?.id ?? null;

  const finishLogin = useCallback(async (method: AuthMethod = authMethodRef.current) => {
    // **一进来就打一行。** 没有它的话，"effect 根本没触发"与"触发了但在
    // getIdentityToken 里挂住/抛错"在日志上长得一模一样（都是什么都没有），
    // 而这两种的排查方向完全相反。
    say('② 开始换取：现取 identity token');
    // **必须现取 identity token，不能用 `useIdentityToken()` 的渲染快照。**
    // 那个值是上一次渲染时的：刚登录完那一刻它多半还是 null，而用户填完
    // 验证码去倒杯水回来再点，闭包里那个串又可能已经过期 —— 后端回 400100，
    // 而在场所有人都会去怀疑后端验签、去比对公钥（公钥是对的）。
    // 这一条抄自 ../privy-login-demo/src/App.tsx 的 exchange()，那边已经踩过。
    const idt = await getIdentityToken();
    if (!idt) {
      // null 有两种成因，**默认往第二种猜**：
      //   ① Privy 会话没了 —— 但这一步只在 authenticated 时够得着，少见；
      //   ② 这个 Privy app 压根不发 identity token —— Dashboard 的
      //      「Return user data in an identity token」**默认是关的**，关着时
      //      GET /api/v1/users/me 回的 identity_token 是 null，SDK 随即清掉
      //      本地的 privy:id_token，getIdentityToken() 于是返回 null。
      // 两者症状一模一样而排查方向完全相反，所以把 ② 写在前面。
      throw new Error(
        'identity token 取不到（null），但 Privy 是已登录的 —— ' +
          '十有八九是这个 Privy app 没开 identity token：Dashboard → ' +
          'User management → Authentication → Advanced → 打开' +
          '「Return user data in an identity token」',
      );
    }
    // **把声称的登录方式打进日志。** 100107 的排查全部围绕这一个值：
    // 它必须与 identity token 里真实存在的 linked account 一致，
    // 而"我们声称的是什么"在回包里看不到。
    say(`② 已拿到 identity token，以 ${method} 换本站 token`);
    // **400100 只重取一次，且不是循环。**（抄自 demo 的 exchange()）
    // 400100 有两种成因：identity token 过期（重取能自愈）与 app 不匹配
    // （永远不会自愈）。循环重试在后者上会把 Privy 的速率限制打满，
    // 症状变成 420000，而真正的线索就被埋了。
    let r: Awaited<ReturnType<typeof loginBackend>>;
    try {
      r = await loginBackend(method, idt);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code !== 400100) throw e;
      say('③ 400100，重取 identity token 再试一次', true);
      const again = await getIdentityToken();
      if (!again) throw e;
      r = await loginBackend(method, again);
    }
    setToken(r.token);
    setIdentifier(r.user.identifier);
    // 落盘要带 DID：下次开页面靠它确认"这份 token 是发给现在这个人的"。
    if (didRef.current) saveToken(CURRENT_ENV.key, {token: r.token, did: didRef.current, identifier: r.user.identifier});
    // 换了新 token，上一次那份 /v1/user/info 的验收结论就作废了 ——
    // 留着的话，切过用户之后页面上还挂着上一个人的 identifier 与一个绿勾。
    setUserInfo(null);
    say(`③ 已换到本站 token，identifier=${r.user.identifier}${r.is_new ? '（新建号）' : ''}`);

    // **登录到此为止，没有第四步了**（2026-09-03 删）。
    //
    // 从前这里还要 `linkWithCustomJwt`，把 custom_auth 挂到同一个 Privy 用户
    // 上，理由是 business 按 `custom_user_id = identifier` 查钱包。后端已经
    // 改成按 `privy_did` 查（`6751d44`，同日部署到 smartx-test），那一步整个
    // 不需要了 —— 而它还要求 Privy 开着 JWT-based auth，两个 app 都没开，
    // 于是它当场 401、永远不可能成功，把下单按钮永久锁死。
    // 完整的来龙去脉在 identity.ts 的文件头与后端仓的
    // docs/research/2026-09-03-privy-credentials-without-jwt-auth.md。
  }, [say]);

  // 刷新页面之后：Privy 会话还在（refresh token 撑 30 天），但本站 token
  // 只活在内存里，已经没了。这里自动补上 ②③④ —— 否则页面会停在
  // 「已认证但每个请求 401」，而那是从前那个「token 已过期」徽章的翻版。
  //
  // **只自动试一次。** 失败之后 busy 会落回 false，而 busy 是这个 effect 的
  // 依赖 —— 不设闸就是一个每失败一次立刻重试一次的死循环，而失败最可能的
  // 成因（Dashboard 没开 identity token）永远不会自愈，循环只会把 Privy 的
  // 速率限制打满，把真正的线索埋掉。想再试就点「重新换取」。
  //
  // 闸记的是**上一次为哪个 Privy 用户试过**，不是一个布尔。布尔在 vite 的
  // 热更新下会留下来（Fast Refresh 保留 useRef），于是改一次代码之后它还是
  // true，自动换取再也不触发 —— 而页面上只写着「还没换到本站 token」，
  // 看起来像 effect 写错了。换个用户登录同理。
  const autoExchangedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!ready || !authenticated || token || busy) return;
    const uid = user?.id ?? 'unknown';
    if (autoExchangedFor.current === uid) return;
    autoExchangedFor.current = uid;
    // **先看本地缓存**：命中就不碰 Privy，也不发 /v1/auth/login —— 刷新页面
    // 是调试期最高频的动作，每次都重换会把 Privy 的限流打满（429）。
    const cached = loadToken(CURRENT_ENV.key, uid);
    if (cached) {
      setToken(cached.token);
      setIdentifier(cached.identifier);
      setUserInfo(null);
      say(`② 用本地缓存的 token（identifier=${cached.identifier}）—— 没有重新换取`);
      return;
    }
    void guard('换取本站 token', finishLogin);
    // guard 每次渲染都是新的，放进依赖会无限触发；这里只认前四项。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, authenticated, token, busy, user]);

  // 显式建 embedded 钱包。
  //
  // **必须有这一步，而且 `createOnLogin` 在这条路上根本不会触发。**
  //
  // Privy 文档两处明写：自动建钱包**只对走 Privy modal 的登录生效**，
  // whitelabel / headless 的登录接口不支持——
  //
  //     "Automatic wallet creation only applies to login via the Privy
  //      modal and not from whitelabel login methods."
  //     （docs.privy.io/basics/react/advanced/automatic-wallet-creation）
  //
  // 而这个页面用的正是 headless 的 `useLoginWithEmail`（见 main.tsx 里
  // loginMethods 那段）。于是 main.tsx 那两行 `createOnLogin` 与 Privy
  // Dashboard 上的三个开关**都是死的**，开或关都不改变这里的行为。
  //
  // 2026-09-03 拿两个 app 的线上配置对照过
  // （`GET https://auth.privy.io/api/v1/apps/<appId>`，要带 `privy-app-id`
  // 请求头，不需要登录）：
  //
  //     本机       cmt9sywuk…  create_on_login = "off"（三处都是）
  //     smartx-test cmt77j1bz…  create_on_login = "users-without-wallets"（三处都是）
  //
  // **两台的表现完全一样**：都得点这个按钮。这就是"dashboard 不是那个开关"
  // 的直接证据。从前这段注释把成因写成"dashboard 上是 off"，照它去改
  // dashboard 的人会改完发现毫无变化，而页面还在说同一句话 —— 一条把人
  // 指向死胡同的注释，比没有注释坏。
  //
  // **按钮，不自动。** 建钱包是不可回收的副作用（main.tsx 顶部那段关掉
  // StrictMode 的注释讲的就是它：effect 跑两遍会建出两只真钱包）。
  const doCreateWallets = () =>
    guard('创建 embedded 钱包', async () => {
      if (!embedded) {
        const {wallet} = await createSolanaWallet();
        say(`Solana 钱包已创建：${wallet.address}`);
      }
      // EVM 那侧按"一只都没有"判 —— evmWallets 里除了 embedded 还可能有
      // 用户自己连上来的外部钱包，但 useCreateWallet 建的只会是 embedded，
      // 而它在"已经有一只 embedded"时会抛，所以这里宁可漏建不误建。
      if (evmWallets.length === 0) {
        const w = await createEvmWallet();
        say(`EVM 钱包已创建：${w.address}`);
      }
    });

  /**
   * 给一只钱包挂上服务端代签授权。**按钮，不自动。**
   *
   * 与建钱包同一个道理：它把这只钱包的签名权交出去了一份，交出去这件事
   * 必须是人明确点的。自动挂的话，一次刷新就能悄悄授权，而授权是没有
   * 界面提示的 —— 页面上唯一能看见它的地方就是下面那一行状态。
   */
  const doAuthorizeSigner = (address: string, what: string) =>
    guard(`授权 ${what} 服务端代签`, async () => {
      await signers.authorize(address);
      say(`${what} 已授权：${address}`);
    });

  /**
   * 摘掉授权。**Privy 这个接口是全量摘除**，不是只摘我们挂的那一个 ——
   * 界面上那句话不是客套，多方共用一只钱包时这一下会连别人的一起摘掉。
   */
  const doRevokeSigner = (address: string, what: string) =>
    guard(`撤销 ${what} 服务端代签`, async () => {
      await signers.revoke(address);
      say(`${what} 已撤销全部 signer：${address}`);
    });

  // 手动重来一次。自动那次只跑一次，所以失败之后必须有一条人工的路 ——
  // 否则修好 Dashboard 开关之后只能刷新整个页面。
  const doExchange = (method: AuthMethod = authMethodRef.current) =>
    guard('换取本站 token', async () => {
      // 手点「重新换取」= 明说不要缓存那一份（多半正是因为它不对）。
      clearToken(CURRENT_ENV.key);
      autoExchangedFor.current = user?.id ?? 'unknown';
      pickAuthMethod(method);
      await finishLogin(method);
    });

  /**
   * 第 0 步：后端自检。**不碰 Privy、不需要登录。**
   *
   * 它把"后端够不够得着"从"登录能不能成"里切出来 —— 代理没起、后端是旧
   * 构建、identity token 过期这三件事症状都是「登录失败」，而排查方向完全
   * 不同。判读逻辑在 `selfcheck.ts`（那两条反直觉的判据值得被用例钉住）。
   *
   * **不走 guard**：guard 会把异常记成"这一步失败了"，而这两个探针**期望
   * 失败** —— 它们的失败正是通过。
   */
  const doSelfCheck = async () => {
    setProbing(true);
    setProbes(null);
    try {
      const r = await runSelfCheck();
      setProbes(r);
      say(`0 探针1（匿名 /v1/user/info）：${r.envelope.text}`, !r.envelope.ok);
      say(`0 探针2（/v1/auth/login 存在性）：${r.route.text}`, !r.route.ok);
    } finally {
      setProbing(false);
    }
  };

  /**
   * 登录的**验收**：`GET /v1/user/info` 回的 identifier 必须与
   * `/v1/auth/login` 交出来的那个逐字符一致。
   *
   * 它不是"再查一次用户资料"。这三个串（本站 JWT 的用户键、Privy custom_auth
   * 的 custom_user_id、business 的 subjectIdentifier）**是同一个，中间没有
   * 任何翻译** —— 对不上的症状是"钱包查不到"或"仓位是空的"，而没有一处会
   * 报错。所以这一步的产出物就是那个"一致 / 不一致"。
   */
  const doFetchUserInfo = () =>
    guard('GET /v1/user/info', async () => {
      const info = await getUserInfo(token);
      setUserInfo(info);
      const same = info.identifier === identifier;
      say(
        `验收：/v1/user/info 的 identifier=${info.identifier}` +
          (same ? '，与登录回包一致 ✓' : `，**与登录回包的 ${identifier} 不一致** ✗`),
        !same,
      );
    });

  // 换环境 = **换后端 + 换 Privy app**，而它靠整页刷新落地（理由见 `envs.ts`
  // 的文件头：appId 是 provider 的 prop、本站 JWT 只活在内存里、页面上读过的
  // 每一样状态都属于上一个环境）。
  //
  // 这里唯一要做的是**把写不进去的情况说出来**：无痕窗口里 localStorage 会
  // 抛，而那时页面不会刷新 —— 表现成"点了没反应"，与"切过去了但两个环境的
  // 后端配成了同一个"无法区分。
  const doSwitchEnv = (key: EnvKey) => {
    if (key === CURRENT_ENV.key) return;
    try {
      switchEnv(key);
    } catch (e) {
      say(`切环境失败：${e instanceof Error ? e.message : String(e)}`, true);
    }
  };

  // 登出 = **退 Privy + 清掉 token**，两件事缺一不可。
  //
  // 只调 logout()：token 还在 localStorage 里，上面那处订阅的 isAuthenticated
  // 仍是 true，Privy 转头就拿 tokenRef 里的同一个把用户登回来 —— 按钮看起来
  // 点了没反应。只清 token：Privy 那侧的会话还在。
  //
  // **identifier 故意不清**：它只是下次签发 token 的入参，清掉等于每次登出
  // 都要重填一遍。
  const doLogout = () => {
    clearToken(CURRENT_ENV.key);
    setToken('');
    setIdentifier('');
    setOtp('');
    setUserInfo(null);
    setLastErr(null);
    autoExchangedFor.current = null;
    // logout() 返回 Promise。这里不等它 —— 失败也只是 Privy 那侧的会话没退掉，
    // 本地 token 已经清了，页面照样是"未认证"。
    void logout();
    say('已登出：Privy 会话与本机 token 都清掉了');
  };

  /**
   * 重查持仓。手点「拉取」与一笔 swap 到终态后的自动重查共用这一份。
   *
   * **只查一次，不再「盯到变化为止」**（2026-09-17，切 Fast Swap v2）：v1 时代
   * 页面靠持仓变化来判断成交，所以要补查；v2 的结论只看 `settlement.outcome`，
   * 「完成」本身就要求账务 POSTED 且有实际到手额 —— 持仓在这里只是旁证。
   *
   * 它自己吞掉异常：持仓读不到只是这一格旧了，不能把一笔已完成的 swap 标成失败。
   */
  // 轮询用的两把守卫（2026-09-18 加，为了支持 1 秒一拍的自动拉取）：
  //
  //   posBusyRef —— 上一拍还没回来就跳过这一拍。不跳的话慢响应会堆积，
  //                 一个 300ms 的后端配 1s 的节拍还好，一旦后端变慢
  //                 （持仓这条路要过 business→trade→token_data 三跳）
  //                 请求会无限叠上去。
  //   posGenRef  —— 迟到的响应不许覆盖新的。没有它，第 N 拍的旧数据可能
  //                 落在第 N+1 拍的新数据之后，表格会往回跳；而这一格
  //                 正是「填充卖出数据」的来源，跳回去等于拿旧份额填卖单。
  //
  // quiet：轮询不写过程日志。1 秒一行会把右栏冲掉，而那条日志是排查时
  // 唯一的时间线。手动「拉取」与 swap 到终态仍然照写。
  const posBusyRef = useRef(false);
  const posGenRef = useRef(0);
  const refreshPositions = async (why: string, quiet = false) => {
    if (posBusyRef.current) return;
    posBusyRef.current = true;
    const gen = ++posGenRef.current;
    try {
      const ps = await listPositions(token);
      if (gen !== posGenRef.current) return;
      setPositions(ps);
      const held = ps.filter((p) => p.shares_raw !== '0').length;
      if (!quiet) say(`持仓已更新（${why}）：${ps.length} 行，其中还有量的 ${held} 行`);
    } catch (e) {
      if (gen !== posGenRef.current) return;
      // 尾句跟着码表的 retryable 走：430114（准入门禁）这种重试没有用的码，直接说该做的事。
      const info = e instanceof ApiError && e.kind === 'business' ? codeInfo(e.code) : undefined;
      const tail = !info
        ? '点「拉取」再试一次'
        : info.retryable
          ? `${info.text} —— ${info.advice}`
          : `**这个码重试没有用**：${info.text} —— ${info.advice}`;
      say(`持仓重查失败（${why}）：${e instanceof Error ? e.message : String(e)} —— **交易本身不受影响**，${tail}`, true);
    } finally {
      posBusyRef.current = false;
    }
  };

  const doPositions = () =>
    guard('查持仓', async () => {
      await refreshPositions('手动拉取');
    });

  // 持仓每秒自动拉一次（2026-09-18 按需求加）。
  //
  // 几条不是随手写的：
  //   · 没 token 不轮询 —— 匿名打 /v1/portfolio 一律 400000，
  //     1 秒一条错误日志会把过程日志冲成噪音。
  //   · quiet=true —— 见 refreshPositions 上面那段。
  //   · 页面不可见时停 —— 后台标签页照打是白烧后端配额，而这条路要过
  //     business→trade→token_data 三跳。回到前台立刻补一拍，不等下一个 1s。
  //   · 跳拍与代次守卫在 refreshPositions 里，不在这儿：手动「拉取」和
  //     swap 到终态那两条路同样需要它们。
  useEffect(() => {
    if (!token) return;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      void refreshPositions('自动', true);
    };
    tick();
    const t = setInterval(tick, 1000);
    const onVis = () => tick();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // 「核对」：把目标地址与 mint 的**链上形态**查出来摆给人看。
  //
  // 这一步是转错地址之前真正管用的那道闸。离线的地址校验挡不住"粘贴少
  // 一位"（少一个字符解出来仍可能是 32 字节，见 transfer.test.ts 那条
  // 记录缺口的用例），而手滑出来的地址几乎必然**链上查无此账户**。
  const doCheckDest = () =>
    guard('核对目标', async () => {
      setXSig('');
      const mi = await fetchMintInfo(xMint.trim());
      setXMintInfo(mi);
      const di = await fetchDestInfo(xDest.trim(), xMint.trim());
      setXDestInfo(di);
      say(
        `核对：mint ${mi.supported ? '支持' : '不支持'}（decimals=${mi.decimals}）；` +
          `目标${di.exists ? '存在' : '**链上不存在**'}，${di.isWallet ? '是普通钱包' : `owner=${di.owner || '空'}`}，` +
          `${di.hasAta ? '已有该币账户' : '没有该币账户（转账会顺带建一个）'}`,
        !di.exists,
      );
    });

  // 「填全部」：把这个 mint 的当前余额填进金额框。
  //
  // 存在的理由是**减少手输**：金额手填是这条路上唯一会静默少转钱的地方，
  // 而 parseUnits 只能挡住位数超限，挡不住"少打一个 0"。
  const doFillAll = () =>
    guard('查余额', async () => {
      if (!embedded) throw new Error('没有 Privy embedded Solana 钱包');
      const mi = xMintInfo ?? (await fetchMintInfo(xMint.trim()));
      setXMintInfo(mi);
      const b = await fetchTokenBalance(embedded.address, xMint.trim());
      setXAmount(formatUnits(b.raw, mi.decimals));
      say(`余额 ${formatUnits(b.raw, mi.decimals)}（${b.accounts} 个账户）已填入`);
    });

  // 转账本体。**签名与广播都交给 Privy**（useSignAndSendTransaction），
  // 我们只组包 —— 理由见 transfer.ts 的文件头。
  const doTransfer = () =>
    guard('转账', async () => {
      if (!embedded) throw new Error('没有 Privy embedded Solana 钱包');
      setXSig('');
      const chk = checkDestination(xDest, embedded.address);
      if (!chk.ok) throw new Error(chk.why);

      // mint 每次都重查，不吃缓存：mint 换了而 xMintInfo 还是上一个的
      // decimals，算出来的金额会差几个数量级，而那是个合法数字。
      const mi = await fetchMintInfo(xMint.trim());
      setXMintInfo(mi);
      if (!mi.supported) throw new Error(mi.why ?? '这个 mint 不受支持');

      const amount = parseUnits(xAmount, mi.decimals);
      if (amount <= 0n) throw new Error('金额必须大于 0');

      const wire = await buildSplTransfer({
        owner: embedded.address,
        dest: xDest.trim(),
        mint: xMint.trim(),
        amount,
        decimals: mi.decimals,
      });
      say(`转账：${xAmount} → ${xDest.trim()}（已组包 ${wire.length} 字节，请求签名并广播）`);

      // **optimisticBroadcast: true —— 发出去就算数，不等链上确认。**
      //
      // 不加这一行的话，Privy 发完会用 `signatureSubscribe`（WebSocket）等确认，
      // 而那个方法**不是每个 RPC 都提供**。2026-09-02 主网实测：Alchemy 的
      // wss 端点回 `Method 'signatureSubscribe' not found`，于是一笔**已经上链
      // 成功**的转账在页面上报了失败（6.486828 USDC 确实到账了）。
      //
      // 这个失败模式的危险不在于"少一条确认"，在于**它会诱发双花**：人看到
      // 「转账失败」，很自然地再点一次，而第一笔已经在链上了。真钱。
      //
      // 代价是我们不知道它有没有确认 —— 所以回包给的那个签名必须显示成可点的
      // 浏览器链接，页面上那句「成功不代表已确认」也不能删。
      const {signature} = await signAndSendTransaction({
        transaction: wire,
        wallet: embedded,
        options: {optimisticBroadcast: true},
      });
      const sig = encodeBase58(signature);
      setXSig(sig);
      say(`转账已广播：${sig}`);
    });

  // 一行持仓填成一张卖单。**只填表单，不执行。**
  //
  // 填的是 `sellable_shares`（现在真能卖的量），不是 `shares_raw`：有在途卖单时两者分叉，
  // 而那正是填错会出事的时刻。原样填进 amount_in_raw，一次换算都不做。
  //
  // 路线由链决定（Q17）：Solana 上的持仓走 side=swap（v2 里「Solana 卖出」就是它），
  // EVM 上的持仓走 side=sell 回到 Solana USDC。这里只给链，SwapPanel 把「链 + 卖出」映射成 side，并用 capabilities 判断开没开。
  const fillSellForm = (p: Position) => {
    const c = chainOfID(p.asset.chain_id);
    if (!c) {
      say(`这一行的链是 ${p.asset.chain_id}（${p.asset.chain}），本页认不出`, true);
      return;
    }
    setPane('trade');
    setSellPrefill({
      originChain: caipOf(c),
      originAsset: p.asset.token_address,
      amountRaw: p.sellable_shares,
      nonce: Date.now(),
    });
  };

  // 每只 embedded 钱包的 HD index。
  //
  // **它不在 useWallets() 交回的对象上**，只在 user.linkedAccounts 里
  // （`WalletWithMetadata.walletIndex`）—— 按地址关联两边。
  //
  // 为什么要读它：服务端挑钱包的规则是**同一 chain_type 内 wallet_index
  // 最小的那只**，页面靠它排序，好让"服务端会用的那只"稳定排在第一位。
  // index 号本身不显示 —— 只列一只时它没有信息量（见 WalletList）。
  //
  // 拿不到 index 时排到最后而不是当成 0：当成 0 会让一只来路不明的钱包
  // 排到首位，页面于是显示了一个服务端根本不会用的地址。
  const walletIndexOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of user?.linkedAccounts ?? []) {
      if (a.type === 'wallet' && typeof a.walletIndex === 'number' && a.address) {
        m.set(a.address.toLowerCase(), a.walletIndex);
      }
    }
    return m;
  }, [user]);

  // 按 index 升序排，让"服务端会用的那只"永远排在最前 —— 顺序本身就是信息。
  // 拿不到 index 的排到最后（而不是当成 0），不然一只未知的会假装自己是首选。
  const byIndex = useCallback(
    <T extends {address: string}>(ws: T[]): T[] =>
      [...ws].sort(
        (a, b) =>
          (walletIndexOf.get(a.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER) -
          (walletIndexOf.get(b.address.toLowerCase()) ?? Number.MAX_SAFE_INTEGER),
      ),
    [walletIndexOf],
  );

  // 服务端会用的那只 Solana 钱包（wallet_index 最小的那只，也正是页面显示
  // 的那只）。余额只看它 —— 显示另一只的余额比不显示更糟。
  const solOwner = useMemo(() => byIndex(wallets)[0]?.address, [byIndex, wallets]);
  const {view: usdc, refresh: refreshUsdc} = useUsdcBalance(solOwner);

  // Fast Swap v2 用的两只钱包：各取 wallet_index 最小的那只 embedded（与 solOwner 同一规则）。
  // v2 请求里带的是 **Privy 钱包 id**，服务端据此推导地址并核对归属 —— 地址不再由服务端「点名」。
  const solWallet = useMemo(() => {
    const addr = byIndex(wallets.filter((w) => w.standardWallet.name === 'Privy'))[0]?.address;
    return wallets.find((w) => w.address === addr);
  }, [byIndex, wallets]);
  const evmWallet = useMemo(
    () => byIndex(evmWallets.filter((w) => w.walletClientType === 'privy'))[0],
    [byIndex, evmWallets],
  );
  const walletIdOf = useCallback(
    (address: string | undefined) => signers.statusOf(address)?.walletId ?? null,
    [signers],
  );
  // 一笔到终态：持仓与 USDC 余额各重查一次，只作旁证（判定看 outcome）。
  const onSwapTerminal = useCallback(() => {
    refreshUsdc();
    void refreshPositions('swap 到终态');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshUsdc, token]);

  // 仓位分两组，各自按**开仓时刻**倒序。
  //
  // **排的是 opened_at，而它与从前那句「最近更新的排在前面」不是一回事。**
  // 旧接口有 `updated_at`，portfolio 这条回包里没有任何"最后更新时刻"——
  // 最接近的是 applied_revision（修订号，跨行不可比）。所以这里排开仓时刻，
  // 页面上那句说明也跟着改了：把「最近更新」写在一个其实按开仓排的列表上，
  // 比不写更糟。
  //
  // **走 timestampMs 而不是 Date.parse**：opened_at 是 {seconds, nanos}，
  // 不是 RFC3339 串 —— `Date.parse(对象)` 得到 NaN，而 NaN 参与比较不抛错，
  // 只是让 sort 的结果变成未定义顺序，看起来像后端乱回。
  //
  // 分组的理由是**这两组要做的事不同**：持仓中的是要卖的，已清仓的是拿来
  // 回看盈亏的。混在一起时，真正要操作的那几行会被历史记录挤下去。
  // 实测 portfolio **不回**清仓行，所以 closed 通常是空的（见 listPositions）。
  const grouped = useMemo(() => {
    if (!positions) return null;
    const newest = [...positions].sort(
      (a, b) => timestampMs(b.opened_at) - timestampMs(a.opened_at),
    );
    return {
      held: newest.filter((p) => p.shares_raw !== '0'),
      closed: newest.filter((p) => p.shares_raw === '0'),
    };
  }, [positions]);

  const gate = readiness({
    ready,
    authenticated,
    hasToken: !!token,
    hasWallet: wallets.length > 0 || evmWallets.length > 0,
  });
  // 还不能下单时**自动把身份抽屉推开一次**。收进抽屉的代价是它变得可以被
  // 忽略 —— 而一个没登录的人面对一张灰着的下单卡，看不出该点哪儿。
  // 只推一次：推开之后关掉就是用户的决定，不该每次渲染再顶回来。
  const autoOpenedMe = useRef(false);
  useEffect(() => {
    if (!ready || gate.ready || autoOpenedMe.current) return;
    autoOpenedMe.current = true;
    setMeOpen(true);
  }, [ready, gate.ready]);

  /**
   * USD 金额按正负上色。**只看正负号，不做数值比较。**
   *
   * `Number(v) > 0` 这种写法在两处会骗人：空串 `Number("")` 是 0（而空串的
   * 意思是"没有这个数"，不是零），以及 `"-0.00000000"` —— 一个负号开头但
   * 数值为零的串，后端在"亏了不到一分钱"时就会回它。按符号判，两种都落在
   * 该落的那一格。
   */
  const signClass = (v: string) => (v.startsWith('-') ? 'neg' : !v || /^-?0(\.0*)?$/.test(v) ? '' : 'pos');

  /** `{seconds, nanos}` → 一眼能读的 UTC 串。取不到就空着，不显示 1970。 */
  const stamp = (t: {seconds: number; nanos: number} | undefined) => {
    const ms = timestampMs(t);
    return ms > 0 ? new Date(ms).toISOString().replace('T', ' ').slice(0, 19) : '';
  };

  /**
   * 最小单位 → 人能读的数量。**失败就交回原串，不显示 0。**
   *
   * `shares_raw` 实测见过 22 位，`BigInt` 接得住而 `Number` 接不住。但这里是
   * 展示用的次要信息，后端哪天回一个带小数点的串（BigInt 会抛）不该把整张表
   * 炸掉 —— 真正要用的那个数（填进卖单的）从头到尾都是原串，一次换算都不做。
   */
  const human = (raw: string, decimals: number) => {
    try {
      return formatUnits(BigInt(raw), decimals);
    } catch {
      return raw;
    }
  };

  // 一行仓位 = 表格里的一行。两组（持仓中 / 已清仓）共用同一份渲染 ——
  // 分开写两遍的话，改一处漏一处不会报错，只会让"已清仓"那组停在某个旧版本上。
  const positionRow = (p: Position) => {
    const empty = p.shares_raw === '0';
    const c = chainOfID(p.asset.chain_id);
    const addr = p.asset.token_address;
    // 地址在表格里截断显示：一行 42 个字符会把后面每一列都推到屏幕外，
    // 而完整值一直在 Copy 按钮手里（它复制的是原文，不是截断后的）。
    const short = `${addr.slice(0, 6)}…${addr.slice(-4)}`;
    // 可卖与持有不等 = 有在途订单占着。**这一格要显眼**：填卖单填的是可卖量，
    // 与左边那个持有量对不上时，不说明就看起来像填错了。
    const locked = p.sellable_shares !== p.shares_raw;
    return (
      <tr
        // 这三项唯一确定一行（计价资产那两段已经从回包里没了）。
        // 拼法在 api.ts 里，由 api.test.ts 钉住 —— 拼错不会报错，只会让行塌陷。
        key={positionKey(p)}
        className={empty ? 'dim' : undefined}
      >
        <td>
          <Badge kind={empty ? 'off' : 'ok'}>{c ?? `chain ${p.asset.chain_id}`}</Badge>
          {/* quantity_status：ledger = 账本推算，verified = 链上核对过。
              两个都是正常值，不是错误 —— 所以用中性的 off 色，不是红。 */}
          <span className="sub">{p.quantity_status}</span>
        </td>
        <td>
          {p.symbol && <b>{p.symbol}</b>}
          <code className="code" title={addr}>
            {short}
          </code>
          <Copy text={addr} label="复制" />
        </td>
        {/* 持有 / 可卖。**下单用的是可卖那个**，所以它跟着摆在一起，
            免得人照着持有量去手填。 */}
        <td className="num">
          {p.shares_raw}
          <span className="sub">≈ {human(p.shares_raw, p.decimals)}</span>
        </td>
        <td className={'num' + (locked ? ' neg' : '')}>
          {p.sellable_shares}
          {locked && (
            <span className="sub">
              <b>在途</b> {p.pending_shares}
            </span>
          )}
        </td>
        {/* 成本与市值都是 USD 十进制（不是最小单位），标在表头上。 */}
        <td className="num">{p.cost_basis_usd}</td>
        <td className="num">
          {p.market_value_usd}
          <span className="sub">
            <b>现价</b> {p.price_usd}
          </span>
        </td>
        {/* 累计买卖：份额与 USD 两个单位摆在一格里，各自标出来，免得被相加。 */}
        <td className="num">
          {p.buy_amount_raw}
          <span className="sub">
            <b>USD</b> {p.buy_value_usd}
          </span>
        </td>
        <td className="num">
          {p.sell_amount_raw}
          <span className="sub">
            <b>USD</b> {p.sell_value_usd}
          </span>
        </td>
        <td className={'num ' + signClass(p.realized_pnl_usd)}>{p.realized_pnl_usd}</td>
        <td className={'num ' + signClass(p.unrealized_pnl_usd)}>{p.unrealized_pnl_usd}</td>
        <td className={'num ' + signClass(p.total_pnl_usd)}>
          {p.total_pnl_usd}
          <span className="sub">{p.pnl_ratio}</span>
        </td>
        <td>
          {stamp(p.opened_at)}
          {/* 修订号：补查判"仓位变了没有"靠的就是它（见 positionsMark）。
              摆出来是为了让"盯了 90 秒仍没变"那句话有个可核对的数。 */}
          <span className="sub">
            rev {p.applied_revision}
            {p.applied_revision !== p.input_revision ? ` / in ${p.input_revision}` : ''}
          </span>
        </td>
        <td>
          {empty ? (
            <span className="sub">已清仓</span>
          ) : (
            <Btn size="sm" disabled={busy || !c} onClick={() => fillSellForm(p)}>
              填充卖出数据
            </Btn>
          )}
        </td>
      </tr>
    );
  };

  /**
   * 仓位表。
   *
   * # 为什么是表格而不是一行一张卡
   *
   * 这一屏要回答的问题是**跨行比较**的："哪个币还剩多少、哪个亏得最多"。
   * 摊成卡片时同一个量在纵向上对不齐，要靠人一张张读过去再自己记住 ——
   * 而对齐的一列数是这件事唯一不费力的形式。
   *
   * 代价是列多了放不下（份额是二十来位的十进制串），所以整张表包在
   * `.tblwrap` 里横向滚动，**不让整页横滚**：整页横滚会把最左边的标的列也
   * 滚走，于是每一行都不知道是谁的。
   *
   * # 表头上必须标单位
   *
   * 这条回包里有三组单位（标的最小单位 / USD 十进制 / 纯比值），而它们在
   * JSON 里长得一模一样。`cost_basis_usd` 是 `"0.05660400"`，旧接口同名位置
   * 的 `cost_basis` 是 USDC 最小单位 `"1963698"` —— 两者差 10^6 倍，都能显示，
   * 都不会报错。
   */
  const positionTable = (rows: Position[]) => (
    <div className="tblwrap">
      <table className="tbl">
        <thead>
          <tr>
            <th>
              链<span className="u">数量来源</span>
            </th>
            <th>
              标的<span className="u">symbol / 合约地址 · mint</span>
            </th>
            <th>
              持有<span className="u">shares_raw · 标的最小单位</span>
            </th>
            <th>
              可卖<span className="u">sellable_shares · 填卖单用这个</span>
            </th>
            <th>
              成本<span className="u">USD · 还持有的这些花了多少</span>
            </th>
            <th>
              市值<span className="u">USD · 随价格实时变</span>
            </th>
            <th>
              累计买入<span className="u">份额 / USD · 卖出不减</span>
            </th>
            <th>
              累计卖出<span className="u">份额 / USD</span>
            </th>
            <th>
              已实现<span className="u">USD · 永不清零</span>
            </th>
            <th>
              未实现<span className="u">USD · 随价格实时变</span>
            </th>
            <th>
              合计盈亏<span className="u">USD / 比值</span>
            </th>
            <th>
              开仓<span className="u">opened_at · UTC · 修订号</span>
            </th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>{rows.map(positionRow)}</tbody>
      </table>
    </div>
  );

  // 两个联调台共用同一份日志，切来切去不会把线索弄丢。
  const logCard = (
    <Card
      title="过程"
      right={
        <>
          <span className="hint tight">{log.length} 行</span>
          <Btn size="sm" variant="ghost" disabled={log.length === 0} onClick={clearLog}>
            清空
          </Btn>
        </>
      }
    >
      <Log items={log} />
    </Card>
  );

  const probesOk = probes ? probes.envelope.ok && probes.route.ok : null;

  return (
    <>
      <GlobalStyles />

      {/* ---------------- 顶栏：能不能开始，都在这一条上 ---------------- */}
      <header className="topbar">
        <span className="brand">
          <span className="dot" />
          meme · embedded 实跑台
        </span>

        {/* ---- 环境开关。**页面上最全局的一件事，所以摆在最左边** ----
            它决定这一整页对着哪个 business 跑，而下单最后落到的 sx_trade
            用的是哪一把 Relay api key，就跟着这个走（本机那把与测试环境那把
            不是同一把 —— 这正是这个开关存在的理由）。

            摆在标题旁边而不是收进芯片堆里：这是**下单之前必须先看一眼**的
            东西，而右边那堆芯片是"跑起来之后再看"的状态。选错环境的代价是
            一笔打到了另一套账上的真单，事后只能靠 trace 去认。

            切换会**整页刷新并要求重新登录** —— 两个环境是两套 Privy app，
            也就是两套用户、两套钱包，同一个邮箱在两边不是同一个人。 */}
        <span className="envsw">
          <span className="k">环境</span>
          <div className="seg" role="tablist" aria-label="后端环境">
            {ENVS.map((e) => (
              <button
                key={e.key}
                type="button"
                role="tab"
                data-k={`env-${e.key}`}
                aria-selected={e.key === CURRENT_ENV.key}
                disabled={!!e.missing}
                title={
                  e.missing
                    ? `这一档没配全：缺 ${e.missing}（填在 .env.local 里，说明见 .env.example）`
                    : e.key === CURRENT_ENV.key
                      ? `当前就在这一档 · 后端 ${e.originLabel}`
                      : `切到「${e.label}」（后端 ${e.originLabel}）——会整页刷新并要求重新登录：两个环境是两套 Privy app，两套用户、两套钱包`
                }
                onClick={() => doSwitchEnv(e.key)}
              >
                {e.label}
              </button>
            ))}
          </div>
        </span>

        {/* 这里从前是「签名实跑 / X 绑定」两档的联调台切换。X 绑定台不迁移
            （migration-spec §5.7），只剩一档的分段控件是纯噪音，整块删掉。 */}

        <span className="chips push">
          {/* 存着的那一档没生效时，**必须说出来**。静默退回默认档的表现是
              "我明明选了测试环境，可下的单还是进了本机"，而页面上那个开关
              显示的又确实是本机 —— 两条信息不矛盾，于是没人会去怀疑它。 */}
          {ENV_DROPPED && (
            <Chip tone="err" title="localStorage 里存着的环境没有生效">
              {ENV_DROPPED}
            </Chip>
          )}
          <Chip
            tone={!ready ? 'off' : !authenticated ? 'off' : !token ? 'warn' : gate.ready ? 'ok' : 'warn'}
            onClick={() => setMeOpen((v) => !v)}
            expanded={meOpen}
            title={
              !authenticated
                ? '点开登录（邮箱验证码 / Google / Apple）'
                : gate.ready
                  ? `点开看邮箱 / identifier / Privy DID / SVM 与 EVM 地址${identifier ? `（identifier=${identifier}）` : ''}`
                  : `还不能下单 —— ${gate.blocker}`
            }
          >
            {/* 没登录时这枚芯片是**动作**（"登录"），登录之后是**入口**
                （"个人信息"）—— 圆点的颜色照旧只说状态。写"未登录"那版说的是
                状态，可它是整页唯一能往下走的一步，标成状态等于把它藏起来。

                登录之后带的是**邮箱，不是 identifier**：这枚芯片要回答的是
                "现在是谁在操作"，而 `d5b353…a7ea` 这种截断过的机器键回答不了
                —— 切过账号之后没人认得出自己看的是哪一个。邮箱**不截断**：
                它是人尺度的串，而截断会把域名吃掉，那正是唯一能分辨两个同名
                账号的部分。identifier 没有消失，它在抽屉里和这枚芯片的
                tooltip 里，报障要用的时候找得到。

                Privy 没交出邮箱时（某些 OAuth 账号就是没有）退回光秃秃的
                "个人信息" —— 不拿 identifier 顶上：一个认不出来的串占着位置，
                比空着更容易让人以为那就是自己的账号名。 */}
            {!ready
              ? 'Privy 加载中'
              : !authenticated
                ? '登录'
                : !token
                  ? '换取 token'
                  : accountEmail
                    ? `个人信息 · ${accountEmail.address}`
                    : '个人信息'}
          </Chip>

          {token && (
            <Chip
              tone={tokenLeft !== null && tokenLeft <= 0 ? 'err' : 'off'}
              title={`本站 JWT 剩余（仅本地解码，未验签）${tokenClaims?.identifier ? `；JWT 里的 identifier=${tokenClaims.identifier}` : ''}`}
            >
              JWT <span className="v">{humanDuration(tokenLeft)}</span>
            </Chip>
          )}

          {/* 余额上顶栏：它是"这一笔付得起吗"的答案，而下单表单里问不到它。 */}
          {solOwner && (
            <Chip
              tone={usdc.err ? 'err' : usdc.loading ? 'live' : usdc.bal ? 'ok' : 'off'}
              title={
                usdc.err
                  ? `读不到：${usdc.err}`
                  : usdc.bal
                    ? `${usdc.bal.raw} 最小单位 · ${usdc.at} 读到 · ${usdc.bal.accounts} 个 token account`
                    : '正在读余额'
              }
            >
              USDC{' '}
              <span className="v">
                {usdc.err ? '读不到' : usdc.bal ? usdc.bal.ui : '…'}
              </span>
              {usdc.bal?.accounts === 0 && '（无账户）'}
              {usdc.loading && usdc.bal && ' ·重查'}
            </Chip>
          )}

          {busy && (
            <Chip tone="live" title="有一个请求正在跑">
              <IconSpin size={12} /> 运行中
            </Chip>
          )}

          {/* 后端自检从前是第 0 张卡片，中间当过一枚开抽屉的芯片 —— 两者都太重。
              它是**一个按钮**：点一下就跑，跑完自己变成结论。两个探针的原文由
              doSelfCheck 打进「过程」日志（那一栏一直在屏幕上），失败时另有一块
              标注顶到工作栏最上面，所以这里不需要第二个落点。
              和登出并排：这一格是"动作"，左边那些芯片是"状态"。 */}
          <Btn
            size="sm"
            variant="ghost"
            busy={probing}
            disabled={probing}
            title={
              probes
                ? `探针1 匿名 GET /v1/user/info：${probes.envelope.text}\n探针2 POST /v1/auth/login 是否存在：${probes.route.text}\n（详情见「过程」日志）`
                : '两个探针都期望"失败" —— 后端按契约拒绝，拒绝本身证明代理通、信封层活着'
            }
            onClick={() => void doSelfCheck()}
          >
            {probing
              ? '自检中'
              : probesOk === null
                ? '后端自检'
                : probesOk
                  ? '后端 · 通'
                  : '后端 · 没过'}
          </Btn>
          {ready && authenticated && (
            <Btn size="sm" variant="ghost" onClick={doLogout}>
              登出
            </Btn>
          )}
        </span>
      </header>

      {/* ---------------- 浮层：登录 / 个人信息 ---------------- */}
      {/* 同一个入口的两副面孔：没登录时它是登录表单，登录之后它是
          「我是谁、我的钱包是哪几只」。**不是两个入口** —— 顶栏上只该有
          一枚"我"的芯片，点开看到什么由当前状态决定。 */}
      {meOpen && (
        <Popover
          title={!authenticated ? '登录' : !token ? '换取本站 token' : '个人信息'}
          onClose={() => setMeOpen(false)}
        >
          {!authenticated ? (
            <>
              <div className="form">
                <div className="f">
                  <label htmlFor="lg-email">邮箱</label>
                  <div className="with">
                    <input
                      id="lg-email"
                      className="inp"
                      type="email"
                      autoComplete="email"
                      placeholder="you@example.com"
                      value={email}
                      disabled={otpSending}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                    <Btn
                      size="sm"
                      busy={busy || otpSending}
                      disabled={busy || otpSending || !email.includes('@')}
                      onClick={doSendCode}
                    >
                      {otpAwaiting ? '重发' : '发送验证码'}
                    </Btn>
                  </div>
                </div>

                {otpAwaiting && (
                  <div className="f">
                    <label htmlFor="lg-otp">
                      验证码<span className="u">6 位</span>
                    </label>
                    <div className="with">
                      <input
                        id="lg-otp"
                        className="inp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={otp}
                        disabled={otpSubmitting}
                        // 只留数字、最多 6 位。粘贴带空格的验证码是常态，
                        // 不过滤的话按钮会一直灰着，而人看不出为什么。
                        onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                      <Btn
                        size="sm"
                        busy={busy || otpSubmitting}
                        disabled={busy || otpSubmitting || otp.length !== 6}
                        onClick={doVerifyCode}
                      >
                        登录
                      </Btn>
                    </div>
                  </div>
                )}
              </div>

              <div className="or">或</div>

              {/* ── 第三方登录：线通着，闸断着，闸上写清楚为什么断 ──────
                  代码路径是完整的（常驻的 useLoginWithOAuth），控制台一开、
                  env 一置，刷新本页就能用。按钮禁用时把原因写在旁边：否则
                  "点不亮"会被当成本页的 bug，而真相在两个都不在这页上的地方。 */}
              <div className="row tight">
                {(['google', 'apple'] as const).map((p) => {
                  const why = oauthBlockedReason(oauthAvail, p);
                  return (
                    <Btn
                      key={p}
                      size="sm"
                      variant="ghost"
                      disabled={Boolean(why) || busy || oauthBusy !== null}
                      busy={oauthBusy === p}
                      title={why ?? `使用 ${p} 登录（整页跳转）`}
                      onClick={() => doOAuth(p)}
                    >
                      {p === 'google' ? 'Google' : 'Apple'} 登录
                    </Btn>
                  );
                })}
                <Btn
                  size="sm"
                  variant="ghost"
                  disabled={oauthAvail.loading}
                  onClick={oauthAvail.recheck}
                >
                  重新探测
                </Btn>
              </div>
              <p className="hint tight" style={{marginTop: 'var(--s2)'}}>
                {oauthAvail.loading
                  ? '正在读取 Privy 控制台配置…'
                  : (oauthBlockedReason(oauthAvail, 'google') ??
                    oauthBlockedReason(oauthAvail, 'apple') ??
                    `控制台配置读取于 ${new Date(oauthAvail.checkedAt!).toLocaleTimeString()}`)}
              </p>

              <Info label="说明 · 这条登录链路">
                <p className="hint">
                  走的是<b>真实链路</b>，和生产前端同一条：Privy 登录（邮箱验证码 / Google /
                  Apple）→ identity token → <code className="code">POST /v1/auth/login</code> →
                  本站 JWT。<code className="code">identifier</code> 由回包给出，页面上只读 ——
                  手填一个等于声称自己是别人，而服务端会照着它去查钱包。
                </p>
                <p className="hint tight">
                  邮箱那条走的是 headless 的 <code className="code">useLoginWithEmail</code>，
                  没有 Privy 的 modal —— 每一步都进得了「过程」日志，而这个 harness 存在的
                  意义就是把每一步摊开。
                </p>
              </Info>
            </>
          ) : (
            <>
              {/* ── 已登录：这一块回答"我是谁、我的钱包是哪几只" ────────── */}
              <h3>身份</h3>
              <KV k="identifier">
                {identifier ? (
                  <Mono value={identifier} />
                ) : (
                  <span className="hint tight">还没换到（下面那个按钮）</span>
                )}
              </KV>
              {/* DID 是**后端查钱包真正用的那个键**（业务侧 6751d44 起按
                  privy_did 查，不再按 custom_user_id）。报障时它和 identifier
                  要一起给 —— 只给一个的话，对面没法确认两边指的是同一个人。 */}
              <KV k="Privy DID">
                {user?.id ? <Mono value={user.id} /> : <span className="hint tight">（还没有）</span>}
              </KV>
              {/* 邮箱是这一屏上唯一「人能认出来」的那个串 —— identifier 与 DID
                  都是机器键。来源标在后面：Apple 的中转地址长得和真邮箱一样，
                  只有来源能把它们分开。 */}
              <KV k="邮箱">
                {accountEmail ? (
                  <>
                    <Mono value={accountEmail.address} head={18} tail={10} />
                    <span className="hint tight">
                      来自 <code className="code">{accountEmail.via}</code>
                      {accountEmail.via === 'apple_oauth' &&
                        accountEmail.address.endsWith('@privaterelay.appleid.com') &&
                        ' —— Apple 的中转地址，不是本人邮箱'}
                    </span>
                  </>
                ) : (
                  <span className="hint tight">
                    Privy 没给 —— 这条登录路没有交出邮箱；
                    <code className="code">/v1/user/info</code> 里也没有这个字段
                  </span>
                )}
              </KV>
              <KV k="登录方式">
                <code className="code">{linkedTypes.join(', ') || '(空)'}</code>
              </KV>
              {token && (
                <KV k="本站 JWT">
                  <Badge kind={tokenLeft !== null && tokenLeft <= 0 ? 'err' : 'ok'}>
                    剩余 {humanDuration(tokenLeft)}
                  </Badge>
                  <Copy text={token} label="复制 JWT" />
                  <span className="hint tight">
                    仅本地解码，<b>未验签</b>
                    {tokenClaims?.identifier ? `；identifier=${tokenClaims.identifier}` : ''}
                  </span>
                </KV>
              )}
              <KV k="X 账号">
                {/* 从前这里点开的是 harness 自己的 X 绑定台（`XBindPage`）。
                    它不迁移 —— 宿主已有等价实现，见 migration-spec §5.7。
                    所以这颗按钮变成一条指向宿主 `/login/x` 的链接。

                    用 `<a>` 而不是 `Btn`：`Btn` 渲染的是 `<button>`，套不上
                    href，而"这是一条会离开本页的链接"必须让读屏与中键点击都
                    看得出来。整页跳转（不是 client-side push）是有意的：离开
                    harness 就该把这一页的状态一起丢掉，而不是留一份半活的。
                    `textDecoration: none` 是因为这份 CSS 里从来没有 `a` 的
                    规则（原仓库里也没有），不写就会在按钮上顶一条下划线。 */}
                <a
                  className="btn sm ghost"
                  style={{textDecoration: 'none'}}
                  href="/login/x"
                  title="宿主的 X 绑定页（harness 自己的那套不迁移）"
                >
                  打开 X 绑定台
                </a>
              </KV>

              {/* 钱包与代签授权**合成一行**：从前是两节，各把同样两只钱包列一遍，
                  而人真正要问的是"这只钱包是谁、它的 id 是什么、授权了没有"。 */}
              <h3>钱包</h3>
              <WalletRow
                title="SVM"
                address={byIndex(wallets)[0]?.address}
                walletId={walletIdOf(byIndex(wallets)[0]?.address)}
                status={signers.statusOf(byIndex(wallets)[0]?.address)}
                missing={signers.missing}
                busy={busy}
                onAuthorize={() => void doAuthorizeSigner(byIndex(wallets)[0]!.address, 'SVM')}
                onRevoke={() => void doRevokeSigner(byIndex(wallets)[0]!.address, 'SVM')}
                after={<UsdcBadge view={usdc} />}
              />
              <WalletRow
                title="EVM"
                address={byIndex(evmWallets)[0]?.address}
                walletId={walletIdOf(byIndex(evmWallets)[0]?.address)}
                status={signers.statusOf(byIndex(evmWallets)[0]?.address)}
                missing={signers.missing}
                busy={busy}
                onAuthorize={() => void doAuthorizeSigner(byIndex(evmWallets)[0]!.address, 'EVM')}
                onRevoke={() => void doRevokeSigner(byIndex(evmWallets)[0]!.address, 'EVM')}
                note="bsc / base / ethereum / robinhood 四条链共用这一只（同一个 id、同一个地址）"
              />
              {signers.missing !== null && <Note tone="warn">{signers.missing}</Note>}
              {authenticated && (!embedded || evmWallets.length === 0) && (
                <div className="row">
                  <Btn size="sm" busy={busy} disabled={busy} onClick={doCreateWallets}>
                    创建 embedded 钱包
                  </Btn>
                  <span className="hint tight">
                    建钱包不可回收，所以是按钮不是自动 —— 手滑点两次会得到两只真钱包
                  </span>
                </div>
              )}
              {authenticated && !embedded && (
                <Note tone="info">
                  <b>已认证但没有 embedded 钱包 —— 这是正常的，不是哪里配错了。</b>
                  这个页面走 headless 登录（邮箱验证码与 OAuth <b>两条都是</b>），而 Privy 的
                  自动建钱包只在走它自己的 modal 时才触发，所以{' '}
                  <code className="code">createOnLogin</code> 与 Dashboard
                  上那三个开关在这条路上都不生效，等多久都不会有。
                </Note>
              )}
              <Info label="说明 · 服务端代签授权">
                <p className="hint tight">
                  授权之后，<b>服务端拿授权私钥就能代替你签名，你不必在线、也不会再被问一次</b> ——
                  压测脚本正是靠它跑在 Node 里的。<b>两只钱包要各授权一次</b>，signer 挂在钱包上
                  不是挂在账号上；只授权一只的症状是「买入能跑、卖出签不了」。授权默认
                  <b>无限期</b>，直到点撤销。撤销是<b>全量摘除</b>，会连别人挂在这只钱包上的
                  signer 一起摘掉。这一档<b>不影响本页下单</b>，页面永远在浏览器里自己签。
                </p>
              </Info>

              <h3>动作</h3>
              {/* 还没换到本站 token：这一档要选对登录方式再换。 */}
              {!token && (
                <>
                  <p className="hint tight">
                    自动换取只跑一次（失败后不重试）。手动重来时<b>选对登录方式</b>：
                    <code className="code">auth_method</code> 必须与上面「登录方式」里真实
                    存在的一项一致，否则后端回 <code className="code">100107</code>。
                  </p>
                  <div className="row">
                    {(
                      ['AUTH_METHOD_EMAIL', 'AUTH_METHOD_GOOGLE', 'AUTH_METHOD_APPLE'] as const
                    ).map((m) => {
                      const privyType = AUTH_METHOD_PRIVY_TYPE[m];
                      const present = linkedTypes.includes(privyType);
                      return (
                        <Btn
                          key={m}
                          size="sm"
                          variant={m === authMethod ? 'default' : 'ghost'}
                          // 请求期间禁用：后端有防重入锁（TTL 10s），连点第二发
                          // 直接回 420102，而那个码看起来像 bug。
                          disabled={busy}
                          busy={busy && m === authMethod}
                          title={
                            present
                              ? `以 ${privyType} 换取`
                              : `identity token 里没有 ${privyType}，这样发会回 100107`
                          }
                          onClick={() => void doExchange(m)}
                        >
                          以 {m.replace('AUTH_METHOD_', '')} 换取{present ? '' : '（未绑定）'}
                        </Btn>
                      );
                    })}
                  </div>
                </>
              )}
              <div className="row">
                {token && (
                  <>
                    <Btn size="sm" variant="ghost" busy={busy} disabled={busy} onClick={doFetchUserInfo}>
                      验收：GET /v1/user/info
                    </Btn>
                    <Btn
                      size="sm"
                      variant="ghost"
                      busy={busy}
                      disabled={busy}
                      onClick={() => void doExchange()}
                    >
                      重新换取 token
                    </Btn>
                  </>
                )}
                <Btn size="sm" variant="ghost" onClick={doLogout}>
                  登出
                </Btn>
              </div>

              {userInfo && (
                <Note tone={userInfo.identifier === identifier ? 'ok' : 'err'}>
                  {userInfo.identifier === identifier ? (
                    <>
                      <b>identifier 与登录回包一致。</b>三个串（本站 JWT 的用户键、Privy
                      custom_auth 的 custom_user_id、business 的 subjectIdentifier）是同一个，
                      中间没有翻译。
                    </>
                  ) : (
                    <>
                      <b>identifier 与登录回包不一致</b>：登录给的是{' '}
                      <code className="code">{identifier}</code>，
                      <code className="code">/v1/user/info</code> 回的是{' '}
                      <code className="code">{userInfo.identifier}</code>。
                      <b>不要继续下单</b> —— 服务端会照后者去查钱包。
                    </>
                  )}
                  <pre className="block" style={{maxHeight: 160}}>
                    {JSON.stringify(userInfo, null, 2)}
                  </pre>
                </Note>
              )}

              {!gate.ready && <p className="hint tight">卡在：{gate.blocker}</p>}

              <Info label="说明 · token 与钱包归属">
                <p className="hint">
                  token <b>不存 localStorage</b>：Privy 会话靠 refresh token 撑 30 天，本站 JWT
                  只有 72 小时，存着必然出现「已认证但每个请求 401」。刷新页面会自动重换一次。
                </p>
                <p className="hint">
                  SVM 与 EVM 是<b>同一个用户的两只钱包，不是同一只</b> —— 地址体系不同，Privy
                  分别建。买 EVM 链上的币时 EVM 那只只是收货地址（全程不签），卖才由它出签名。
                </p>
                <p className="hint tight">
                  business 查钱包按 <code className="code">privy_did</code> 走，
                  <b>不再需要 link custom_auth</b>（后端 6751d44 起）。页面上那一步已经删掉 ——
                  它要求 Privy 开着 JWT-based auth，两个 app 都没开，留着只会当场 401
                  并把下单按钮永久锁死。
                </p>
              </Info>
            </>
          )}
        </Popover>
      )}

      <main className="page">
        {/* 这里从前是 `{view === 'x' ? <XBindPage …/> : …}` 一个三元分支。
            X 绑定台不迁移（migration-spec §5.7），分支连同它那一支一起删掉，
            只剩下面这一支。

            **下面这一整块没有跟着回退一级缩进**：三元分支删掉之后它在语法上
            少了一层，但重排会让这个文件与归档仓库的 diff 多出近三百行纯空白，
            把真正的改动淹掉 —— 而「能与归档仓库逐文件对照」正是原样搬的全部
            价值。要看真实差异请用 `diff -w`。 */}
          <div className="cols">
            {/* ============ 左：做事的 ============ */}
            <div>
              {/* 自检没过时，两条探针的原文顶到最上面。**只在没过时出现** ——
                  通过的自检没有任何后续动作，那句"两个探针都通过"占着版面只是
                  在复述顶栏那个按钮已经说完的话。当前后端由 BUSINESS_ORIGIN
                  决定（那个变量没有 VITE_ 前缀），所以标签也一并写在这里。 */}
              {probes && !probesOk && (
                <Note tone="err">
                  <b>后端自检没过</b> —— 后端 = <code className="code">{BUSINESS_LABEL}</code>
                  ，请求走同源代理 <code className="code">/v1</code>。
                  <br />
                  探针1 · 匿名 GET /v1/user/info：{probes.envelope.text}
                  {probes.envelope.detail && (
                    <>
                      <br />
                      <span className="hint tight">{probes.envelope.detail}</span>
                    </>
                  )}
                  <br />
                  探针2 · POST /v1/auth/login 是否存在：{probes.route.text}
                  {probes.route.detail && (
                    <>
                      <br />
                      <span className="hint tight">{probes.route.detail}</span>
                    </>
                  )}
                  <p className="hint tight" style={{marginTop: 'var(--s2)'}}>
                    <b>两个探针都期望"失败"</b>（后端按契约拒绝，拒绝本身就是证据）——
                    这里报的是**连拒绝都不对**：代理没起、后端是旧构建、或者这个后端
                    根本没有这条路由。三者的症状都是「登录失败」，而排查方向完全不同。
                  </p>
                </Note>
              )}

              {/* 这条不折叠、不收进抽屉 —— 它是这个页面唯一一句
                  "读晚了就来不及"的话。 */}
              <div className="alert" role="note">
                <IconWarn size={16} />
                <div>
                  这个页面会<b>花真钱</b>：签名发生在你浏览器里的 Privy embedded 钱包上，
                  服务端补上代付方签名后<b>直接广播到主网</b>。
                </div>
              </div>

              {/* ---------------- 交易 ---------------- */}
              {/* 下单与转出是**同一只钱包上的两种动作**，所以在一张卡里；
                  两者互斥，所以是分段控件不是并排。

                  **用 `hidden` 藏，不用条件渲染。** 条件渲染会把没显示那一侧
                  卸载掉，于是切走再切回来，填了一半的金额、核对过的目标地址
                  全没了 —— 而人切过去往往正是为了对一眼另一边的数字。 */}
              <Card
                title="交易"
                hero
                right={
                  <Tabs
                    value={pane}
                    onChange={setPane}
                    label="下单还是转出"
                    items={[
                      {k: 'trade', label: 'Swap'},
                      {k: 'transfer', label: '转出'},
                    ]}
                  />
                }
              >
                <div role="tabpanel" hidden={pane !== 'trade'}>
                  <SwapPanel
                    token={token}
                    account={`${CURRENT_ENV.key}:${tokenClaims?.identifier ?? 'anon'}`}
                    gateReady={gate.ready}
                    gateBlocker={gate.blocker}
                    solWallet={solWallet}
                    evmWallet={evmWallet}
                    walletIdOf={walletIdOf}
                    say={say}
                    onTerminal={onSwapTerminal}
                    prefill={sellPrefill}
                  />
                </div>

                {/* ---------------- 转出 ---------------- */}
                <div role="tabpanel" hidden={pane !== 'transfer'}>
                  <div className="form">
                    <div className="f">
                      <label htmlFor="f-目标地址">目标地址</label>
                      <input
                        id="f-目标地址"
                        className="inp"
                        value={xDest}
                        onChange={(e) => {
                          setXDest(e.target.value);
                          // 地址一改，上一次核对的结论就作废 —— 留着它等于拿 A
                          // 地址的「链上存在」给 B 地址背书。
                          setXDestInfo(null);
                          setXSig('');
                        }}
                      />
                      {/* 地址全文显示，**不截断**。截断显示是转错地址最常见的
                          来路 —— 中间那几十个字符正好是肉眼最不会去比对的部分。 */}
                      <p
                        className="hint tight"
                        style={{wordBreak: 'break-all', fontFamily: 'var(--mono)'}}
                      >
                        {xDest.trim() || '（空）'}
                      </p>
                    </div>

                    <Field
                      label="mint"
                      unit="经典 SPL Token"
                      value={xMint}
                      onChange={(v) => {
                        setXMint(v);
                        // mint 改了，decimals 与「目标有没有这个币的账户」两条都作废。
                        setXMintInfo(null);
                        setXDestInfo(null);
                        setXSig('');
                      }}
                    />

                    <Field
                      label="数量"
                      unit="按 decimals 的可读数"
                      value={xAmount}
                      onChange={setXAmount}
                      placeholder="6.486828"
                      after={
                        <>
                          <Btn
                            size="sm"
                            variant="ghost"
                            busy={busy}
                            disabled={busy || !embedded}
                            onClick={doFillAll}
                          >
                            填全部
                          </Btn>
                          <Btn size="sm" variant="ghost" busy={busy} disabled={busy} onClick={doCheckDest}>
                            核对
                          </Btn>
                        </>
                      }
                    />
                  </div>

                  {xMintInfo && (
                    <Note tone={xMintInfo.supported ? 'ok' : 'err'}>
                      mint：{xMintInfo.supported ? '经典 SPL Token' : `不支持 —— ${xMintInfo.why}`}
                      ，decimals={xMintInfo.decimals}
                    </Note>
                  )}
                  {xDestInfo && (
                    // **这是转错地址的主闸**：离线校验挡不住粘贴少一位（少一个
                    // 字符解出来仍可能是 32 字节），而手滑出来的地址几乎必然查无此账户。
                    <Note tone={xDestInfo.exists ? 'ok' : 'err'}>
                      {xDestInfo.exists ? (
                        <>
                          目标链上存在，{xDestInfo.isWallet ? '是普通钱包' : `owner=${xDestInfo.owner}`}，
                          {xDestInfo.hasAta ? '已有该币的账户' : '还没有该币的账户（这笔会顺带建一个）'}
                        </>
                      ) : (
                        <b>
                          目标链上不存在 —— 地址打错了吗？转过去的钱只有持有对应私钥的人能动，
                          不可逆。
                        </b>
                      )}
                    </Note>
                  )}

                  <div className="row" style={{marginTop: 'var(--s3)'}}>
                    <Btn
                      busy={busy}
                      disabled={busy || !embedded || !xAmount.trim() || !xDest.trim()}
                      onClick={doTransfer}
                    >
                      转出
                    </Btn>
                    {embedded && (
                      <span className="hint tight" style={{wordBreak: 'break-all'}}>
                        从 {embedded.address}
                      </span>
                    )}
                  </div>

                  {xSig && (
                    <p className="hint tight" style={{wordBreak: 'break-all', marginTop: 'var(--s2)'}}>
                      已广播：
                      <a
                        href={`https://explorer.solana.com/tx/${xSig}`}
                        target="_blank"
                        rel="noreferrer"
                        className="code"
                      >
                        {xSig}
                      </a>
                      <br />
                      成功不代表到账那一刻已经确认 —— 点开链接看链上状态。
                    </p>
                  )}

                  <Info label="说明 · 这条路不经过 business">
                    <p className="hint">
                      组包在本页，签名与广播都交给 Privy。它不进账本、不产生分录，服务端全程
                      不知情，所以<b>持仓那张表不会因为这笔转账而变化</b>（那张表记的是买卖，
                      不是链上余额）。
                    </p>
                    <p className="hint">
                      只支持<b>经典 SPL Token</b>。Token-2022 的币会在「核对」那一步被显式
                      拒绝 —— 它的 transfer hook 与手续费扩展会改变转账语义，用错 program
                      组包，链上回的是一句不指向这里的错误。
                    </p>
                    <p className="hint tight">
                      手续费由这只钱包自己付，所以<b>它必须有 SOL</b>；一个 SOL 为 0 的钱包，
                      这里点下去会失败在广播那一刻。
                    </p>
                  </Info>
                </div>
              </Card>

              {/* ---------------- 持仓 ---------------- */}
              <Card
                title="持仓"
                right={
                  <>
                    {positions && (
                      <span className="hint tight">
                        {positions.length} 行 · 还有量的{' '}
                        {positions.filter((p) => p.shares_raw !== '0').length} 行
                      </span>
                    )}
                    <Btn size="sm" disabled={busy || !token} onClick={doPositions}>
                      拉取
                    </Btn>
                  </>
                }
              >
                {!positions && <p className="hint tight">还没拉过。成交后会自动重查。</p>}
                {positions?.length === 0 && <p className="hint tight">还没有任何仓位。</p>}

                {grouped && grouped.held.length > 0 && (
                  <>
                    <p className="hint tight">
                      <b>持仓中</b>（{grouped.held.length}）· 最近开仓的排在前面
                    </p>
                    {positionTable(grouped.held)}
                  </>
                )}

                {grouped && grouped.held.length === 0 && positions!.length > 0 && (
                  <p className="hint tight">没有还持有的仓位 —— 下面都是清过仓的。</p>
                )}

                {grouped && grouped.closed.length > 0 && (
                  // 已清仓的收进折叠：它们是历史记录，不是每次都要看的东西，
                  // 摊开会把还持有的那几行挤下去 —— 而后者才是要卖的。
                  <Info label={`已清仓（${grouped.closed.length}）`}>
                    <p className="hint">
                      <code className="code">shares_raw</code> 为 0 的行。
                      <b>实测 portfolio 通常不回这种行</b>（2026-09-16 那份 16 行的样本里一个都
                      没有）—— 旧的 <code className="code">/v1/meme/positions</code> 会把清过仓的
                      留在列表里当历史记录，这条不留。这一组仍然分出来，是因为「后端不回」与
                      「恰好没有」在一份样本上分不出来。
                    </p>
                    {positionTable(grouped.closed)}
                  </Info>
                )}

                <Info label="说明 · 怎么读这张表">
                  <p className="hint">
                    卖出的 <code className="code">amount_in</code> 是<b>标的自己的最小单位</b>，
                    和买入那个（计价币的最小单位）不是一回事。「填充卖出数据」把{' '}
                    <code className="code">sellable_shares</code> 原样填进上面的下单表单，一次
                    换算都不做 —— 手填是这条路上最容易错的一处。<b>它只填表单，不下单。</b>
                  </p>
                  <p className="hint">
                    成交后这张表会自动重查，而且<b>会补查几次</b>：入账不在{' '}
                    <code className="code">included</code> 那一刻发生 —— 实际成交额由结算方稍后
                    发布，后端的对账巡回要在之后的某一趟才写得进账本。只查一次会稳定读到
                    <b>入账前</b>的那份列表，而它和「这笔没成交」长得一模一样。补查到看见变化
                    就停，最多盯 90 秒。
                  </p>
                  <p className="hint">
                    「变了没有」只看 <code className="code">shares_raw</code> 与两个修订号，
                    <b>一个价格字段都不看</b>。实测同一份仓位连打两发，
                    <code className="code">price_usd</code> /{' '}
                    <code className="code">market_value_usd</code> /{' '}
                    <code className="code">unrealized_pnl_usd</code> /{' '}
                    <code className="code">total_pnl_usd</code> /{' '}
                    <code className="code">pnl_ratio</code> 在<b>没有任何成交</b>的情况下就全变了
                    —— 把它们算进去，补查第一跳就会判成「已看到变化」，于是停在入账之前，
                    而日志上写的是一句报喜的话。
                  </p>
                  <p className="hint tight">
                    一行仓位的身份是（用户, 资产）—— 同一个币<b>只有一行</b>，名下多个钱包的
                    份额已由后端合并。<code className="code">shares_raw</code> 因此{' '}
                    <b>不是可卖上限</b>：下单只动 Privy embedded 钱包那一只，旧自建钱包里的
                    那部分导不进 Privy、永远签不了。<b>portfolio 把这件事修好了</b>——{' '}
                    <code className="code">sellable_shares</code> 就是现在真能卖的量，
                    「填充卖出数据」填的是它。两个数不等时，差额在「可卖」那一格标成「在途」。
                  </p>
                </Info>
              </Card>
            </div>

            {/* ============ 右：看结果的 ============ */}
            <div className="rail">
              {/* 最近一次业务失败的展开面板。**日志那一行放不下排障要的东西** ——
                  六位码的含义、该重试还是该重新发起、trace_id 与我们发出的
                  x-request-id 一不一致。摆在这一栏最上面：出了事它就是要先读的。 */}
              {lastErr && <ErrorPanel err={lastErr} linkedTypes={linkedTypes} />}

              {logCard}
            </div>
          </div>
      </main>
    </>
  );
}

/**
 * 钱包那一行：地址 / wallet id / 代签授权，**一只钱包收在一处**。
 *
 * 从前是「钱包」与「服务端代签授权」两节，各把同样两只钱包列一遍 —— 而人在这一屏上
 * 问的是"这只钱包是谁、它的 id 是什么、授权了没有"，答案分散在两节里要来回对。
 *
 * **只显示 wallet_index 最小的那只**，不显示 index 号：一个用户可能有多只 embedded
 * 钱包（StrictMode 让 createOnLogin 跑两遍就会多出一只，2026-08-28 实测撞过，见
 * main.tsx），多出来的那只删不掉、也不会被用到，列出来是噪音。
 *
 * wallet id 值得常驻：v2 的请求按 id 寻址（`source_wallet_id` / `destination_wallet_id`），
 * 除了这一行页面上没有第二处看得见它。授权状态同理 —— 授权是一次性动作、长期生效，
 * 不显示的话"我到底授权了没有"下一次无处可查，而重复授权不报错。
 */
function WalletRow({
  title,
  address,
  walletId,
  status,
  missing,
  busy,
  onAuthorize,
  onRevoke,
  after,
  note,
}: {
  title: string;
  /** 服务端会用的那只（wallet_index 最小）。没有钱包时缺席。 */
  address?: string;
  /** Privy 钱包 id（`user.linkedAccounts[].id`）。v2 的请求按它寻址，不按地址。 */
  walletId: string | null;
  status: SignerStatus | null;
  /** 没配 key quorum 时的原因。非 null 时授权按钮点不亮，原因写在 title 上。 */
  missing: string | null;
  busy: boolean;
  onAuthorize: () => void;
  onRevoke: () => void;
  /** 跟在地址后面的东西（Solana 那行是 USDC 余额）。没有就不占位。 */
  after?: ReactNode;
  /** 这只钱包值得说一句的事（EVM 那只是"四条链共用"）。 */
  note?: string;
}) {
  if (!address) {
    return (
      <KV k={title}>
        <span className="hint tight">（还没有钱包）</span>
      </KV>
    );
  }
  const delegated = status?.delegated === true;
  return (
    <>
      <KV k={title}>
        <Mono value={address} />
        {after}
      </KV>
      <KV k="">
        <span className="hint tight">id</span>
        {walletId ? <Mono value={walletId} head={10} tail={4} /> : <span className="hint tight">（授权之后才拿得到）</span>}
        {/* 未授权是 off 不是 err：它是个待办，不是故障。 */}
        <Badge kind={delegated ? 'ok' : 'off'}>{signerStatusLabel(status)}</Badge>
        {delegated ? (
          <Btn size="sm" variant="ghost" busy={busy} disabled={busy} onClick={onRevoke}>
            撤销
          </Btn>
        ) : (
          <Btn
            size="sm"
            busy={busy}
            disabled={busy || missing !== null}
            // 点不亮的按钮**必须把原因带在身上**，否则那会被当成本页的 bug，
            // 而真相在两个都不在这个页面上的地方（Privy 控制台 + .env.local）。
            title={missing ?? undefined}
            onClick={onAuthorize}
          >
            授权
          </Btn>
        )}
      </KV>
      {note && (
        <KV k="">
          <span className="hint tight">{note}</span>
        </KV>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// USDC 余额：交易之后自动重查，显示在地址后面
// ---------------------------------------------------------------------------

/**
 * 余额那一格的全部状态。**扁的、不是判别联合**，因为"正在重查"与"上一次读到
 * 多少"要同时显示：交易刚发完那几秒里，把数字换成"查询中…"等于把唯一有用的
 * 信息（上一次的余额）藏起来。
 */
type BalanceView = {
  bal?: UsdcBalance;
  /** 上一次读到的时刻。**"什么时候读的"决定这个数还算不算数**，所以要显示。 */
  at?: string;
  loading: boolean;
  err?: string;
};

/**
 * 一轮重查的时点（毫秒）。
 *
 * **只查一次是不够的**：Submit 返回的那一刻交易刚广播出去，即使用 confirmed
 * 这一档，链上余额也常常还没跟上 —— 那时读到的是扣款前的数，而它长得和
 * "这笔没成功"一模一样。补查三次把这个窗口盖住，代价是四个只读 RPC 请求。
 */
const BALANCE_RETRY_MS = [0, 3_000, 8_000, 15_000];

/**
 * 盯住一个地址的 USDC 余额。`refresh()` 触发一轮（含上面那几次补查）。
 *
 * 地址一出现就自动查第一次 —— 页面上不该有"要先点一下才有数"的格子。
 */
function useUsdcBalance(owner: string | undefined) {
  const [view, setView] = useState<BalanceView>({loading: false});
  // 每 +1 就是新的一轮。用计数器而不是直接在 refresh 里发请求，是为了让
  // "取消上一轮"落在 effect 的 cleanup 里 —— 手写取消一定会漏掉某条路径，
  // 而漏掉的症状是旧的那一轮后到，把新的数字盖回去。
  const [round, setRound] = useState(0);
  const refresh = useCallback(() => setRound((n) => n + 1), []);

  useEffect(() => {
    if (!owner) {
      setView({loading: false});
      return;
    }
    const ac = new AbortController();
    const timers: ReturnType<typeof setTimeout>[] = [];
    let alive = true;

    const once = async () => {
      setView((v) => ({...v, loading: true}));
      try {
        const bal = await fetchUsdcBalance(owner, ac.signal);
        if (alive) setView({bal, at: new Date().toLocaleTimeString(), loading: false});
      } catch (e) {
        // 组件已卸载、或这一轮被下一轮取消了 —— 那不是错误，别报。
        if (!alive || ac.signal.aborted) return;
        // 剩下的一律显式报出来（RPC 限流 429、key 失效 401 都长这样）。
        // **不保留上一次的值**：留着等于让人拿一个不知道多旧的数字当真。
        setView({loading: false, err: e instanceof Error ? e.message : String(e)});
      }
    };

    // 第 0 轮是"地址刚出现"，链上没有任何动静，查一次就够。
    // 之后每一轮都是交易触发的，要按 BALANCE_RETRY_MS 补查。
    for (const d of round === 0 ? [0] : BALANCE_RETRY_MS) {
      if (d === 0) void once();
      else timers.push(setTimeout(() => void once(), d));
    }

    return () => {
      alive = false;
      ac.abort();
      for (const t of timers) clearTimeout(t);
    };
  }, [owner, round]);

  return {view, refresh};
}

/** 地址后面那一格。三种形态：查询中 / 有数 / 读不到。 */
function UsdcBadge({view}: {view: BalanceView}) {
  if (view.err) {
    return (
      <>
        <Badge kind="err">USDC 读不到</Badge>
        {/* 原因要露出来：429 是限流（等一下就好），401 是 RPC key 的事，
            两者的处置完全不同，只说"读不到"等于让人猜。 */}
        <span className="hint tight">{view.err}</span>
      </>
    );
  }
  if (!view.bal) return <Badge kind="off">USDC 查询中…</Badge>;
  const {raw, ui, accounts} = view.bal;
  return (
    <Badge kind={view.loading ? 'live' : 'ok'}>
      <span title={`${raw} 最小单位 · ${view.at} 读到 · ${accounts} 个 token account`}>
        USDC {ui}
        {/* 0 且一个 token account 都没有，与"有账户但花光了"不是一回事：
            前者说明这个钱包从没收过 USDC，买入那一笔还要先建 ATA。 */}
        {accounts === 0 && '（还没有 token account）'}
        {view.loading && ' · 重查中'}
      </span>
    </Badge>
  );
}
