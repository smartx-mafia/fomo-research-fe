"use client";

import { useState } from "react";
import { useTokenStream, mobulaUrl } from "@/lib/client";
import { fmtPrice, shortAddr, chainLabel } from "@/lib/format";
import { PctBadge } from "@/components/ui";
import type { TokenDetails } from "@/lib/types";

export default function TokenHeader({
  initialData,
  chainId,
  address,
}: {
  initialData: TokenDetails;
  chainId: string;
  address: string;
}) {
  const [copied, setCopied] = useState(false);
  const url = mobulaUrl("token/details", { blockchain: chainId, address });
  const { data: res } = useTokenStream<{ data: TokenDetails }>(url, {
    intervalMs: 10000,
    fallbackData: { data: initialData },
  });
  const data = res?.data ?? initialData;

  const socials = data.socials ?? {};
  const hasSocials = socials.twitter || socials.telegram || socials.website;

  function handleCopy() {
    navigator.clipboard.writeText(address).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        {data.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.logo} alt={data.symbol ?? "token"} className="h-11 w-11 rounded-full bg-surface-2 object-cover" />
        ) : (
          <div className="h-11 w-11 rounded-full bg-surface-2" />
        )}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-base font-semibold text-foreground">{data.name ?? data.symbol ?? "Unknown"}</span>
            {data.symbol && <span className="text-sm text-muted">{data.symbol}</span>}
            <span className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-muted">
              {chainLabel(chainId)}
            </span>
            {data.bonded !== undefined && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  data.bonded ? "bg-up/10 text-up" : "bg-accent/10 text-accent"
                }`}
              >
                {data.bonded ? "Graduated" : "Bonding"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-xs text-muted">
            <button
              type="button"
              onClick={handleCopy}
              className="font-mono hover:text-foreground"
              title="Copy address"
            >
              {shortAddr(address)}
            </button>
            {copied && <span className="text-accent">Copied</span>}
            {hasSocials && (
              <span className="flex items-center gap-2">
                {socials.twitter && (
                  <a href={socials.twitter} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    Twitter
                  </a>
                )}
                {socials.telegram && (
                  <a href={socials.telegram} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    Telegram
                  </a>
                )}
                {socials.website && (
                  <a href={socials.website} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    Website
                  </a>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="tabular text-xl font-semibold text-foreground">{fmtPrice(data.priceUSD)}</span>
        <PctBadge value={data.priceChange24hPercentage} />
      </div>
    </div>
  );
}
