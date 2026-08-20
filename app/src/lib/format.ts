/** 格式化工具。所有函数对 null/undefined/NaN 一律返回占位符 "—"，渲染层不用再判空。 */

export const DASH = "—";

/** Mobula 部分端点返回字符串数字（holder-positions），统一转 number */
export function num(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 紧凑金额：$1.2M / $34.5K / $0.00 */
export function fmtUsd(v: unknown, opts: { compact?: boolean } = {}): string {
  const n = num(v);
  if (n === undefined) return DASH;
  const { compact = true } = opts;
  const abs = Math.abs(n);
  if (compact && abs >= 1000) return "$" + fmtCompact(n);
  if (abs === 0) return "$0";
  if (abs < 0.000001) return "$" + n.toExponential(2);
  if (abs < 1) return "$" + n.toPrecision(4).replace(/0+$/, "").replace(/\.$/, "");
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 价格：小数位按量级自适应，$0.00002751 这类小币不丢精度 */
export function fmtPrice(v: unknown): string {
  const n = num(v);
  if (n === undefined) return DASH;
  const abs = Math.abs(n);
  if (abs === 0) return "$0";
  if (abs < 1e-8) return "$" + n.toExponential(2);
  if (abs < 1) return "$" + n.toFixed(Math.min(12, Math.max(4, Math.ceil(-Math.log10(abs)) + 3)));
  if (abs < 1000) return "$" + n.toFixed(4);
  return "$" + fmtCompact(n);
}

/** 1234567 → 1.23M */
export function fmtCompact(v: unknown): string {
  const n = num(v);
  if (n === undefined) return DASH;
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return sign + (abs / 1e12).toFixed(2) + "T";
  if (abs >= 1e9) return sign + (abs / 1e9).toFixed(2) + "B";
  if (abs >= 1e6) return sign + (abs / 1e6).toFixed(2) + "M";
  if (abs >= 1e3) return sign + (abs / 1e3).toFixed(2) + "K";
  return sign + abs.toFixed(abs < 1 ? 4 : 2);
}

/** 整数计数：12,345 */
export function fmtInt(v: unknown): string {
  const n = num(v);
  if (n === undefined) return DASH;
  return Math.round(n).toLocaleString("en-US");
}

/** 百分比：+3.42% / -1.05%。已是百分数（Mobula 的 *Percentage / price_change_* 都是），不再乘 100 */
export function fmtPct(v: unknown, opts: { sign?: boolean; digits?: number } = {}): string {
  const n = num(v);
  if (n === undefined) return DASH;
  const { sign = true, digits = 2 } = opts;
  const s = n > 0 && sign ? "+" : "";
  return s + n.toFixed(digits) + "%";
}

/** 涨跌色 class */
export function pctColor(v: unknown): string {
  const n = num(v);
  if (n === undefined || n === 0) return "text-zinc-400";
  return n > 0 ? "text-emerald-400" : "text-rose-400";
}

/** 相对时间缩写：3s / 12m / 5h / 2d */
export function fmtAge(input: unknown): string {
  const t = toMs(input);
  if (t === undefined) return DASH;
  const diff = Date.now() - t;
  if (diff < 0) return "0s";
  const s = Math.floor(diff / 1000);
  if (s < 60) return s + "s";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h";
  const d = Math.floor(h / 24);
  if (d < 365) return d + "d";
  return Math.floor(d / 365) + "y";
}

/** 本地时间：08-20 14:03:22 */
export function fmtTime(input: unknown): string {
  const t = toMs(input);
  if (t === undefined) return DASH;
  const d = new Date(t);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** ISO 字符串 / 秒 / 毫秒 → 毫秒时间戳 */
export function toMs(input: unknown): number | undefined {
  if (input === null || input === undefined || input === "") return undefined;
  if (typeof input === "number") return input < 1e12 ? input * 1000 : input;
  if (typeof input === "string") {
    const asNum = Number(input);
    if (Number.isFinite(asNum) && input.trim() !== "") return asNum < 1e12 ? asNum * 1000 : asNum;
    const t = Date.parse(input);
    return Number.isFinite(t) ? t : undefined;
  }
  return undefined;
}

/** 0xabcd…1234 */
export function shortAddr(a: unknown, head = 4, tail = 4): string {
  if (typeof a !== "string" || !a) return DASH;
  if (a.length <= head + tail + 2) return a;
  return `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** "evm:56" → "BNB"，用于链徽标 */
export const CHAIN_LABEL: Record<string, string> = {
  "solana:solana": "SOL",
  "evm:1": "ETH",
  "evm:56": "BNB",
  "evm:8453": "BASE",
  "evm:143": "MONAD",
  "evm:1337": "HYPE",
  "evm:4663": "RH",
};

export function chainLabel(id: unknown): string {
  if (typeof id !== "string") return DASH;
  return CHAIN_LABEL[id] ?? id;
}

/** URL 路径用的链短名（/token/[chain]/[address]） */
export function chainToSlug(id: unknown): string {
  if (typeof id !== "string") return "unknown";
  return id.replace(":", "_");
}

export function slugToChain(slug: string): string {
  return slug.replace("_", ":");
}
