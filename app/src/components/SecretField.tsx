import {Eye, EyeOff} from 'lucide-react';
import {useState} from 'react';

import {CopyButton} from '@/components/CopyButton';
import {Button} from '@/components/ui/button';

/**
 * 长串（JWT / identity token）的显示。
 *
 * 默认脱敏：这类测试台经常被截图贴进群里，而这些串是真实凭据。
 * 「显示全文」是显式动作，复制按钮**始终复制全文**（复制的目的就是拿去用）。
 */
export function SecretField({label, value}: {label: string; value: string}) {
  const [shown, setShown] = useState(false);
  const masked = value.length > 24 ? `${value.slice(0, 18)}…（${value.length} 字符）` : value;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-xs">{label}</span>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setShown((s) => !s)}
          >
            {shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {shown ? '隐藏' : '显示全文'}
          </Button>
          <CopyButton value={value} />
        </div>
      </div>
      <p className="bg-muted/50 max-h-32 overflow-auto rounded-md border p-2 font-mono text-[11px] break-all">
        {shown ? value : masked}
      </p>
    </div>
  );
}
