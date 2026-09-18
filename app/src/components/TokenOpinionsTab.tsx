"use client";

import { Heart, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { ApiError } from "@/api/envelope";
import {
  likeOpinionVersion,
  listTokenOpinions,
  unlikeOpinionVersion,
  type OpinionFeedContent,
  type TokenOpinionPage,
} from "@/api/social-content";
import { DASH, fmtAge, shortAddr } from "@/lib/format";
import { useSession } from "@/session/storage";

const LIMIT = 20;

function opinionAuthor(content: OpinionFeedContent): string {
  return shortAddr(content.opinion.authorIdentifier, 6, 4);
}

function OpinionCard({ content, busy, onToggleLike }: { content: OpinionFeedContent; busy: boolean; onToggleLike: () => void }) {
  const version = content.opinion.latestVersion;
  const author = opinionAuthor(content);
  const publishedAt = version.publishedAt.seconds;
  return (
    <article className="border-t border-border px-4 py-4">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-sm font-semibold text-muted" aria-hidden="true">{author.slice(0, 1).toUpperCase() || "•"}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-sm font-medium text-foreground" title={content.opinion.authorIdentifier}>{author}</span>
            <time className="shrink-0 text-xs text-muted" dateTime={publishedAt > 0 ? new Date(publishedAt * 1000).toISOString() : undefined}>{publishedAt > 0 ? fmtAge(publishedAt * 1000) : DASH}</time>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{version.body}</p>
          <div className="mt-3 flex items-center justify-between gap-3">
            <button type="button" onClick={onToggleLike} disabled={busy} aria-label={`${version.viewerLike ? "Unlike" : "Like"} opinion by ${author}`} aria-pressed={version.viewerLike} className={`inline-flex items-center gap-1.5 text-xs ${version.viewerLike ? "text-down" : "text-muted hover:text-foreground"}`}>
              {busy ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Heart size={14} fill={version.viewerLike ? "currentColor" : "none"} aria-hidden="true" />}
              {version.likeCount}
            </button>
            {content.token ? <span className="text-xs text-muted">{content.token.symbol || shortAddr(content.token.address)}</span> : null}
          </div>
        </div>
      </div>
    </article>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 400000) return "Please sign in again to interact with opinions.";
  return "Could not load opinions right now.";
}

export default function TokenOpinionsTab({ chain, address }: { chain: string; address: string }) {
  const session = useSession();
  const [cursor, setCursor] = useState<string>();
  const [items, setItems] = useState<OpinionFeedContent[]>([]);
  const [likeBusy, setLikeBusy] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const { data, error, isLoading, mutate } = useSWR<TokenOpinionPage>(
    ["token-opinions", chain, address, session?.jwt ?? "", cursor ?? ""],
    () => listTokenOpinions(chain, address, { bearer: session?.jwt, cursor, limit: LIMIT }),
    { shouldRetryOnError: false, revalidateOnFocus: false },
  );

  useEffect(() => {
    setCursor(undefined);
    setItems([]);
    setActionError(undefined);
  }, [chain, address, session?.jwt]);

  useEffect(() => {
    if (!data) return;
    setItems((current) => {
      const seen = new Set<string>();
      return (cursor ? [...current, ...data.items] : data.items).filter((item) => {
        if (seen.has(item.opinion.opinionID)) return false;
        seen.add(item.opinion.opinionID);
        return true;
      });
    });
  }, [cursor, data]);

  async function toggleLike(content: OpinionFeedContent) {
    if (!session) {
      setActionError("Sign in to like an opinion.");
      return;
    }
    const versionID = content.opinion.latestVersion.versionID;
    setLikeBusy(versionID);
    setActionError(undefined);
    try {
      const result = content.opinion.latestVersion.viewerLike
        ? await unlikeOpinionVersion(session.jwt, versionID)
        : await likeOpinionVersion(session.jwt, versionID);
      setItems((current) => current.map((item) => item.opinion.latestVersion.versionID === versionID
        ? {...item, opinion: {...item.opinion, latestVersion: {...item.opinion.latestVersion, viewerLike: result.liked, likeCount: result.likeCount}}}
        : item));
    } catch (cause) {
      setActionError(cause instanceof ApiError && cause.code === 400000 ? "Your session expired. Sign in again to like an opinion." : "Could not update the like.");
    } finally {
      setLikeBusy(undefined);
    }
  }

  if (isLoading && !data && items.length === 0) return <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted">Loading opinions…</div>;
  if (error && items.length === 0) return <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 text-center"><p className="text-sm text-down">{errorMessage(error)}</p><button type="button" onClick={() => void mutate()} className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-foreground"><RefreshCw size={12} aria-hidden="true" /> Retry</button></div>;
  if (items.length === 0) return <div className="flex min-h-32 items-center justify-center px-4 text-sm text-muted">No opinions for this token yet.</div>;

  return (
    <section aria-label="Token opinions">
      {actionError ? <p role="status" className="border-b border-border px-4 py-2 text-xs text-muted">{actionError}</p> : null}
      {items.map((item) => <OpinionCard key={item.opinion.opinionID} content={item} busy={likeBusy === item.opinion.latestVersion.versionID} onToggleLike={() => void toggleLike(item)} />)}
      {data?.nextCursor ? <div className="flex justify-center border-t border-border px-4 py-3"><button type="button" onClick={() => setCursor(data.nextCursor)} disabled={isLoading} className="rounded-md border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50">{isLoading ? "Loading…" : "Load more"}</button></div> : null}
    </section>
  );
}
