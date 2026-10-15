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
    // 服务端对重复订阅幂等；新监听者会在周期快照到达时建立基线。
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
    // 服务端忽略同连接的重复subscribe，必须先退订才能主动取得新基线。
    this.send({ op: "unsubscribe", topic });
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

/** Merge normalized backend rows only; membership/risk qualification stays server-owned. */
export function mergeBoardUpdates(current: TokenMarket[], data: unknown): TokenMarket[] {
  const next = [...current];
  const batch = Array.isArray(data) ? data : [data];
  for (const raw of batch) {
    const token = normalizeTokenMarket(raw);
    const index = next.findIndex((item) => item.chain === token.chain && item.address === token.address);
    if (index >= 0) next[index] = token;
    else next.push(token);
  }
  return next;
}

/** 按完整topic绑定基线，切榜不能复用旧榜的列表、状态或seq。null表示暂停订阅。 */
export function useBoardStream(board: BoardName | null, initial?: TokenMarket[]) {
  const topic = board ? `board:${board}` : null;
  const bootstrap = useRef({topic, items: initial});
  const [view, setView] = useState<{topic: string | null; items: TokenMarket[]; status: StreamStatus}>(() => ({
    topic, items: initial ?? [], status: "connecting",
  }));

  useEffect(() => {
    // StrictMode的同topic重挂可复用启动值；第一次换topic后永不重放这份旧快照。
    if (bootstrap.current.topic !== topic) bootstrap.current = {topic: null, items: undefined};
    if (!topic) {
      setView({topic: null, items: [], status: "connecting"});
      return;
    }
    const sock = getMarketSocket();
    let active = true;
    let list: TokenMarket[] = bootstrap.current.items ? [...bootstrap.current.items] : [];
    let lastSeq: number | null = null;
    let hasSnapshot = false;
    const publish = (status: StreamStatus) => {
      if (active) setView({topic, items: [...list], status});
    };
    const invalidate = () => {
      list = [];
      hasSnapshot = false;
      lastSeq = null;
      publish("connecting");
    };
    const reset = () => {
      invalidate();
      sock.resubscribe(topic);
    };
    publish("connecting");

    const onFrame = (f: WsFrame) => {
      if (!active) return;
      if (f.op === "error") {
        console.warn(`[market-ws] subscribe rejected (${topic}):`, f.reason);
        list = [];
        hasSnapshot = false;
        lastSeq = null;
        publish("rejected");
        return;
      }
      if (f.kind === "snapshot") {
        const data = f.data as {seq?: unknown; items?: unknown[]} | undefined;
        list = (data?.items ?? []).map(normalizeTokenMarket);
        lastSeq = f.seq ?? num(data?.seq) ?? null;
        hasSnapshot = true;
        publish("live");
        return;
      }
      if (f.kind === "update" || f.kind === "remove") {
        if (!hasSnapshot) return;
        const seq = f.seq;
        if (seq !== undefined && lastSeq !== null) {
          if (seq < lastSeq) return;
          if (seq > lastSeq + 1) { reset(); return; }
        }
        if (seq !== undefined) lastSeq = Math.max(lastSeq ?? seq, seq);
        if (f.kind === "update") {
          list = mergeBoardUpdates(list, f.data);
        } else {
          const batch = Array.isArray(f.data) ? f.data : [f.data];
          for (const d of batch as {chain?: string; address?: string}[]) {
            list = list.filter((t) => !(t.chain === d?.chain && t.address === d?.address));
          }
        }
        publish("live");
        return;
      }
      if (f.kind === "error") reset();
    };

    sock.subscribe(topic, onFrame);
    const offState = sock.onState((state) => {
      if (state !== "open") {
        if (hasSnapshot) invalidate();
        else publish("connecting");
      }
    });
    return () => {
      active = false;
      offState();
      sock.unsubscribe(topic, onFrame);
    };
  }, [topic]);

  // effect清理之前的那次render也不能把旧榜数据画到新榜标题下。
  return view.topic === topic && topic ? {items: view.items, status: view.status} : {items: [], status: "connecting" as StreamStatus};
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
        const incoming = normalizeTokenMarket(raw);
        const expectedAddress = chain === 'solana' ? address : address.toLowerCase();
        if (incoming.chain !== chain || incoming.address !== expectedAddress || !incoming.updated_at) return;
        setData((previous) => previous?.updated_at && incoming.updated_at! < previous.updated_at ? previous : incoming);
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
