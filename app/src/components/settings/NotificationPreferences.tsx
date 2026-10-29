'use client';

import {useRef, useState} from 'react';
import useSWR from 'swr';
import {ApiError} from '@/api/envelope';
import {getNotificationSettings, getNotificationPeople, setNotificationToggle, setMinimumTradeUSD, setPersonNotifications,
  type NotificationToggle, type NotificationPerson} from '@/api/settings';
import {ErrorPanel} from '@/components/ErrorPanel';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import {ToggleRow} from './ToggleRow';

const switches: {key: NotificationToggle; label: string; desc: string}[] = [
  {key: 'push', label: '通知总开关', desc: '控制新站内通知与系统推送；关闭不会删除历史通知。'},
  {key: 'following', label: 'Friends 动态', desc: '你关注的平台用户与聪明钱共用此设置。'},
  {key: 'friend_trades', label: 'Friends 买卖', desc: '买入和卖出共用额度：每小时 3 次、每天 10 次。'},
  {key: 'friend_opinions', label: 'Friends 观点', desc: '关注的人发布新观点时通知。'},
  {key: 'new_followers', label: '新增关注者', desc: '有人关注你时通知。'},
  {key: 'deposits_withdrawals', label: '充值与提现', desc: '接收资金到账、提现结果等通知。'},
  {key: 'announcements', label: '公告', desc: '接收平台公告。'},
];

export function validNotificationMinimum(value: string): boolean {
  if (!/^\d{1,10}(\.\d{1,6})?$/.test(value)) return false;
  const [whole, fraction = ''] = value.split('.');
  const micros = BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  return micros >= 1000000n && micros <= 1000000000000000n;
}

