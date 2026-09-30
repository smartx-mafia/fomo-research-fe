'use client';

/**
 * 下单页的「观点」台：对自己的一个持仓发 / 改 / 删观点，看发布审查的真实结论。
 *
 * 与下单共用顶栏的环境开关、同一次 Privy 登录、同一份持仓（每秒自动拉）、同一个日志（浏览器控制台 [harness]）与
 * 错误面板 —— 所以它是一个台，不是另一个页面：验证「后台加了个词 → 发帖被拦 → 下线 → 放行」
 * 这件事，要的正是同一个账号、同一个环境、同一条日志。
 *
 * 被拦时右边一键「去敏感词台试判」：把这段正文原样带过去，看命中哪条规则、为什么。
 */
import {useEffect, useMemo, useRef, useState} from 'react';

import {ApiError, type Position} from './api';
import {
  blockedRuleOf,
  createOpinion,
  deleteOpinion,
  getOpinionByTarget,
  newIdempotencyKey,
  OPINION_BLOCKED,
  opinionTargetOf,
  updateOpinion,
  type Opinion,
} from './opinion';
import {Btn, Card, Info, Note} from './ui';

/** 与后端 social.MaxBodyWeight 同值：中文、日文假名、韩文按 2 计，其余按 1。 */
const MAX_BODY_WEIGHT = 280;

function bodyWeight(s: string): number {
  let w = 0;
  for (const ch of s) w += /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(ch) ? 2 : 1;
  return w;
}

type Outcome =
  | {kind: 'ok'; text: string}
  | {kind: 'blocked'; ruleID?: string; body: string}
  | null;

