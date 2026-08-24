"use client";

import { useEffect, useRef, useState } from "react";
import { num } from "@/lib/format";

/**
 * 实时数值更新提示：`value` 相比上一次渲染上涨 → 背景短暂闪绿，
 * 下跌 → 闪红，~1s 淡出（keyframes 在 globals.css）。数值不变不闪。
 *
 * 用 key 重挂 span 来重放 CSS 动画（连续两次上涨也各闪一次）。
 * 组件实例按所在行/格保存上一次的值，所以列表行必须有稳定的 key
 * （如 chain:address），否则换行复用会误比较两个不同 token 的值。
 */
export function Flash({
  value,
  children,
  className = "",
}: {
  value: unknown;
  children: React.ReactNode;
  className?: string;
}) {
  const prev = useRef<number | undefined>(undefined);
  const [anim, setAnim] = useState<{ dir: "up" | "down"; key: number } | null>(null);

  const n = num(value);
  useEffect(() => {
    const p = prev.current;
    prev.current = n;
    if (p === undefined || n === undefined || n === p) return;
    setAnim((a) => ({ dir: n > p ? "up" : "down", key: (a?.key ?? 0) + 1 }));
  }, [n]);

  return (
    <span
      key={anim?.key ?? 0}
      className={`rounded px-1 -mx-1 ${anim ? (anim.dir === "up" ? "flash-up" : "flash-down") : ""} ${className}`}
    >
      {children}
    </span>
  );
}
