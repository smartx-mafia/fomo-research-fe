import {useCallback, useEffect, useState} from 'react';

import {ENABLE_APPLE, ENABLE_GOOGLE, PRIVY_APP_ID} from '@/config';

/**
 * 探测 Privy dashboard 上有没有开 google / apple。
 *
 * 读的是 Privy 的**公开** app 配置端点（不需要任何凭据，前端本来就带着
 * app id）。这样 dashboard 一开，刷新本页就生效，不用改代码。
 *
 * **兜底方向必须保守：探测失败一律按「未开启」渲染。** 默认开的代价是
 * 用户点下去跳到一个 Privy 的报错页，回来后整页 state 全丢 ——
 * 而那个症状看起来完全像是本页的 bug。
 */
export type OAuthAvail = {
  google: boolean;
  apple: boolean;
  /** 探测完成的时刻，null = 还没探到。显示出来让人知道数据有多新。 */
  checkedAt: number | null;
  loading: boolean;
  /** 探测失败的原因，用于在 UI 上说明「按未开启处理」的由来。 */
  error: string | null;
  recheck: () => void;
};

export function useOAuthAvail(): OAuthAvail {
  const [state, setState] = useState<Omit<OAuthAvail, 'recheck'>>({
    google: false,
    apple: false,
    checkedAt: null,
    loading: true,
    error: null,
  });

  const probe = useCallback(() => {
    setState((s) => ({...s, loading: true, error: null}));
    fetch(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}`, {
      headers: {'privy-app-id': PRIVY_APP_ID},
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((app: {google_oauth?: boolean; apple_oauth?: boolean}) => {
        setState({
          // env 硬闸与运行期探测是**与**的关系：任一为假就不可用。
          // 硬闸的意义是，万一哪天这个探测端点变了，还有一个不依赖网络的开法。
          google: ENABLE_GOOGLE && app.google_oauth === true,
          apple: ENABLE_APPLE && app.apple_oauth === true,
          checkedAt: Date.now(),
          loading: false,
          error: null,
        });
      })
      .catch((e: unknown) => {
        setState({
          google: false,
          apple: false,
          checkedAt: Date.now(),
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }, []);

  useEffect(probe, [probe]);

  return {...state, recheck: probe};
}
