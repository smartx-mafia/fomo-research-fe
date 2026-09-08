"use client";

/**
 * SmartX 行情 WebSocket 层（docs/api/market.md §3）。
 *
 * 整页共用一条连接（服务端限制：每 IP 20 条连接、每条连接 20 个 topic，
 * 不要每个 topic 开一条），按 topic 分发帧。落实 §3.3 的四条客户端规则：
 *   1. 订阅即快照：snapshot 是基线，update 按 (chain,address) 覆盖，remove 删除
 *   2. seq 跳号 = 漏了事件 → 丢弃手里的榜单，重新 subscribe 拿新 snapshot
 *   3. kind:"error"（stream reset）→ 必须重新 subscribe
 *   4. 断连重连后重发所有 subscribe，指数退避 1s 起上限 30s
 */

import { useEffect, useRef, useState } from "react";
import { normalizeTokenMarket, getWsUrl } from "./market";
import { num } from "./format";
import type { BoardName, TokenMarket, WsFrame } from "./types";

type FrameHandler = (frame: WsFrame) => void;
type ConnState = "connecting" | "open" | "closed";

class MarketSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<FrameHandler>>();
  private stateListeners = new Set<(s: ConnState) => void>();
  private state: ConnState = "closed";
  private backoff = 1000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private setState(s: ConnState) {
    this.state = s;
    this.stateListeners.forEach((cb) => cb(s));
  }

  private connect() {
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) return;
    this.setState("connecting");
    const ws = new WebSocket(getWsUrl());
    this.ws = ws;

    ws.onopen = () => {
      this.backoff = 1000;
      this.setState("open");
      // 连接级状态服务端不保留：重连后重发所有 subscribe（规则 4）
      for (const topic of this.handlers.keys()) {
        this.send({ op: "subscribe", topic });
      }
    };

    ws.onmessage = (e) => {
      let frame: WsFrame;
      try {
        frame = JSON.parse(e.data as string) as WsFrame;
      } catch {
        return;
      }
      if (frame.topic) {
        this.handlers.get(frame.topic)?.forEach((cb) => cb(frame));
      } else if (frame.op === "error") {
        // 无 topic 的协议错误（拼错 op、超订阅上限），不断连
        console.warn("[market-ws] protocol error:", frame.reason);
      }
    };

    ws.onclose = () => {
      this.ws = null;
      this.setState("closed");
      if (this.handlers.size > 0) this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay = this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.handlers.size > 0) this.connect();
    }, delay);
  }

  private send(msg: object) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  subscribe(topic: string, cb: FrameHandler) {
    let set = this.handlers.get(topic);
    if (!set) {
      set = new Set();
      this.handlers.set(topic, set);
    }
    set.add(cb);
    this.connect();
    // 重复 subscribe 无害：服务端回一份新 snapshot，正好重置基线
    this.send({ op: "subscribe", topic });
  }

  unsubscribe(topic: string, cb: FrameHandler) {
    const set = this.handlers.get(topic);
    if (!set) return;
    set.delete(cb);
    if (set.size === 0) {
      this.handlers.delete(topic);
      this.send({ op: "unsubscribe", topic });
    }
  }

  /** seq 跳号 / stream reset 后重订，拿新 snapshot */
  resubscribe(topic: string) {
    this.send({ op: "subscribe", topic });
  }

  /** 订阅连接状态，立即回调一次当前值；返回取消函数 */
  onState(cb: (s: ConnState) => void): () => void {
    this.stateListeners.add(cb);
    cb(this.state);
    return () => {
      this.stateListeners.delete(cb);
    };
  }
}

let singleton: MarketSocket | null = null;

export function getMarketSocket(): MarketSocket {
  if (!singleton) singleton = new MarketSocket();
  return singleton;
}

export type StreamStatus = "connecting" | "live" | "rejected";

/**
 * 订阅一个榜单 topic，维护 snapshot + update/remove 合并后的列表。
 * `initial` 是可选启动快照，只在首次挂载时生效，WS snapshot 到达即被替换。
 *
 * 2026-09 起榜单只有五个跨链聚合 topic（另含 board:most_held），
 * 链变体 topic（board:{board}:{chain}）已被网关删除，订阅会收到 op=error 帧。
 */
