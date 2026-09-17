'use client';

/**
 * harness 的空壳容器。
 *
 * 本票只交付边界：一个被 `next/dynamic({ ssr: false })` 挂载的、纯客户端的容器。
 * 真正的 harness App（Privy Provider、fail-loud 配置检查、错误边界、各能力面板）
 * 由后续票填进来，填的时候只改这个文件树，不再动 route group 结构。
 */
export default function HarnessShell() {
  return (
    <div
      data-testid="harness-shell"
      className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-2 p-8 text-center"
    >
      <h1 className="font-mono text-sm font-semibold tracking-tight">harness shell</h1>
      <p className="text-xs text-muted">
        Client-only container. Capabilities are wired up in a later migration step.
      </p>
    </div>
  );
}
