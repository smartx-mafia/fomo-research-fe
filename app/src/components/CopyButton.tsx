import {Check, Copy, X} from 'lucide-react';
import {useState} from 'react';

import {Button} from '@/components/ui/button';
import {copyText} from '@/lib/clipboard';
import {cn} from '@/lib/utils';

/**
 * 复制按钮。**成功与失败都必须有可见反馈。**
 *
 * 没有反馈的复制按钮，用户会连点五次然后以为坏了；
 * 而静默失败（非安全上下文）会让人以为复制成功了，去怪粘贴那一端。
 */
export function CopyButton({
  value,
  label = '复制',
  className,
  size = 'sm',
}: {
  value: string;
  label?: string;
  className?: string;
  size?: 'sm' | 'default';
}) {
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle');

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn('gap-1.5 font-mono text-xs', className)}
      onClick={() => {
        void copyText(value).then((ok) => {
          setState(ok ? 'ok' : 'fail');
          setTimeout(() => setState('idle'), 1600);
        });
      }}
      title={state === 'fail' ? '复制失败：当前不是安全上下文，剪贴板不可用' : label}
    >
      {state === 'ok' ? (
        <Check className="size-3.5 text-emerald-500" />
      ) : state === 'fail' ? (
        <X className="size-3.5 text-red-500" />
      ) : (
        <Copy className="size-3.5" />
      )}
      {state === 'ok' ? '已复制' : state === 'fail' ? '复制失败' : label}
    </Button>
  );
}
