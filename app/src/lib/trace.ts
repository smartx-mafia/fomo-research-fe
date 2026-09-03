/**
 * x-request-id 生成。契约见后端仓 docs/contracts/trace-id.md。
 *
 * 32 位小写 hex（16 字节加密随机数）。三条硬规则，违反的后果都不是报错
 * 而是**静默失效**：
 *   ① 每个请求生成一个新的 —— 复用会把所有请求在后端日志里挤成一条链路，
 *      比不传更糟；
 *   ② 不合法的值被后端静默丢弃（它另生成一个），判断是否生效的唯一办法
 *      是比对回包的 trace_id 与我们发出的值；
 *   ③ 不要往 ID 里塞业务信息，它会进后端每一条日志行。
 *
 * 自己生成而不是等后端给，是为了在**请求根本没到后端时**也有 ID 可报
 * （代理不通、预检被拦这两类失败本来是拿不到 trace_id 的）。
 */
export function newTraceID(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
