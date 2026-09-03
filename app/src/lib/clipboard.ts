/**
 * 复制到剪贴板。**失败必须能被调用方看见。**
 *
 * navigator.clipboard 在非安全上下文里根本不存在。localhost 是安全上下文
 * 所以本机没事 —— 但一旦有人用 `npm run dev -- --host` 让同事从
 * http://13.52.177.63:7500 访问，这个 API 就消失了。静默失败的症状是
 * 「我点了复制，粘出来是上一次的东西」，而人会去怪粘贴那一端。
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 落到下面的兜底
  }
  // 兜底：非安全上下文下唯一还能用的路子。
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
