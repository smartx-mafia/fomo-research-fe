// 选币面板：按链列出候选标的，点一行把地址填进表单。**它只填地址，不改别的**。
//
// # 为什么需要它
//
// 这个台子上每试一笔都要先去别处找一个地址贴进来，而「别处」通常是另一个
// 行情站——链一换就要重新找一遍，找错链的后果是 430611「结算方拒绝且没给码」
//（`SwapPanel.tsx` 里 `addressFitsChain` 那段注释记着 2026-09-18 的那一次）。
//
// # 为什么会有两个来源，而且要写在脸上
//
// 后端五榜是跨链混合的聚合榜，**行情域与交易域的链登记表是两张**：2026-09-20
// 实测 arc 在交易域已经开了，行情域却回 `100305 chain unknown`，五榜里 arc
// 零条。于是「能下单的链列不出候选」——恰恰是最需要候选的时候。榜单为空时
// 回退到 GeckoTerminal 的链上池子榜，并在标题上写明这一行是从哪来的：两个源
// 口径不同（一个清洗过、一个是原始池子聚合），混着看会得出错的结论。

'use client';

import {useCallback, useEffect, useRef, useState} from 'react';

import type {Chain} from '../chains';
import {filterTokens, loadTokenOptions, type TokenOption, type TokenSource} from '../tokenlist';
import {Badge, Btn, Note} from '../ui';

/** 列表最多铺这么多行。再多就该用搜索，而不是滚十分钟。 */
const MAX_ROWS = 60;

function usd(v: number | null): string {
  if (v === null) return '—';
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

function short(addr: string): string {
  return addr.length <= 14 ? addr : `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

const SOURCE_LABEL: Record<TokenSource, string> = {
  board: '后端五榜',
  gecko: 'GeckoTerminal 池子榜',
};

export function TokenPicker({
  chain,
  token,
  onPick,
}: {
  chain: Chain;
  /** 本站 JWT。榜单的鉴权是可选的，但**坏 token 不会降级成匿名**（见 `api.ts`）。 */
  token: string | null;
  onPick: (address: string) => void;
}) {
  const [rows, setRows] = useState<TokenOption[] | null>(null);
  const [source, setSource] = useState<TokenSource | null>(null);
  /** 榜单那侧出了什么事。回退时它是这块面板上唯一能指回真因的东西。 */
  const [issue, setIssue] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  // 链一换就把上一条链的结果作废：慢回来的那一发会把别的链的币铺在这条链下面，
  // 而那些地址在这条链上一个都下不了单。
  const seq = useRef(0);

  const load = useCallback(
    async (forced: TokenSource | null) => {
      const mine = ++seq.current;
      setBusy(true);
      setErr(null);
      try {
        // 榜单空掉与榜单拉不到**都会自动回退**，原因由 boardIssue 带回来
        //（判据与理由见 `tokenlist.ts` 的 loadTokenOptions）。
        const got = await loadTokenOptions(token, chain, forced);
        if (mine !== seq.current) return;
        setRows(got.rows);
        setSource(got.source);
        setIssue(got.boardIssue);
      } catch (e) {
        if (mine !== seq.current) return;
        setRows([]);
        setSource(null);
        setIssue(null);
        setErr(e instanceof Error ? e.message : String(e));
      } finally {
        if (mine === seq.current) setBusy(false);
      }
    },
    [chain, token],
  );

  useEffect(() => {
    setRows(null);
    setSource(null);
    setIssue(null);
    setQ('');
    void load(null);
  }, [load]);

  const shown = rows ? filterTokens(rows, q).slice(0, MAX_ROWS) : [];
  const total = rows ? filterTokens(rows, q).length : 0;

  return (
    <div className="pick">
      <div className="row tight" style={{justifyContent: 'space-between'}}>
        <div className="row tight">
          <Badge kind={busy ? 'live' : err ? 'err' : rows?.length ? 'ok' : 'off'}>
            {busy ? '取候选中' : err ? '取不到' : rows === null ? '未取' : `${rows.length} 个候选`}
          </Badge>
          <span className="hint tight">
            {chain}
            {source ? ` · 来源：${SOURCE_LABEL[source]}` : ''}
          </span>
        </div>
        <div className="row tight">
          <Btn size="sm" variant="ghost" busy={busy} disabled={busy} onClick={() => void load(null)}>
            重取
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            busy={busy}
            disabled={busy || source === 'gecko'}
            title="跳过后端榜单，直接问 GeckoTerminal"
            onClick={() => void load('gecko')}
          >
            换链上池子榜
          </Btn>
        </div>
      </div>

      <input
        className="inp"
        value={q}
        placeholder="按符号或地址过滤"
        aria-label="过滤候选标的"
        onChange={(e) => setQ(e.target.value)}
      />

      {err && <Note tone="err">{err}</Note>}
      {!err && issue && <Note tone="warn">已回退到链上池子榜：{issue}</Note>}
      {!err && rows !== null && rows.length === 0 && !busy && (
        <Note tone="warn">
          这条链上一个候选都没取到。后端五榜是跨链混合榜（没有按链的变体），
          而链上池子榜那侧也没回内容 —— 直接把地址粘进上面的输入框即可。
        </Note>
      )}

      {shown.length > 0 && (
        <ul className="picklist">
          {shown.map((r) => (
            <li key={r.address}>
              <button type="button" className="pickrow" onClick={() => onPick(r.address)} title={r.address}>
                <span className="psym">{r.symbol}</span>
                <code className="code">{short(r.address)}</code>
                <span className="pnum">流动性 {usd(r.liquidityUsd)}</span>
                <span className="pnum">24h {usd(r.volume24hUsd)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {total > shown.length && (
        <p className="hint tight">还有 {total - shown.length} 个没铺出来 —— 用上面的框过滤。</p>
      )}

      {/* 两个源的量都是**未经刷量清洗**的原始值（后端契约里明写，GeckoTerminal
          同样）。流动性接近零而成交量上百万的行是这个台子上最容易踩的坑，所以
          两个数并排放，让它们自己说话。 */}
      <p className="hint tight">
        成交量未做刷量清洗；流动性接近零而量很大的标的下单多半只会回错误码。
      </p>

    </div>
  );
}
