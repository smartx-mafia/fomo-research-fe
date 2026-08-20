"use client";

import { useRouter, usePathname } from "next/navigation";
import { chainLabel } from "@/lib/format";

const CHAIN_OPTIONS = ["solana:solana", "evm:8453", "evm:56"];

export function ChainFilter({ selected }: { selected: string[] }) {
  const router = useRouter();
  const pathname = usePathname();

  function toggle(chain: string) {
    const next = selected.includes(chain) ? selected.filter((c) => c !== chain) : [...selected, chain];
    const active = next.length > 0 ? next : CHAIN_OPTIONS; // never allow an empty filter
    const qs = active.length === CHAIN_OPTIONS.length ? "" : `?chains=${encodeURIComponent(active.join(","))}`;
    router.push(`${pathname}${qs}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-muted">Chains</span>
      {CHAIN_OPTIONS.map((chain) => {
        const active = selected.includes(chain);
        return (
          <button
            key={chain}
            type="button"
            onClick={() => toggle(chain)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
              active
                ? "border-accent bg-accent/15 text-foreground"
                : "border-border bg-surface-2 text-muted hover:text-foreground"
            }`}
          >
            {chainLabel(chain)}
          </button>
        );
      })}
    </div>
  );
}
