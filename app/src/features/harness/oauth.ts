import {useCallback, useEffect, useState} from 'react';
import {PRIVY_APP_ID} from './config';

/**
 * 探测 Privy dashboard 上有没有开 google / apple。
 *
 * 读的是 Privy 的**公开** app 配置端点（不需要任何凭据，前端本来就带着
 * app id）。这样 dashboard 一开，刷新本页就生效，不用改代码。
 *
 * **兜底方向必须保守：探测失败一律按「未开启」渲染。** 默认开的代价是
 * 用户点下去跳到一个 Privy 的报错页，而 OAuth 是**整页重定向** ——
 * 回来后整页 state 全丢，那个症状看起来完全像是本页的 bug。
 *
 * 抄自 `../privy-login-demo/src/hooks/useOAuthAvail.ts`。顺带一提，同一个
 * 端点也是 `App.tsx` 里 doCreateWallets 那段注释拿两个 app 的 `create_on_login`
 * 做对照时用的那个（`GET https://auth.privy.io/api/v1/apps/<appId>`，
 * 要带 `privy-app-id` 请求头）。
 */
export type OAuthAvail = {
  google: boolean;
  apple: boolean;
  /** 探测完成的时刻，null = 还没探到。显示出来让人知道数据有多新。 */
  checkedAt: number | null;
  loading: boolean;
  /** 探测失败的原因，用于在 UI 上说明「按未开启处理」的由来。 */
  error: string | null;
  /** 控制台上的真实取值。用来把"控制台没开"与"本地硬闸没开"分开说。 */
  dashboard: {google: boolean; apple: boolean} | null;
  recheck: () => void;
};

// **探的是当前环境那个 app 的控制台配置**，不是写死的那一个：两套环境是
// 两个 Privy app，Google / Apple 在它们上面可以开得不一样。探错了 app
// 的症状是按钮该亮的不亮（或反过来），而按钮本身不解释任何事。
const APP_ID = PRIVY_APP_ID;

/** 两道闸里的第二道。控制台开了、这里没置 true，同样点不亮。 */
export const ENABLE_GOOGLE = process.env.NEXT_PUBLIC_ENABLE_GOOGLE === 'true';
export const ENABLE_APPLE = process.env.NEXT_PUBLIC_ENABLE_APPLE === 'true';

export function useOAuthAvail(): OAuthAvail {
  const [state, setState] = useState<Omit<OAuthAvail, 'recheck'>>({
    google: false,
    apple: false,
    checkedAt: null,
    loading: true,
    error: null,
    dashboard: null,
  });

  const probe = useCallback(() => {
    setState((s) => ({...s, loading: true, error: null}));
    fetch(`https://auth.privy.io/api/v1/apps/${APP_ID}`, {
      headers: {'privy-app-id': APP_ID},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((app: {google_oauth?: boolean; apple_oauth?: boolean}) => {
        const dashboard = {google: app.google_oauth === true, apple: app.apple_oauth === true};
        setState({
          // env 硬闸与运行期探测是**与**的关系：任一为假就不可用。
          // 硬闸的意义是，万一哪天这个探测端点变了，还有一个不依赖网络的开法。
          google: ENABLE_GOOGLE && dashboard.google,
          apple: ENABLE_APPLE && dashboard.apple,
          checkedAt: Date.now(),
          loading: false,
          error: null,
          dashboard,
        });
      })
      .catch((e: unknown) => {
        setState({
          google: false,
          apple: false,
          checkedAt: Date.now(),
          loading: false,
          error: e instanceof Error ? e.message : String(e),
          dashboard: null,
        });
      });
  }, []);

  useEffect(probe, [probe]);

  return {...state, recheck: probe};
}

/**
 * 按钮为什么点不亮 —— 一句话说清是哪一道闸。
 *
 * 禁用的按钮**必须把原因写在旁边**，否则"点不亮"会被当成本页的 bug，
 * 而真相在两个都不在这个页面上的地方（Privy 控制台 + `.env.local`）。
 */
export function oauthBlockedReason(
  avail: OAuthAvail,
  provider: 'google' | 'apple',
): string | null {
  if (avail[provider]) return null;
  if (avail.loading) return '正在读取 Privy 控制台配置…';
  if (avail.error) return `读不到 Privy 控制台配置（${avail.error}），保守按「未开启」处理`;
  const localGate = provider === 'google' ? ENABLE_GOOGLE : ENABLE_APPLE;
  const dash = avail.dashboard?.[provider] === true;
  if (!dash && !localGate) {
    return `两道闸都没开：Privy 控制台的 ${provider}_oauth=false，本地 NEXT_PUBLIC_ENABLE_${provider.toUpperCase()} 也不是 true`;
  }
  if (!dash) return `Privy 控制台没开 ${provider}_oauth（不是本页的 bug）`;
  return `控制台开着，但本地硬闸没开 —— 在 .env.local 里置 NEXT_PUBLIC_ENABLE_${provider.toUpperCase()}=true 并重启 dev server`;
}
