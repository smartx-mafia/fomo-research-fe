'use client';

/**
 * 内容审查控制台（`/dev/moderation`）：运营动态词库的试算、增删与统计。
 *
 * 版式参考 noblack 的 Web 控制台（检测 / 词库管理 / 统计三个页签），代码是按本仓契约重写的
 * （noblack 是 AGPL-3.0，只借鉴布局与交互，不搬代码）。与 noblack 的语义差别，都是后端的硬约束：
 * - **没有「改」**：事件表只追加。改错了 = 下线那条再加一条（新 ID）；
 * - **没有「删」只有「下线」**：下线只让规则失效，历史拦截的归因照样能复原；
 * - **检测页是「词条试算」而不是「整段文本检测」**：后端只提供「这个词加进去会怎样」的试算，
 *   结论与提交时同一套校验（语料、作者闸、重复、上限）。
 *
 * 接口：后端仓 docs/contracts/admin.md §10。所有失败走 describeError（拒绝原因 → 建议动作）。
 */
import {useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode} from 'react';
import {
  LOCALES,
  REASON_TEXT,
  addRule,
  describeError,
  getStatus,
  getToken,
  listRules,
  login,
  previewRule,
  retireRule,
  setToken,
  type ModerationRule,
  type ModerationStatus,
  type Preview,
  type RuleList,
} from '@/api/admin-moderation';
import {ApiError} from '@/api/envelope';

type Tab = 'check' | 'words' | 'stats';
type Toast = {kind: 'ok' | 'err'; text: string} | null;

const PAGE_SIZE = 50;

