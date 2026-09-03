import {useCallback, useEffect, useRef, useState} from 'react';

import {ApiError} from '@/api/envelope';
import {
  completeXBind,
  describeBinding,
  FOLLOW_IMPORT,
  getXBinding,
  startXBind,
  unbindX,
  X_CODE,
  type XBinding,
} from '@/api/ximport';
import type {LogLevel} from '@/hooks/useEventLog';
import {
  clearCapture,
  clearPending,
  readPending,
  writePending,
  type XPending,
} from '@/session/xpending';

/**
 * 只要 useEventLog 的三个**稳定**方法，不要整个对象。
 *
 * useEventLog 每次渲染都返回一个新对象（`entries` 一变，对象身份就变），
 * 把它整个放进 useCallback/useEffect 的依赖里，轮询那个 effect 会**每渲染
 * 一次就重建一次定时器** —— 表现是计时永远走不满 5 秒、请求越发越密，
 * 最后撞 420000。而 push/begin/end 各自是 useCallback 包过的，身份稳定。
 */
export type EventLogFns = {
  push: (level: LogLevel, step: string, detail?: string) => void;
  begin: (step: string) => void;
  end: (level: LogLevel, step: string, detail?: string, traceID?: string) => void;
};

/** 契约建议值：绑定成功后每 5 秒查一次。别更密，会撞身份限流。 */
export const POLL_INTERVAL_MS = 5_000;
/** 超过这个时长仍是 PENDING 就停手。后台仍会继续重试，不必让页面无限转圈。 */
export const POLL_DEADLINE_MS = 120_000;

export type XBindState =
  /** 还没查过。**与"未绑定"是两回事**，混起来会让首屏闪一下"未绑定"。 */
  | {kind: 'idle'}
  /** 后端明确回了 200104。 */
  | {kind: 'unbound'}
  | {kind: 'bound'; binding: XBinding; at: number};

type FetchOutcome =
  | {ok: true; binding: XBinding}
  | {ok: false; unbound: true}
  | {ok: false; unbound?: false; err: ApiError};

export type XBindController = {
  state: XBindState;
  /** 首次/手动拉取中（会挡 UI）。轮询用的是静默拉取，不置这个。 */
  loading: boolean;
  /** 有写请求在飞：按钮要禁掉，否则连点会把一次性的 state 白白烧掉。 */
  busy: boolean;
  err: ApiError | null;
  pending: XPending | null;
  polling: boolean;
  pollTimedOut: boolean;
  refresh: () => void;
  start: () => void;
  complete: (code: string, state: string) => void;
  unbind: () => void;
  /** 超时后用户还想再等时用。**不是自动的** —— 自动续期等于没有上限。 */
  resumePolling: () => void;
  dismissError: () => void;
};

/**
 * X 绑定的全部副作用都在这里，页面组件只负责画。
 *
 * 三件必须做对、做错了都不报错的事：
 *   ① **200104 不是错误**，是"这个人没绑"。当成错误弹红框的话，第一次打开
 *      页面的人会以为后端坏了。
 *   ② **提交过一次就要清掉本地的 state**（无论成败）：它是一次性的，
 *      再提交回 400103。留着的话按钮还亮着，而它已经注定失败 ——
 *      症状是"我明明照文档做了却一直 400103"。
 *   ③ **轮询要有截止时间**。没有的话页面会一直转，而后台任务可能几分钟后
 *      才排到 —— 用户以为卡死，其实只是还没轮到。
 */
