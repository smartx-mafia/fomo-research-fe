/**
 * 从「一坨可能是回调 URL 的文本」里抠出 code / state / error。
 *
 * 存在的理由是一个**尚未证实的前提**：X 官方文档没有说明是否允许
 * `http://localhost` 作为 Callback URI。如果不允许，后端登记的 redirect_uri
 * 就只能指向别处，用户点完授权会落到一个 404 页面 —— 但**地址栏里那串
 * `?code=…&state=…` 是完整的**，把它整个粘回来照样能完成绑定。
 *
 * 所以这里刻意宽容，四种形态都吃：
 *   - 完整 URL：`https://app.example/x/callback?code=…&state=…`
 *   - 带 hash 的 URL（有中间页会把参数塞进 fragment）
 *   - 光一段 query：`?code=…&state=…`
 *   - 连问号都没有：`code=…&state=…`
 *
 * 不宽容的代价是具体的：解析不出来时页面只会说"没找到 code"，
 * 而人手里明明有一个看起来完全正确的 URL —— 那种自相矛盾最难查。
 */
export type XCallbackParams = {
  code?: string;
  state?: string;
  /** X 在用户点「取消」时带回来的错误，典型值 `access_denied`，**不带 code**。 */
  error?: string;
  errorDescription?: string;
};

/** 空串一律折成 undefined：`?code=` 这种形态解析出空串，当成"有 code"会直接送出去挨 100112。 */
function pick(sources: URLSearchParams[], key: string): string | undefined {
  for (const s of sources) {
    const v = s.get(key);
    if (v !== null && v.trim() !== '') return v.trim();
  }
  return undefined;
}

export function parseCallbackParams(input: string): XCallbackParams {
  const text = input.trim();
  if (!text) return {};

  // 按 ? 和 # 切开，取后面的每一段。两处都扫是因为只扫 query 的话，
  // 遇到 fragment 形态会得到"什么也没解析出来"，而那个症状与"粘错了 URL"
  // 无法区分。切完为空说明用户粘的就是光秃秃一段 query，整串当参数解。
  const parts = text.split(/[?#]/).slice(1).filter((p) => p !== '');
  const sources = (parts.length > 0 ? parts : [text]).map((p) => new URLSearchParams(p));

  return {
    code: pick(sources, 'code'),
    state: pick(sources, 'state'),
    error: pick(sources, 'error'),
    errorDescription: pick(sources, 'error_description'),
  };
}

/** 这串文本里有没有值得处理的东西（用来决定要不要弹回调面板）。 */
export function hasCallbackPayload(p: XCallbackParams): boolean {
  return p.code !== undefined || p.error !== undefined;
}
