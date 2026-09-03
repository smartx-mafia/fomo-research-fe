/**
 * Dev 专用自定义 server（node server.mjs，替代 `next dev`）。
 *
 * 为什么不用 `next dev`：浏览器行情 WS（/market-api/ws）需要满足两件事——
 * 1. 后端 WS 网关拒绝一切带 Origin 头的握手（403），转发时必须剥掉 Origin；
 * 2. Next 自己会往 server 挂 upgrade 监听器（HMR 用），与自建代理同时操作
 *    同一个 socket 会让浏览器立即断连——必须统一收编为单一分发器。
 * 这两件事 rewrite 配置都做不到，所以 dev 期用本文件（生产走基础设施代理）。
 *
 * 注意：本机若配了系统 HTTP 代理（scutil --proxy 可查），需用 localhost:3000
 * 访问（默认在代理例外清单里），或在代理里放行 127.0.0.1，否则浏览器 WS
 * 会被本地代理劫持。
 */
import { createServer } from "node:http";
import { connect as tcpConnect } from "node:net";
import next from "next";

const port = Number(process.env.PORT || 3000);
const app = next({ dev: true, hostname: "0.0.0.0", port });
await app.prepare();

const handle = app.getRequestHandler();
const upgradeHandler = app.getUpgradeHandler();

const WS_PREFIX = "/market-api/ws";
const target = new URL(process.env.NEXT_PUBLIC_MARKET_API_BASE || "http://13.52.177.63:8080");
const targetPort = Number(target.port || 80);

const server = createServer((req, res) => handle(req, res));

// Next 会晚于启动往 server 挂自己的 upgrade 监听器（HMR 用），时机不定。
// 覆写实例的 on()：此后任何代码注册的 upgrade 监听器都收进数组，不真正挂载，
// 从根上杜绝"Next 监听器与市场代理同时操作同一个 socket"导致的浏览器断连。
const capturedUpgradeListeners = [];
const origOn = server.on.bind(server);
server.on = (event, listener) => {
  if (event === "upgrade") {
    capturedUpgradeListeners.push(listener);
    return server;
  }
  return origOn(event, listener);
};

/** 市场代理路径：裸 TCP 手写握手转发（剥 Origin / 扩展协商），101 后双向管道。
 *  对已死连接的 write 会同步抛 ERR_STREAM_WRITE_AFTER_END——连接竞态下常见，
 *  必须包住，否则一个异常握手就打死整个 dev server。 */
const marketUpgrade = (req, socket, head) => {
  const rest = req.url.slice(WS_PREFIX.length);
  // /market-api/ws[?query] → 上游 /ws[?query]，不要尾斜杠（上游对 /ws/ 回 301）
  const path = "/ws" + (rest.startsWith("?") ? rest : rest.replace(/\/+$/, ""));

  // 只挑 WS 握手必需的头转发（Host 换成上游的），其余（Origin 等）一律不带
  const fwd = ["connection", "upgrade", "sec-websocket-version", "sec-websocket-key"];
  const lines = fwd.filter((k) => req.headers[k]).map((k) => `${k}: ${req.headers[k]}`);
  const handshake = `GET ${path} HTTP/1.1\r\nhost: ${target.host}\r\n${lines.join("\r\n")}\r\n\r\n`;

  const tryWrite = (s, data) => {
    try {
      s.write(data);
    } catch {
      s.destroy();
    }
  };

  const upstream = tcpConnect(targetPort, target.hostname);
  upstream.on("error", () => socket.destroy());
  upstream.on("connect", () => {
    tryWrite(upstream, handshake);
    if (head.length) tryWrite(upstream, head);
  });

  // 等上游 101 头完整到达后原样回给客户端并开始双向管道
  let buf = Buffer.alloc(0);
  const onData = (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    if (!buf.subarray(0, idx).toString("latin1").includes("101")) {
      tryWrite(socket, buf.subarray(0, idx + 4)); // 非 101（如 403）原样回传后关闭
      socket.destroy();
      upstream.destroy();
      return;
    }
    upstream.off("data", onData);
    tryWrite(socket, buf); // 101 头 + 已到的后续字节
    // upgrade 事件的 socket 是暂停态，不 resume 数据流不会动，客户端会断连重试
    socket.resume();
    upstream.pipe(socket);
    socket.pipe(upstream);
    socket.on("close", () => upstream.destroy());
    socket.on("error", () => upstream.destroy());
    upstream.on("close", () => socket.destroy());
    upstream.on("error", () => socket.destroy());
  };
  upstream.on("data", onData);
};

// 唯一真正的 upgrade 分发器（用 origOn 注册，绕过上面的覆写）
origOn("upgrade", (req, socket, head) => {
  if (req.url?.startsWith(WS_PREFIX)) {
    marketUpgrade(req, socket, head);
  } else {
    for (const fn of capturedUpgradeListeners) fn(req, socket, head);
  }
});

server.listen(port, () => {
  console.log(`> dev server (custom, WS Origin-stripping) on http://0.0.0.0:${port}`);
});
