import {CopyButton} from '@/components/CopyButton';
import {Button} from '@/components/ui/button';
import {Card, CardContent, CardHeader, CardTitle} from '@/components/ui/card';
import type {LogEntry} from '@/hooks/useEventLog';

const COLOR = {
  info: 'text-muted-foreground',
  ok: 'text-emerald-500',
  warn: 'text-amber-500',
  error: 'text-red-500',
} as const;

/**
 * 事件时间轴 —— 这个页面真正的产出物。
 *
 * 它有独立的「清空」按钮，且**退出登录时不清它**：退出时一起清掉的话，
 * 刚才那次失败的线索也没了，而那正是唯一有价值的东西。
 */
export function EventLog({entries, onClear}: {entries: LogEntry[]; onClear: () => void}) {
  const asText = entries
    .map(
      (e) =>
        `${new Date(e.at).toISOString()} [${e.level}] ${e.step}` +
        `${e.ms !== undefined ? ` (${e.ms}ms)` : ''}` +
        `${e.detail ? ` — ${e.detail}` : ''}` +
        `${e.traceID ? ` trace_id=${e.traceID}` : ''}`,
    )
    .join('\n');

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">事件日志</CardTitle>
        <div className="flex gap-2">
          <CopyButton value={asText} label="复制整段" />
          <Button variant="ghost" size="sm" onClick={onClear}>
            清空日志
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-muted-foreground text-xs">还没有事件。</p>
        ) : (
          <ol className="max-h-72 space-y-1 overflow-auto font-mono text-[11px]">
            {entries.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="text-muted-foreground shrink-0">
                  {new Date(e.at).toLocaleTimeString()}
                </span>
                <span className={`shrink-0 ${COLOR[e.level]}`}>●</span>
                <span className="break-all">
                  {e.step}
                  {e.ms !== undefined && <span className="text-muted-foreground"> ({e.ms}ms)</span>}
                  {e.detail && <span className="text-muted-foreground"> — {e.detail}</span>}
                  {e.traceID && (
                    <span className="text-muted-foreground"> trace_id={e.traceID}</span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