export function NotificationPreferences({bearer}: {bearer: string}) {
  const settings = useSWR(['notification-settings', bearer], () => getNotificationSettings(bearer));
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const people = useSWR(['notification-people', bearer, query, page], () => getNotificationPeople(bearer, query, page));
  const [amount, setAmount] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [saved, setSaved] = useState('');
  const values = settings.data?.data;
  const minimum = amount ?? values?.minimum_trade_usd ?? '';

  async function save(action: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setSaved('');
    try { await action(); setSaved('已保存'); }
    catch (e) { setError(e as ApiError); }
    finally { locked.current = false; setBusy(false); }
  }
  function togglePerson(person: NotificationPerson, key: 'trades' | 'opinions') {
    void save(async () => {
      const result = await setPersonNotifications(bearer, person.target, {[key]: !person[key]});
      if (result.data.matched < 1) {
        await people.mutate();
        throw new ApiError('business', 0, '关注关系已变化，请刷新列表后重试。');
      }
      await people.mutate();
    });
  }

  return <div className="space-y-4">
    <Card><CardHeader><CardTitle>通知偏好</CardTitle></CardHeader><CardContent>
      {settings.isLoading && <p role="status">正在加载通知设置…</p>}
      {settings.error && <><ErrorPanel err={settings.error} /><Button onClick={() => void settings.mutate()}>重试设置</Button></>}
      {values && <>
        <div className="divide-y divide-border">{switches.map(({key, label, desc}) => <ToggleRow key={key} label={label} desc={desc}
          checked={!!values[key]} disabled={busy || settings.isValidating}
          onToggle={(enabled) => void save(async () => {
            const result = await setNotificationToggle(bearer, key, enabled);
            await settings.mutate(result, false);
          })} />)}</div>
        {!values.push && <p className="my-3 text-sm text-amber-500">通知已暂停。下方分类和逐人选择会保留，重新开启后只接收符合条件的新事件。</p>}
        {!values.following && <p className="my-3 text-sm text-muted-foreground">Friends 动态已暂停，交易和观点选择已保留。</p>}
        <form className="mt-4 space-y-2" onSubmit={e => {e.preventDefault(); if (!validNotificationMinimum(minimum)) return; void save(async () => {
          const result = await setMinimumTradeUSD(bearer, minimum);
          await settings.mutate(result, false); setAmount(null);
        });}}>
          <label className="block text-sm" htmlFor="notification-minimum">最低交易金额（USD）</label>
          <div className="flex gap-2"><input id="notification-minimum" inputMode="decimal" value={minimum} disabled={busy}
            onChange={e => setAmount(e.target.value)} className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2" />
            <Button type="submit" disabled={busy || !validNotificationMinimum(minimum)}>保存金额</Button></div>
          <p className="text-xs text-muted-foreground">平台好友与聪明钱共用，范围 1–1,000,000,000 USD，最多 6 位小数。</p>
          {!validNotificationMinimum(minimum) && <p role="alert" className="text-sm text-destructive">请输入范围内的有效金额。</p>}
        </form>
      </>}
    </CardContent></Card>

    <Card><CardHeader><CardTitle>逐人通知</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-xs text-muted-foreground">选择哪些好友和聪明钱的交易、观点需要通知。关闭上级开关不会清空这些选择。</p>
      <form className="flex gap-2" onSubmit={e => {e.preventDefault(); setQuery(search.trim()); setPage(1);}}>
        <input aria-label="搜索关注的人" placeholder="搜索名称或用户名" value={search} onChange={e => setSearch(e.target.value)} disabled={busy}
          className="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2" />
        <Button type="submit" disabled={busy}>搜索</Button>
      </form>
      {people.isLoading && <p role="status">正在加载关注列表…</p>}
      {people.error && <><ErrorPanel err={people.error} /><Button onClick={() => void people.mutate()}>重试列表</Button></>}
      {people.data && (people.data.data.people ?? []).length === 0 && <p className="text-sm text-muted-foreground">没有匹配的关注对象。</p>}
      {(people.data?.data.people ?? []).map(person => <div key={`${person.target.type}:${person.target.id}`} className="rounded border border-border p-3">
        <div className="flex items-center gap-3">
          {person.avatar_url.startsWith('https://') && <img src={person.avatar_url} alt="" className="size-10 rounded-full object-cover" />}
          <div className="min-w-0"><p className="break-words font-medium">{person.remark || person.display_name || person.username || person.target.id}</p>
            <p className="text-xs text-muted-foreground">{person.target.type === 'user' ? '平台好友' : person.target.type === 'smart_money_user' ? '聪明钱' : '钱包地址'}</p></div>
        </div>
        {person.target.type === 'smart_money' ? <p className="mt-2 text-xs text-muted-foreground">交易通知仅支持用户级关注，请关注对应的聪明钱主体。</p> :
          <ToggleRow label="交易通知" checked={person.trades} disabled={busy || people.isValidating || !!people.error || !values}
            desc={!values?.push || !values?.following || !values?.friend_trades ? '上级开关已暂停；保存的选择不变。' : undefined}
            onToggle={() => togglePerson(person, 'trades')} />}
        <ToggleRow label="观点通知" checked={person.opinions} disabled={busy || people.isValidating || !!people.error || !values}
          desc={!values?.push || !values?.following || !values?.friend_opinions ? '上级开关已暂停；保存的选择不变。' : undefined}
          onToggle={() => togglePerson(person, 'opinions')} />
      </div>)}
      <div className="flex items-center justify-between"><Button variant="outline" disabled={busy || people.isLoading || page <= 1} onClick={() => setPage(p => p - 1)}>上一页</Button>
        <span className="text-xs text-muted-foreground">第 {page} 页 · {people.data?.data.total ?? 0} 人</span>
        <Button variant="outline" disabled={busy || people.isLoading || !people.data || page * 20 >= people.data.data.total} onClick={() => setPage(p => p + 1)}>下一页</Button></div>
    </CardContent></Card>
    {error && <ErrorPanel err={error} />}
    <p role="status" className="text-sm text-muted-foreground">{busy ? '正在保存…' : saved}</p>
  </div>;
}
