import {createStreamTicket, getSwap} from './api';
import {FAST_SWAP_API_BASE} from './config';
import {newerSnapshot, parseSwapEvent, type SwapSnapshot} from './contract';

type WatchOptions = {bearer: string; swapID: string; afterVersion: string; onSnapshot: (snapshot: SwapSnapshot) => void; onStatus?: (status: string) => void};

function websocketURL(value: string): string {
  const url = new URL(value, `${FAST_SWAP_API_BASE}/`);
  if (url.protocol === 'https:') url.protocol = 'wss:';
  else if (url.protocol === 'http:') url.protocol = 'ws:';
  if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Fast Swap returned an invalid WebSocket URL.');
  return url.toString();
}

/** WebSocket is an accelerator. Polling remains authoritative when it is unavailable. */
export function watchSwap(options: WatchOptions): () => void {
  let stopped = false; let socket: WebSocket | undefined; let retry: ReturnType<typeof setTimeout> | undefined; let version = options.afterVersion;
  let latest: SwapSnapshot | undefined;
  const reconnect = (delay: number) => { if (!stopped) retry = setTimeout(connect, delay); };
  const reset = async () => {
    const snapshot = await getSwap(options.bearer, options.swapID);
    if (stopped) return;
    latest = newerSnapshot(latest, snapshot); version = latest.event_version; options.onSnapshot(latest);
  };
  const connect = async () => {
    try {
      options.onStatus?.('connecting');
      const ticket = await createStreamTicket(options.bearer);
      if (stopped) return;
      socket = new WebSocket(websocketURL(ticket.websocket_url));
      socket.onopen = () => socket?.send(JSON.stringify({type: 'authenticate', ticket: ticket.ticket, subscriptions: [{swap_id: options.swapID, after_version: version}]}));
      socket.onmessage = (event) => {
        try {
          const frame = JSON.parse(String(event.data)) as Record<string, unknown>;
          if (frame.type === 'authenticated') { options.onStatus?.('connected'); return; }
          if (frame.type === 'reset_required' && frame.swap_id === options.swapID) { void reset().catch(() => undefined); return; }
          if (frame.type !== 'event' || frame.swap_id !== options.swapID) return;
          const parsed = parseSwapEvent(frame.payload);
          if (!parsed.snapshot || BigInt(parsed.event_version) <= BigInt(version)) return;
          if (BigInt(parsed.event_version) > BigInt(version) + BigInt(1)) { void reset().catch(() => undefined); return; }
          latest = newerSnapshot(latest, parsed.snapshot); version = parsed.event_version; options.onSnapshot(latest);
        } catch { void reset().catch(() => undefined); }
      };
      socket.onclose = (event) => { options.onStatus?.('disconnected'); reconnect(event.code === 4429 ? 5000 : 1000 + Math.floor(Math.random() * 500)); };
      socket.onerror = () => options.onStatus?.('error');
    } catch { options.onStatus?.('polling'); reconnect(2000 + Math.floor(Math.random() * 500)); }
  };
  void connect();
  return () => { stopped = true; if (retry) clearTimeout(retry); socket?.close(1000, 'component unmounted'); };
}