export function useXBind(jwt: string | null, log: EventLogFns): XBindController {
  // 解构出稳定引用，理由见 EventLogFns 的注释。
  const {push, begin, end} = log;

  const [state, setState] = useState<XBindState>({kind: 'idle'});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [pending, setPending] = useState<XPending | null>(() => readPending());
  const [polling, setPolling] = useState(false);
  const [pollTimedOut, setPollTimedOut] = useState(false);

  const deadline = useRef(0);
  const pollingRef = useRef(false);
  /** 上一发还没回来就别再发：慢响应下定时器会把请求越堆越多。 */
  const inFlight = useRef(false);
  /**
   * 每发起一次**写**（绑定/解绑）就 +1。读请求在出发前记下它，回来时对不上
   * 就把结果丢掉。
   *
   * 防的是一个真实存在的顺序：进本页时会先拉一次绑定态，而回调自动提交几乎
   * 同时发出。GET 大概率先回（POST 那边还要去 X 换 token），于是 GET 的
   * 「200104 未绑定」会**盖掉**刚刚绑定成功的结果 —— 页面显示"未绑定"，
   * 而后端库里明明绑上了，人只能靠手动刷新才发现，中间那段时间会以为绑失败了。
   */
  const writeSeq = useRef(0);

  useEffect(() => {
    pollingRef.current = polling;
  }, [polling]);

  const startPolling = useCallback(() => {
    // 已经在轮询就不要重置截止时间 —— 每刷新一次续 2 分钟的话，
    // 那个上限等于不存在。真想继续等有显式的「继续轮询」。
    if (pollingRef.current) return;
    deadline.current = Date.now() + POLL_DEADLINE_MS;
    setPollTimedOut(false);
    setPolling(true);
  }, []);

  const stopPolling = useCallback(() => setPolling(false), []);

  /** 静默拉一次绑定态。**不碰 loading/err**，让轮询与手动刷新共用同一段逻辑。 */
  const fetchBinding = useCallback(async (): Promise<FetchOutcome> => {
    if (!jwt) {
      return {ok: false, err: new ApiError('network', 0, '本地没有本站 JWT，先去登录页换一个')};
    }
    const step = 'GET /v1/user/x/binding';
    begin(step);
    try {
      const res = await getXBinding(jwt);
      end('ok', step, describeBinding(res.data), res.traceID);
      return {ok: true, binding: res.data};
    } catch (e) {
      const apiErr = e as ApiError;
      if (apiErr.kind === 'business' && apiErr.code === X_CODE.bindingNotFound) {
        end('info', step, '200104 未绑定 —— 这是正常状态，不是错误', apiErr.traceID);
        return {ok: false, unbound: true};
      }
      end('error', step, `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
      return {ok: false, err: apiErr};
    }
  }, [jwt, begin, end]);

  /** 把一次拉取结果落到 state，并按进度决定要不要继续轮询。 */
  const apply = useCallback(
    (out: FetchOutcome) => {
      if (out.ok) {
        setState({kind: 'bound', binding: out.binding, at: Date.now()});
        if (out.binding.follow_import?.status === FOLLOW_IMPORT.PENDING) startPolling();
        else stopPolling();
        return;
      }
      if (out.unbound) {
        setState({kind: 'unbound'});
        stopPolling();
        return;
      }
      setErr(out.err);
    },
    [startPolling, stopPolling],
  );

  const refresh = useCallback(() => {
    if (!jwt || inFlight.current) return;
    inFlight.current = true;
    setLoading(true);
    setErr(null);
    const seq = writeSeq.current;
    void fetchBinding()
      .then((out) => {
        if (seq !== writeSeq.current) return; // 期间有写发生，这份读已经过时
        apply(out);
      })
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, [jwt, fetchBinding, apply]);

  /** 有 JWT 就先看一眼当前绑定态。没有 JWT 时**不发请求** —— 那一发必然 400000，
   *  白白在日志里留一条会误导人的失败。 */
  useEffect(() => {
    if (jwt) refresh();
  }, [jwt, refresh]);

  useEffect(() => {
    if (!polling || !jwt) return;
    let cancelled = false;
    const id = setInterval(() => {
      if (Date.now() > deadline.current) {
        setPolling(false);
        setPollTimedOut(true);
        push(
          'warn',
          '关注导入轮询已停止（2 分钟仍是 PENDING）',
          '后台仍在重试，稍后回来刷新即可 —— 停下来是为了不让页面无限转圈',
        );
        return;
      }
      if (inFlight.current) return;
      inFlight.current = true;
      const seq = writeSeq.current;
      void fetchBinding()
        .then((out) => {
          if (cancelled || seq !== writeSeq.current) return;
          // 轮询期间撞限流不算失败：退一格等下一轮就好，
          // 把它当错误停掉轮询会让"导入中"永远停在原地。
          if (!out.ok && !out.unbound && out.err.kind === 'business' && out.err.code === 420000) {
            push('warn', '轮询撞到 420000 限流', '保持 5 秒节奏，等下一轮');
            return;
          }
          apply(out);
        })
        .finally(() => {
          inFlight.current = false;
        });
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [polling, jwt, fetchBinding, apply, push]);

  const start = useCallback(() => {
    if (!jwt || busy) return;
    setBusy(true);
    setErr(null);
    const step = 'POST /v1/user/x/bind/start';
    begin(step);
    void startXBind(jwt)
      .then((res) => {
        const p: XPending = {
          state: res.data.state,
          authorizeUrl: res.data.authorize_url,
          at: Date.now(),
        };
        // 立刻落盘：下一步是**整页跳转**去 x.com，这个组件会被卸载，
        // 内存里的 state 到时候就没了，而没有 state 完成不了绑定。
        writePending(p);
        setPending(p);
        end('ok', step, `state=${res.data.state}`, res.traceID);
      })
      .catch((e: unknown) => {
        const apiErr = e as ApiError;
        setErr(apiErr);
        end('error', step, `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
      })
      .finally(() => setBusy(false));
  }, [jwt, busy, begin, end]);

  const complete = useCallback(
    (code: string, stateValue: string) => {
      if (!jwt || busy) return;
      writeSeq.current += 1;
      setBusy(true);
      setErr(null);
      const step = 'POST /v1/user/x/bind';
      begin(step);
      void completeXBind(jwt, code, stateValue)
        .then((res) => {
          setState({kind: 'bound', binding: res.data, at: Date.now()});
          end('ok', step, describeBinding(res.data), res.traceID);
          // 回包里 status 恒为 1（PENDING），关注列表此刻还没开始拉。
          startPolling();
        })
        .catch((e: unknown) => {
          const apiErr = e as ApiError;
          setErr(apiErr);
          end('error', step, `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
        })
        .finally(() => {
          // **无论成败都清**：state 提交一次即作废，见本 hook 头 ②。
          clearPending();
          clearCapture();
          setPending(null);
          setBusy(false);
        });
    },
    [jwt, busy, begin, end, startPolling],
  );

  const unbind = useCallback(() => {
    if (!jwt || busy) return;
    writeSeq.current += 1;
    setBusy(true);
    setErr(null);
    const step = 'POST /v1/user/x/unbind';
    begin(step);
    void unbindX(jwt)
      .then((res) => {
        setState({kind: 'unbound'});
        stopPolling();
        setPollTimedOut(false);
        end('ok', step, '已解绑（逻辑删除，之后查询回 200104）', res.traceID);
      })
      .catch((e: unknown) => {
        const apiErr = e as ApiError;
        setErr(apiErr);
        end('error', step, `${apiErr.code} ${apiErr.message}`, apiErr.traceID);
      })
      .finally(() => setBusy(false));
  }, [jwt, busy, begin, end, stopPolling]);

  const resumePolling = useCallback(() => {
    deadline.current = Date.now() + POLL_DEADLINE_MS;
    setPollTimedOut(false);
    setPolling(true);
  }, []);

  return {
    state,
    loading,
    busy,
    err,
    pending,
    polling,
    pollTimedOut,
    refresh,
    start,
    complete,
    unbind,
    resumePolling,
    dismissError: useCallback(() => setErr(null), []),
  };
}
