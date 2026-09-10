'use client';

import {Switch} from 'radix-ui';
import type {ReactNode} from 'react';

/**
 * 开关行：label + 说明 + Radix Switch。
 *
 * **完全受控**：checked 来自页面状态，POST 回整页后父层直接覆盖本地状态
 * （settings.md §0 规则「每条 POST 回整页」），这里不另存副本 —— 否则
 * 回包到达前后的两次渲染会让开关肉眼可见地跳一下。
 * 乐观更新由父层做（点击即 setState，失败再回滚）。
 */
export function ToggleRow({
  label,
  desc,
  checked,
  disabled,
  onToggle,
}: {
  label: ReactNode;
  desc?: ReactNode;
  checked: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <div className="text-sm">{label}</div>
        {desc && <div className="text-muted-foreground mt-0.5 text-xs">{desc}</div>}
      </div>
      <Switch.Root
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="data-[state=checked]:bg-primary data-[state=unchecked]:bg-input relative h-5 w-9 shrink-0 rounded-full border border-transparent transition-colors disabled:opacity-50"
      >
        <Switch.Thumb className="block size-4 translate-x-0.5 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-[18px]" />
      </Switch.Root>
    </div>
  );
}