export default function ModerationConsole() {
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<Tab>('check');
  const [toast, setToast] = useState<Toast>(null);
  // 试算页「用这些样本作为证据加入」→ 预填词库页的新增表单。
  const [draft, setDraft] = useState<{locale: string; term: string; evidence: string} | null>(null);

  useEffect(() => setAuthed(Boolean(getToken())), []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(id);
  }, [toast]);

  const fail = useCallback((e: unknown) => {
    // 会话失效：客户端已清 token，这里把页面切回登录。
    if (e instanceof ApiError && e.code === 400700) setAuthed(false);
    setToast({kind: 'err', text: describeError(e)});
  }, []);
  const ok = useCallback((text: string) => setToast({kind: 'ok', text}), []);

  if (!authed) return <LoginCard onDone={() => setAuthed(true)} onError={fail} toast={toast} />;

  return (
    <div className="mx-auto w-full max-w-6xl p-6 text-sm text-foreground">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">🛡️ 内容审查控制台</h1>
        <button
          className="rounded border border-border px-3 py-1 text-muted hover:text-foreground"
          onClick={() => {
            setToken('');
            setAuthed(false);
          }}
        >
          退出
        </button>
      </div>
      <div className="mb-4 flex gap-1 border-b border-border">
        {(
          [
            ['check', '🔍 词条试算'],
            ['words', '📚 词库管理'],
            ['stats', '📊 统计'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-4 py-2 ${tab === key ? 'border-accent text-foreground' : 'border-transparent text-muted hover:text-foreground'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'check' && (
        <CheckPanel
          onError={fail}
          onUseAsDraft={(d) => {
            setDraft(d);
            setTab('words');
          }}
        />
      )}
      {tab === 'words' && <WordsPanel draft={draft} onError={fail} onOk={ok} />}
      {tab === 'stats' && <StatsPanel onError={fail} />}
      <ToastView toast={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function LoginCard({onDone, onError, toast}: {onDone: () => void; onError: (e: unknown) => void; toast: Toast}) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username.trim(), password);
      onDone();
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto mt-24 w-full max-w-sm p-6 text-sm">
      <Card title="🛡️ 内容审查控制台 · 管理员登录">
        <p className="mb-3 text-xs text-muted">
          使用管理后台（sx_admin）的管理员账号；需要权限点 moderation:read，增删需要 moderation:write。
          会话只存在本标签页。
        </p>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Field label="用户名">
            <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </Field>
          <Field label="口令">
            <input
              className={inputCls}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <button className={primaryBtn} disabled={busy || !username || !password}>
            {busy ? '登录中…' : '登录'}
          </button>
        </form>
      </Card>
      <ToastView toast={toast} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function CheckPanel({
  onError,
  onUseAsDraft,
}: {
  onError: (e: unknown) => void;
  onUseAsDraft: (d: {locale: string; term: string; evidence: string}) => void;
}) {
  const [locale, setLocale] = useState<string>('zh');
  const [term, setTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Preview | null>(null);

  // 只在显式点击时试算（契约要求前端去抖、不随输入实时调用：每次试算都要取最近观点样本）。
  const run = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      setResult(await previewRule(locale, term));
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Card title="词条试算">
        <p className="mb-3 text-xs text-muted">
          看一个词「此刻提交」会得到什么结论：规范化后实际生效的词、匹配方式，以及重复、误杀语料、最近观点作者闸、上限四项校验。只读，不写任何表。
        </p>
        <form onSubmit={run} className="flex flex-wrap items-end gap-3">
          <Field label="语言">
            <LocaleSelect value={locale} onChange={setLocale} />
          </Field>
          <Field label="词条" grow>
            <input className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} placeholder="要拦的词或话术" />
          </Field>
          <button className={primaryBtn} disabled={busy || !term.trim()}>
            {busy ? '试算中…' : '试算'}
          </button>
        </form>
      </Card>
      {result && (
        <Card title={result.rejections.length === 0 ? '✅ 可以加入' : '⛔ 提交会被拒'}>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBox label="实际生效的词" value={result.term} />
            <StatBox label="匹配方式" value={result.match_type === 'word' ? '整词（word）' : '包含（contains）'} />
            <StatBox label="命中作者 / 样本" value={`${result.authors} / ${result.sample_size}`} />
            <StatBox label="24h 累计命中作者" value={String(result.cumulative_authors)} />
          </div>
          {result.insufficient_sample && (
            <p className="mb-2 text-xs text-muted">⚠ 当前环境没有任何最近观点，作者闸没有判别力。</p>
          )}
          {result.rejections.length > 0 && (
            <ul className="mb-3 list-disc pl-5">
              {result.rejections.map((r) => (
                <li key={r} className="text-down">
                  {REASON_TEXT[r] ?? r} <span className="text-xs text-muted">({r})</span>
                </li>
              ))}
            </ul>
          )}
          {result.sample_opinion_ids.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-muted">命中的观点 id：</span>
              {result.sample_opinion_ids.map((id) => (
                <code key={id} className="rounded bg-surface-2 px-1.5 py-0.5">
                  {id}
                </code>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-2">
            <button
              className={ghostBtn}
              onClick={() => onUseAsDraft({locale, term, evidence: result.sample_opinion_ids.join(',')})}
            >
              {result.sample_opinion_ids.length > 0 ? '以这些观点为证据去加入 →' : '去加入 →'}
            </button>
          </div>
          {result.sample_opinion_ids.length > 0 && (
            <p className="mt-2 text-xs text-muted">
              证据观点连同其作者不计入作者闸：只在确认它们是同一波刷屏时使用，泛用词不要这样绕过。
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function WordsPanel({
  draft,
  onError,
  onOk,
}: {
  draft: {locale: string; term: string; evidence: string} | null;
  onError: (e: unknown) => void;
  onOk: (t: string) => void;
}) {
  const [locale, setLocale] = useState(draft?.locale ?? 'zh');
  const [term, setTerm] = useState(draft?.term ?? '');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState(draft?.evidence ?? '');
  const [saving, setSaving] = useState(false);

  const [page, setPage] = useState(1);
  const [ruleID, setRuleID] = useState('');
  const [includeRetired, setIncludeRetired] = useState(false);
  const [list, setList] = useState<RuleList | null>(null);
  const [loading, setLoading] = useState(false);
  const [retiring, setRetiring] = useState<{id: string; reason: string} | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setList(await listRules({page, size: PAGE_SIZE, ruleID: ruleID.trim(), includeRetired}));
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [page, ruleID, includeRetired, onError]);

  useEffect(() => {
    void load();
    // 只在翻页与勾选变化时自动刷新；rule_id 过滤按「查询」提交。
  }, [page, includeRetired]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const ids = evidence
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const r = await addRule({locale, term, reason, evidence_opinion_ids: ids});
      onOk(
        (r.changed ? `已加入 ${r.rule_id}，各副本 30 秒内生效` : `${r.rule_id} 已存在（同一请求重试，未重复写入）`) +
          (r.insufficient_sample ? '。注意：当前环境没有最近观点，作者闸未起作用' : ''),
      );
      setTerm('');
      setReason('');
      setEvidence('');
      setPage(1);
      await load();
    } catch (err) {
      onError(err);
    } finally {
      setSaving(false);
    }
  };

  const confirmRetire = async () => {
    if (!retiring) return;
    try {
      const r = await retireRule(retiring.id, retiring.reason);
      onOk(r.changed ? `已下线 ${retiring.id}` : `${retiring.id} 早已下线`);
      setRetiring(null);
      await load();
    } catch (e) {
      onError(e);
    }
  };

  const pages = list ? Math.max(1, Math.ceil(list.page.total / PAGE_SIZE)) : 1;

  return (
    <div className="flex flex-col gap-4">
      <Card title="➕ 新增动态规则">
        <p className="mb-3 text-xs text-muted">
          写入后本副本即时生效、其余副本 30 秒内追平。只能加、不能改：写错了就下线再加一条。匹配方式由服务端推导（纯英文数字整词匹配，其余包含匹配）。
        </p>
        <form onSubmit={save} className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="语言">
              <LocaleSelect value={locale} onChange={setLocale} />
            </Field>
            <Field label="词条" grow>
              <input className={inputCls} value={term} onChange={(e) => setTerm(e.target.value)} maxLength={256} />
            </Field>
          </div>
          <Field label="理由（必填，≤ 500 字，进事件表与审计）">
            <input className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <Field label="证据观点 id（可选，≤ 5 个，逗号分隔；这些观点及其作者不计入作者闸）">
            <input className={inputCls} value={evidence} onChange={(e) => setEvidence(e.target.value)} />
          </Field>
          <div className="flex gap-2">
            <button className={primaryBtn} disabled={saving || !term.trim() || !reason.trim()}>
              {saving ? '提交中…' : '加入'}
            </button>
            <button
              type="button"
              className={ghostBtn}
              onClick={() => {
                setTerm('');
                setReason('');
                setEvidence('');
              }}
            >
              清空
            </button>
          </div>
        </form>
      </Card>

      <Card
        title={`词库列表（${list ? list.page.total : '…'}）`}
        extra={
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={`${inputCls} w-36`}
              placeholder="rule_id，如 dyn-12"
              value={ruleID}
              onChange={(e) => setRuleID(e.target.value)}
            />
            <button
              className={ghostBtn}
              onClick={() => {
                setPage(1);
                void load();
              }}
            >
              查询
            </button>
            <label className="flex items-center gap-1 text-xs text-muted">
              <input type="checkbox" checked={includeRetired} onChange={(e) => setIncludeRetired(e.target.checked)} />
              含已下线
            </label>
            <button className={ghostBtn} onClick={() => void load()} disabled={loading}>
              ↻ 刷新
            </button>
          </div>
        }
      >
        {list && !list.counts_available && (
          <p className="mb-2 text-xs text-muted">⚠ 拦截统计暂时取不到，下表的拦截数为空不代表零次。</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="py-2 pr-3">rule_id</th>
                <th className="pr-3">语言</th>
                <th className="pr-3">匹配</th>
                <th className="pr-3">词条</th>
                <th className="pr-3">理由 / 操作人</th>
                <th className="pr-3">加入时间</th>
                <th className="pr-3">拦截 24h / 累计 / 24h 作者</th>
                <th className="pr-3">状态</th>
                <th className="w-40">操作</th>
              </tr>
            </thead>
            <tbody>
              {list?.items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-muted">
                    没有动态规则
                  </td>
                </tr>
              )}
              {list?.items.map((r) => (
                <RuleRow
                  key={r.rule_id}
                  rule={r}
                  countsAvailable={list.counts_available}
                  retiring={retiring?.id === r.rule_id ? retiring : null}
                  onStartRetire={() => setRetiring({id: r.rule_id, reason: ''})}
                  onRetireReason={(reason) => setRetiring({id: r.rule_id, reason})}
                  onCancel={() => setRetiring(null)}
                  onConfirm={confirmRetire}
                />
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex items-center justify-end gap-2 text-xs text-muted">
          <button className={ghostBtn} disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            {page} / {pages}
          </span>
          <button className={ghostBtn} disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      </Card>
    </div>
  );
}

function RuleRow({
  rule: r,
  countsAvailable,
  retiring,
  onStartRetire,
  onRetireReason,
  onCancel,
  onConfirm,
}: {
  rule: ModerationRule;
  countsAvailable: boolean;
  retiring: {id: string; reason: string} | null;
  onStartRetire: () => void;
  onRetireReason: (r: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <tr className={`border-b border-border align-top ${r.retired ? 'opacity-50' : ''}`}>
      <td className="py-2 pr-3 font-mono">{r.rule_id}</td>
      <td className="pr-3">{r.locale}</td>
      <td className="pr-3">{r.match_type}</td>
      <td className="pr-3">
        <div className="font-medium">{r.term}</div>
        {r.term_raw !== r.term && <div className="text-muted">原文：{r.term_raw}</div>}
      </td>
      <td className="pr-3">
        <div>{r.reason}</div>
        <div className="text-muted">{r.actor}</div>
      </td>
      <td className="pr-3 text-muted">{fmtTime(r.created_at)}</td>
      <td className="pr-3">
        {countsAvailable ? `${r.counts.last_24h} / ${r.counts.total} / ${r.counts.authors_24h}` : '—'}
      </td>
      <td className="pr-3">
        {r.retired ? (
          <div>
            <div className="text-muted">已下线</div>
            <div className="text-muted">
              {fmtTime(r.retired_at)} · {r.retired_by}
            </div>
            <div className="text-muted">{r.retire_reason}</div>
          </div>
        ) : (
          <span className="text-up">生效中</span>
        )}
      </td>
      <td>
        {!r.retired &&
          (retiring ? (
            <div className="flex flex-col gap-1">
              <input
                className={inputCls}
                placeholder="下线理由（必填）"
                value={retiring.reason}
                onChange={(e) => onRetireReason(e.target.value)}
                autoFocus
              />
              <div className="flex gap-1">
                <button className={dangerBtn} disabled={!retiring.reason.trim()} onClick={onConfirm}>
                  确认下线
                </button>
                <button className={ghostBtn} onClick={onCancel}>
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button className={dangerBtn} onClick={onStartRetire}>
              下线
            </button>
          ))}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------

function StatsPanel({onError}: {onError: (e: unknown) => void}) {
  const [status, setStatus] = useState<ModerationStatus | null>(null);
  const [top, setTop] = useState<ModerationRule[] | null>(null);
  const [countsAvailable, setCountsAvailable] = useState(true);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, l] = await Promise.all([getStatus(), listRules({page: 1, size: 200})]);
      setStatus(s);
      setCountsAvailable(l.counts_available);
      setTop(
        [...l.items]
          .filter((r) => r.counts.last_24h > 0)
          .sort((a, b) => b.counts.last_24h - a.counts.last_24h)
          .slice(0, 20),
      );
    } catch (e) {
      onError(e);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  const blocks = status?.blocks_24h ?? {};
  const lag = useMemo(
    () => (status ? status.db_revision - status.applied_revision : 0),
    [status],
  );

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="运行状态"
        extra={
          <button className={ghostBtn} onClick={() => void load()} disabled={loading}>
            ↻ 刷新
          </button>
        }
      >
        {status && (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBox label="内嵌词库" value={`${status.embedded_version} · ${status.embedded_rules} 条`} />
            <StatBox label="有效动态规则 / 上限" value={`${status.active_dynamic} / ${status.cap}`} />
            <StatBox label="库上修订号" value={String(status.db_revision)} />
            <StatBox
              label="本副本修订号"
              value={String(status.applied_revision)}
              hint={lag > 0 ? `落后 ${lag}（30 秒内追平）` : '已追平'}
            />
            <StatBox label="本副本词库版本" value={status.rule_set_version} />
            <StatBox label="最近确认" value={status.last_confirmed_at ? fmtTime(status.last_confirmed_at) : '待刷新'} />
            <StatBox
              label="24h 拦截：内嵌 / 动态 / 云"
              value={
                status.blocks_available
                  ? `${blocks.embedded ?? 0} / ${blocks.dynamic ?? 0} / ${blocks.cloud ?? 0}`
                  : '取不到'
              }
            />
          </div>
        )}
        <p className="mt-3 text-xs text-muted">多副本部署时「本副本」是应答这次请求的那一个；按 exact / gap 的拆分只在指标里。</p>
      </Card>
      <Card title="🔥 近 24 小时拦截最多的动态规则">
        {!countsAvailable && <p className="text-xs text-muted">⚠ 拦截统计暂时取不到。</p>}
        {countsAvailable && top && top.length === 0 && <p className="text-xs text-muted">近 24 小时没有动态规则拦截记录。</p>}
        {countsAvailable && top && top.length > 0 && (
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr className="border-b border-border">
                <th className="w-10 py-2">#</th>
                <th>rule_id</th>
                <th>词条</th>
                <th>24h 拦截</th>
                <th>24h 作者</th>
                <th>累计</th>
              </tr>
            </thead>
            <tbody>
              {top.map((r, i) => (
                <tr key={r.rule_id} className="border-b border-border">
                  <td className="py-2">{i + 1}</td>
                  <td className="font-mono">{r.rule_id}</td>
                  <td>{r.term}</td>
                  <td>{r.counts.last_24h}</td>
                  <td>{r.counts.authors_24h}</td>
                  <td>{r.counts.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-xs text-muted">只统计最新 200 条有效动态规则；内嵌规则的拦截数见上方合计。</p>
      </Card>
    </div>
  );
}

// ---- 小部件 ----

const inputCls =
  'w-full rounded border border-border bg-background px-2 py-1.5 text-sm outline-none focus:border-accent';
const primaryBtn = 'rounded bg-accent px-4 py-1.5 text-white disabled:opacity-40';
const ghostBtn = 'rounded border border-border px-3 py-1 text-xs hover:bg-surface-2 disabled:opacity-40';
const dangerBtn = 'rounded border border-down px-3 py-1 text-xs text-down hover:bg-down/10 disabled:opacity-40';

function Card({title, extra, children}: {title: string; extra?: ReactNode; children: ReactNode}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}

function Field({label, grow, children}: {label: string; grow?: boolean; children: ReactNode}) {
  return (
    <label className={`flex flex-col gap-1 ${grow ? 'min-w-60 flex-1' : ''}`}>
      <span className="text-xs text-muted">{label}</span>
      {children}
    </label>
  );
}

function LocaleSelect({value, onChange}: {value: string; onChange: (v: string) => void}) {
  return (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      {LOCALES.map((l) => (
        <option key={l} value={l}>
          {l}
        </option>
      ))}
    </select>
  );
}

function StatBox({label, value, hint}: {label: string; value: string; hint?: string}) {
  return (
    <div className="rounded border border-border bg-surface-2 p-3">
      <div className="break-all text-base font-semibold">{value || '—'}</div>
      <div className="text-xs text-muted">{label}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
    </div>
  );
}

function ToastView({toast}: {toast: Toast}) {
  if (!toast) return null;
  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded border px-4 py-2 text-sm shadow-lg ${
        toast.kind === 'ok' ? 'border-up bg-surface text-up' : 'border-down bg-surface text-down'
      }`}
    >
      {toast.text}
    </div>
  );
}

function fmtTime(s: string): string {
  if (!s) return '';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleString();
}