export function OpinionDesk({
  token,
  positions,
  busy,
  guard,
  say,
  onFetchPositions,
  onCheckText,
}: {
  token: string;
  positions: Position[] | null;
  busy: boolean;
  guard: (what: string, fn: () => Promise<void>) => Promise<void>;
  say: (text: string, bad?: boolean) => void;
  onFetchPositions: () => void;
  /** 把一段正文带去「敏感词」台试判。 */
  onCheckText: (text: string) => void;
}) {
  const [targetID, setTargetID] = useState('');
  // undefined = 还没读；null = 这个仓位上没有观点。
  const [opinion, setOpinion] = useState<Opinion | null | undefined>(undefined);
  const [body, setBody] = useState('');
  const [outcome, setOutcome] = useState<Outcome>(null);

  const rows = useMemo(
    () =>
      (positions ?? [])
        .filter((p) => p.shares_raw !== '0')
        .map((p) => ({p, target: opinionTargetOf(p)})),
    [positions],
  );

  const load = (tid: string) =>
    guard('读观点', async () => {
      const o = await getOpinionByTarget(token, tid);
      setOpinion(o);
      setBody(o?.latest_version.body ?? '');
      say(o ? `观点：读到 #${o.opinion_id} v${o.latest_version.version_no}` : '观点：这个仓位上还没有观点');
    });
  // App 的 guard 每次渲染都是新函数：effect 若依赖它就会每次渲染重读一遍（死循环）。
  // 经 ref 取最新的 load，effect 只随仓位与 token 变。
  const loadRef = useRef(load);
  loadRef.current = load;

  // 换仓位（或换账号 / 环境后 token 变了）= 重读那个仓位上的观点。
  useEffect(() => {
    setOutcome(null);
    setOpinion(undefined);
    if (targetID && token) void loadRef.current(targetID);
  }, [targetID, token]);

  const submit = () =>
    guard(opinion ? '改观点' : '发观点', async () => {
      setOutcome(null);
      // 每次提交一个新幂等键：同键重试回放的是首次结论，被拦过的键永远是被拦。
      const key = newIdempotencyKey();
      try {
        const r = opinion
          ? await updateOpinion(token, {
              opinionID: opinion.opinion_id,
              baseVersionID: opinion.latest_version.version_id,
              body,
              idempotencyKey: key,
            })
          : await createOpinion(token, {targetID, body, idempotencyKey: key});
        setOpinion(r.opinion);
        const text = `${opinion ? '已改' : '已发布'}：观点 #${r.opinion.opinion_id} v${r.opinion.latest_version.version_no}`;
        setOutcome({kind: 'ok', text});
        say(`观点 ${text}`);
      } catch (e) {
        if (e instanceof ApiError && e.code === OPINION_BLOCKED) {
          setOutcome({kind: 'blocked', ruleID: blockedRuleOf(e), body});
        }
        throw e; // 照常进日志与错误面板
      }
    });

  const remove = () =>
    guard('删观点', async () => {
      if (!opinion) return;
      await deleteOpinion(token, opinion.opinion_id);
      say(`观点：已删除 #${opinion.opinion_id}`);
      setOpinion(null);
      setBody('');
      setOutcome(null);
    });

  const weight = bodyWeight(body.trim());
  const canSubmit = Boolean(token && targetID && body.trim() && weight <= MAX_BODY_WEIGHT && opinion !== undefined);

  return (
    <>
      <Card
        title="观点"
        hero
        right={
          <>
            {positions && <span className="hint tight">可写观点的仓位 {rows.filter((r) => r.target).length} 个</span>}
            <Btn size="sm" disabled={busy || !token} onClick={onFetchPositions}>
              拉取持仓
            </Btn>
          </>
        }
      >
        {!token && <Note tone="warn">先在顶栏登录：观点写在当前账号的持仓上。</Note>}

        <div className="form">
          <div className="f">
            <label htmlFor="op-target">
              仓位<span className="u">只列还持有的；外部转入 / 周期未就绪的不能写</span>
            </label>
            <select
              id="op-target"
              className="inp"
              value={targetID}
              disabled={!token || rows.length === 0}
              onChange={(e) => setTargetID(e.target.value)}
            >
              <option value="">{rows.length === 0 ? '（没有持仓，先拉取）' : '选一个仓位'}</option>
              {rows.map(({p, target}) => (
                <option key={`${p.asset.chain_id}:${p.asset.token_address}`} value={target ?? ''} disabled={!target}>
                  {(p.symbol || p.asset.token_address.slice(0, 10)) + ` · ${p.asset.chain}`}
                  {target ? ` · 开仓分录 ${p.opened_entry_id}` : ' · 不能写观点'}
                </option>
              ))}
            </select>
          </div>

          <div className="f">
            <label htmlFor="op-body">
              正文
              <span className="u">
                加权 {weight} / {MAX_BODY_WEIGHT}（中日韩按 2 计）
                {opinion ? ` · 编辑 #${opinion.opinion_id} v${opinion.latest_version.version_no}，按当前词库重审全文` : ''}
              </span>
            </label>
            <textarea
              id="op-body"
              className="inp"
              rows={4}
              value={body}
              // 只在读取这个仓位的观点期间禁用：没选仓位（甚至没登录）也能写正文拿去「只试判不发」。
              disabled={Boolean(targetID) && opinion === undefined}
              placeholder="写点什么。要验审查就把探针词写进来"
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div className="row tight">
          <Btn variant="primary" busy={busy} disabled={busy || !canSubmit} onClick={() => void submit()}>
            {opinion ? '保存修改' : '发布'}
          </Btn>
          <Btn variant="ghost" disabled={busy || !targetID || !token} onClick={() => void load(targetID)}>
            读取
          </Btn>
          <Btn variant="ghost" disabled={busy || !body.trim()} onClick={() => onCheckText(body)} title="只判不发：带去「敏感词」台">
            只试判不发
          </Btn>
          {opinion && (
            <Btn variant="ghost" disabled={busy} onClick={() => void remove()} title="验完探针词后清理">
              删除这条观点
            </Btn>
          )}
        </div>

        {outcome?.kind === 'ok' && <Note tone="ok">{outcome.text}</Note>}
        {outcome?.kind === 'blocked' && (
          <Note tone="err">
            <b>发布审查拦下了</b>
            {outcome.ruleID ? (
              <>
                ，规则 <code className="code">{outcome.ruleID}</code>
                {outcome.ruleID.startsWith('dyn-') ? '（运营动态规则，「敏感词」台可下线）' : '（内嵌词库，随发版）'}
              </>
            ) : null}
            。
            <div className="row tight" style={{marginTop: 'var(--s2)'}}>
              <Btn size="sm" onClick={() => onCheckText(outcome.body)}>
                去「敏感词」台试判这段正文
              </Btn>
            </div>
          </Note>
        )}

        <Info label="说明 · 这张卡">
          <p className="hint">
            走的是真实发帖链路（<code className="code">POST /v1/social/opinions</code> /{' '}
            <code className="code">PUT /v1/social/opinions/{'{id}'}</code>），和 App 同一条：要登录、要已绑定邀请关系、
            仓位要真是你的。每次提交换一个新幂等键 —— 同键重试回放的是首次结论，被拦过的键永远是被拦。
          </p>
          <p className="hint tight">
            后台刚加 / 刚下线的规则：写入所在副本即时生效，其余副本最迟 30 秒。用 <code className="code">sx_moderationctl</code>{' '}
            在机上下线时，这里要等到 30 秒才放行 —— 那是设计内的传播窗口，不是没生效。
          </p>
        </Info>
      </Card>
    </>
  );
}