export function useBoardStream(board: BoardName, initial?: TokenMarket[]) {
  const [items, setItems] = useState<TokenMarket[]>(initial ?? []);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const initialRef = useRef(initial);

  useEffect(() => {
    const topic = `board:${board}`;
    const sock = getMarketSocket();
    // StrictMode 下 effect 会跑两遍，initial 只能消费一次：
    // 用 prop 快照而非可变 ref，第二遍仍能拿到同一份启动数据
    const initialItems = initial;

    // 列表本体放在闭包里，setItems 只发副本，避免并发帧覆盖彼此的 state 更新
    let list: TokenMarket[] = [];
    let lastSeq: number | null = null;
    let hasSnapshot = false;

    // 启动快照只用一次（切 tab 回来不再用，等 WS snapshot）
    if (initialRef.current) {
      list = [...initialRef.current];
      initialRef.current = undefined;
    } else if (initialItems) {
      list = [...initialItems];
    }
    setItems([...list]);
    setStatus("connecting");

    const reset = () => {
      hasSnapshot = false;
      lastSeq = null;
      setStatus("connecting");
      sock.resubscribe(topic);
    };

    const onFrame = (f: WsFrame) => {
      // op=error = 订阅参数错（如退役 topic），重订一万次也不会对，绝不自动重订。
      // 只有 kind:"error"（stream reset）才走下面 reset() 的重订路径。
      if (f.op === "error") {
        console.warn(`[market-ws] subscribe rejected (${topic}):`, f.reason);
        setStatus("rejected");
        return;
      }

      if (f.kind === "snapshot") {
        const data = f.data as { seq?: unknown; items?: unknown[] } | undefined;
        list = (data?.items ?? []).map(normalizeTokenMarket);
        // 帧外层 seq 恒为数字；snapshot 内层 seq 在 WS 里是字符串（§3.5）
        lastSeq = f.seq ?? num(data?.seq) ?? null;
        hasSnapshot = true;
        setItems([...list]);
        setStatus("live");
        return;
      }

      if (f.kind === "update" || f.kind === "remove") {
        // snapshot 之前的增量没有基线可合并，丢弃（协议保证订阅首帧是 snapshot）
        if (!hasSnapshot) return;
        const seq = f.seq;
        if (seq !== undefined && lastSeq !== null && seq > lastSeq + 1) {
          // 跳号 = 漏了一版：错误基线上继续合并会得到"看起来正常、内容是错的"榜单（规则 2）
          reset();
          return;
        }
        if (seq !== undefined) lastSeq = Math.max(lastSeq ?? seq, seq);

        if (f.kind === "update") {
          // 协议 v2：update 的 data 是合批后的 TokenMarket 数组（窗口内同币只发最后一次状态）
          const batch = Array.isArray(f.data) ? f.data : [f.data];
          for (const raw of batch) {
            const tok = normalizeTokenMarket(raw);
            const i = list.findIndex((t) => t.chain === tok.chain && t.address === tok.address);
            if (i >= 0) list[i] = tok;
            else list.push(tok);
          }
        } else {
          // remove 同样是数组：漏处理会残留已出榜的币（周期快照 10s 内会冲正，但用户看得见）
          const batch = Array.isArray(f.data) ? f.data : [f.data];
          for (const d of batch as { chain?: string; address?: string }[]) {
            list = list.filter((t) => !(t.chain === d?.chain && t.address === d?.address));
          }
        }
        setItems([...list]);
        return;
      }

      if (f.kind === "error") {
        // stream reset：topic 已被服务端移除，不重订就永远没数据（规则 3）
        reset();
      }
    };

    sock.subscribe(topic, onFrame);
    const offState = sock.onState((s) => {
      if (s !== "open") setStatus("connecting");
    });

    return () => {
      offState();
      sock.unsubscribe(topic, onFrame);
    };
  }, [board]);

  return { items, status };
}

/**
 * 订阅单币 topic（token:{chain}:{address}）。每帧都是最新全量态，
 * 无脑覆盖即可（§3.4）。退订后服务端约 90s 停止刷新该币。
 */
export function useTokenLive(chain: string, address: string, initial?: TokenMarket) {
  const [data, setData] = useState<TokenMarket | undefined>(initial);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const topic = `token:${chain}:${address}`;
    const sock = getMarketSocket();

    const onFrame = (f: WsFrame) => {
      if (f.kind === "update") {
        // token topic 的 update 数组通常只有一条，是最新全量态；取最后一条覆盖即可
        const raw = Array.isArray(f.data) ? f.data[f.data.length - 1] : f.data;
        setData(normalizeTokenMarket(raw));
        setLive(true);
      } else if (f.kind === "error") {
        setLive(false);
        sock.resubscribe(topic);
      }
    };

    sock.subscribe(topic, onFrame);
    const offState = sock.onState((s) => {
      if (s !== "open") setLive(false);
    });

    return () => {
      offState();
      sock.unsubscribe(topic, onFrame);
    };
  }, [chain, address]);

  return { data, live };
}
