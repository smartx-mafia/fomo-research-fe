'use client';

import {AlertTriangle, LoaderCircle, X} from 'lucide-react';
import Link from 'next/link';
import {useEffect, useRef, useState} from 'react';

import {
  createOpinion,
  deleteOpinion,
  getOpinionByTarget,
  updateOpinion,
  type Opinion,
  type OpinionAttachmentInput,
} from '@/api/social-content';
import {ApiError} from '@/api/envelope';
import {
  clearOpinionIntent,
  newOpinionIdempotencyKey,
  opinionFailureIsUncertain,
  readOpinionIntent,
  writeOpinionIntent,
  type OpinionIntent,
} from '@/lib/opinion-recovery';
import {clearSite, useSession} from '@/session/storage';

const BODY_WEIGHT_LIMIT = 280;
const X_LINK_PATTERN = /^https:\/\/(?:x|twitter)\.com\/\S+$/i;

/** Non-ASCII characters count as 2, everything else as 1; the server still normalizes Unicode. */
function weightedLength(value: string): number {
  let total = 0;
  for (const char of value) total += (char.codePointAt(0) ?? 0) > 0x7f ? 2 : 1;
  return total;
}

function errorText(error: unknown): string {
  if (error instanceof ApiError) return `code ${error.code} · ${error.reason ?? 'unknown'} · trace ${error.traceID ?? 'unavailable'}`;
  return error instanceof Error ? error.message : String(error);
}

type ComposerMessage = {tone: 'notice' | 'error'; text: string; detail?: string};

export function OpinionComposer({targetID, targetLabel, onClose, onPublished, onDeleted}: {
  targetID: string;
  targetLabel?: string;
  onClose: () => void;
  onPublished?: (opinion: Opinion) => void;
  onDeleted?: () => void;
}) {
  const session = useSession();
  const jwtRef = useRef<string | undefined>(undefined);
  jwtRef.current = session?.jwt;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string>();
  const [admissionBlocked, setAdmissionBlocked] = useState(false);
  const [admissionTrace, setAdmissionTrace] = useState<string>();
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [opinionID, setOpinionID] = useState<number>();
  const [baseVersionID, setBaseVersionID] = useState<number>();
  const [versionNo, setVersionNo] = useState<number>();
  const [body, setBody] = useState('');
  const [xLinkURL, setXLinkURL] = useState('');
  const [pendingIntent, setPendingIntent] = useState<OpinionIntent>();
  const [storageWarning, setStorageWarning] = useState(false);
  const [formMessage, setFormMessage] = useState<ComposerMessage>();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const uncertain = pendingIntent !== undefined;

  useEffect(() => () => clearTimeout(deleteTimerRef.current), []);

  const applyOpinion = (opinion: Opinion) => {
    // opinionID / baseVersionID always come from the freshest read, never from
    // an older render: the edit must be based on a concurrent snapshot.
    setMode('edit');
    setOpinionID(opinion.opinionID);
    setBaseVersionID(opinion.latestVersion.versionID);
    setVersionNo(opinion.latestVersion.versionNo);
    setBody(opinion.latestVersion.body);
    setXLinkURL(opinion.latestVersion.items.find((item) => item.kind === 'x_link')?.url ?? '');
  };

  const load = async (bearer: string, notice?: string) => {
    setLoading(true);
    setLoadError(undefined);
    setAdmissionBlocked(false);
    setAdmissionTrace(undefined);
    setFormMessage(undefined);
    try {
      const opinion = await getOpinionByTarget(bearer, 'POSITION', targetID);
      if (jwtRef.current !== bearer) return;
      applyOpinion(opinion);
      if (notice) setFormMessage({tone: 'notice', text: notice});
    } catch (cause) {
      if (jwtRef.current !== bearer) return;
      if (cause instanceof ApiError && cause.code === 200100) {
        setMode('create');
        setOpinionID(undefined);
        setBaseVersionID(undefined);
        setVersionNo(undefined);
        setBody('');
        setXLinkURL('');
        if (notice) setFormMessage({tone: 'notice', text: notice});
      } else if (cause instanceof ApiError && cause.code === 400000) {
        clearSite();
      } else if (cause instanceof ApiError && cause.code === 430114) {
        setAdmissionBlocked(true);
        setAdmissionTrace(cause.traceID);
      } else {
        setLoadError(errorText(cause));
      }
    } finally {
      if (jwtRef.current === bearer) setLoading(false);
    }
  };

  useEffect(() => {
    const bearer = session?.jwt;
    if (!bearer) return;
    // An intent is only left in storage while its outcome is unresolved, so
    // restoring it must offer the exact same submission instead of a new one.
    const stored = readOpinionIntent(targetID);
    if (stored) {
      setPendingIntent(stored);
      setMode(stored.mode);
      if (stored.mode === 'edit') {
        setOpinionID(stored.opinionID);
        setBaseVersionID(stored.baseVersionID);
      }
      setBody(stored.body);
      setXLinkURL(stored.xLinkURL);
      setLoading(false);
      return;
    }
    void load(bearer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.jwt, targetID]);

  const adoptExisting = async (bearer: string, message: string) => {
    try {
      const opinion = await getOpinionByTarget(bearer, 'POSITION', targetID);
      if (jwtRef.current !== bearer) return;
      // Keep the typed content: only the underlying opinion switches.
      setMode('edit');
      setOpinionID(opinion.opinionID);
      setBaseVersionID(opinion.latestVersion.versionID);
      setVersionNo(opinion.latestVersion.versionNo);
      setFormMessage({tone: 'notice', text: message});
    } catch (adoptCause) {
      if (jwtRef.current !== bearer) return;
      setFormMessage({tone: 'error', text: message, detail: errorText(adoptCause)});
    }
  };

  const handleDeterministicFailure = (bearer: string, cause: unknown) => {
    if (!(cause instanceof ApiError)) {
      setFormMessage({tone: 'error', text: 'The submission was rejected before it reached the backend.', detail: errorText(cause)});
      return;
    }
    switch (cause.code) {
      case 400000:
        clearSite();
        return;
      case 600100: {
        const ruleID = typeof cause.metadata?.rule_id === 'string' && cause.metadata.rule_id !== '' ? cause.metadata.rule_id : undefined;
        setFormMessage({
          tone: 'error',
          text: `The opinion did not pass publish review${ruleID ? ` (rule ${ruleID})` : ''}. Edit the body or link, then submit again.`,
          detail: errorText(cause),
        });
        return;
      }
      case 420101:
        // The base version moved on. Refresh the snapshot and prefill it; the
        // next submit automatically uses a new key and the new baseVersionID.
        void load(bearer, 'Updated elsewhere. Review the latest version and submit again.');
        return;
      case 430103:
        void adoptExisting(bearer, 'An opinion for this position already exists. Switched to editing it; submit to update that opinion.');
        return;
      case 200103:
        setFormMessage({tone: 'error', text: 'This position no longer exists. Refresh the portfolio page and start again.', detail: errorText(cause)});
        return;
      case 100100:
        setFormMessage({tone: 'error', text: 'The body is empty or exceeds the length limit. Edit it and submit again.', detail: errorText(cause)});
        return;
      case 100101:
        setFormMessage({tone: 'error', text: 'The attachment is invalid. Keep a single valid X/Twitter link or clear the field.', detail: errorText(cause)});
        return;
      case 420100:
        setFormMessage({tone: 'error', text: 'The idempotency key was already used with different content. Submitting again will use a fresh key.', detail: errorText(cause)});
        return;
      default:
        setFormMessage({tone: 'error', text: `The submission failed (code ${cause.code}).`, detail: errorText(cause)});
    }
  };

  const submitIntent = async (bearer: string, intent: OpinionIntent) => {
    setBusy(true);
    setFormMessage(undefined);
    const items: OpinionAttachmentInput[] = intent.xLinkURL === '' ? [] : [{x_link: {url: intent.xLinkURL}}];
    try {
      const opinion = intent.mode === 'create'
        ? await createOpinion(bearer, {targetType: 'POSITION', targetID: intent.targetID, body: intent.body, items, idempotencyKey: intent.idempotencyKey})
        : await updateOpinion(bearer, intent.opinionID!, {baseVersionID: intent.baseVersionID!, body: intent.body, items, idempotencyKey: intent.idempotencyKey});
      if (jwtRef.current !== bearer) return;
      clearOpinionIntent(intent.targetID);
      setPendingIntent(undefined);
      onPublished?.(opinion);
      onClose();
    } catch (cause) {
      if (opinionFailureIsUncertain(cause)) {
        // Keep the intent verbatim: only the same key and content may be replayed.
        setPendingIntent(intent);
        setFormMessage({
          tone: 'error',
          text: 'The submission result is unknown: the response never arrived or the service was interrupted, so it may still have gone through. Replay the exact same submission; editing it is disabled until the outcome is known.',
          detail: errorText(cause),
        });
      } else {
        clearOpinionIntent(intent.targetID);
        setPendingIntent(undefined);
        if (jwtRef.current === bearer) handleDeterministicFailure(bearer, cause);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = () => {
    const bearer = session?.jwt;
    if (!bearer || busy || uncertain) return;
    const existing = readOpinionIntent(targetID);
    const intent: OpinionIntent = existing ?? {
      targetID,
      mode,
      ...(mode === 'edit' ? {opinionID: opinionID!, baseVersionID: baseVersionID!} : {}),
      body,
      xLinkURL: xLinkURL.trim(),
      idempotencyKey: newOpinionIdempotencyKey(),
    };
    if (!existing && !writeOpinionIntent(intent)) {
      setStorageWarning(true);
    }
    void submitIntent(bearer, intent);
  };

  const retrySameSubmission = () => {
    const bearer = session?.jwt;
    if (!bearer || busy) return;
    const intent = readOpinionIntent(targetID) ?? pendingIntent;
    if (intent) void submitIntent(bearer, intent);
  };

  const requestDelete = () => {
    const bearer = session?.jwt;
    if (!bearer || opinionID === undefined || busy) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setConfirmDelete(false), 3_000);
      return;
    }
    clearTimeout(deleteTimerRef.current);
    setConfirmDelete(false);
    setBusy(true);
    setFormMessage(undefined);
    void deleteOpinion(bearer, opinionID)
      .then(() => {
        onDeleted?.();
        onClose();
      })
      .catch((cause: unknown) => {
        if (cause instanceof ApiError && cause.code === 200100) {
          onDeleted?.();
          onClose();
          return;
        }
        if (cause instanceof ApiError && cause.code === 400000) {
          clearSite();
          return;
        }
        setFormMessage({
          tone: 'error',
          text: opinionFailureIsUncertain(cause)
            ? 'The delete result is unknown. Retry the same delete; the operation stays idempotent.'
            : 'The opinion could not be deleted.',
          detail: errorText(cause),
        });
      })
      .finally(() => setBusy(false));
  };

  const requestClose = () => {
    if (uncertain && !confirmClose) {
      setConfirmClose(true);
      return;
    }
    onClose();
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (uncertain && !confirmClose) {
        setConfirmClose(true);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [uncertain, confirmClose, onClose]);

  if (!session) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
        <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-xl border border-border bg-surface p-5" onClick={(event) => event.stopPropagation()}>
          <h2 className="text-lg font-semibold text-foreground">Sign in required</h2>
          <p className="mt-2 text-sm text-muted">Sign in to post an opinion about this position.</p>
          <Link href="/login" className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white">Sign in</Link>
        </div>
      </div>
    );
  }

  const bodyWeight = weightedLength(body);
  const overLimit = bodyWeight > BODY_WEIGHT_LIMIT;
  const trimmedLink = xLinkURL.trim();
  const linkInvalid = trimmedLink !== '' && !X_LINK_PATTERN.test(trimmedLink);
  const canSubmit = body.trim() !== '' && !overLimit && !linkInvalid && (mode === 'create' || (opinionID !== undefined && baseVersionID !== undefined));
  const heading = targetLabel ?? 'This position';
  const modeLabel = mode === 'edit' ? (versionNo === undefined ? 'Edit opinion' : `Edit opinion v${versionNo}`) : 'Post opinion';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={requestClose}>
      <div role="dialog" aria-modal="true" className="w-full max-w-lg rounded-xl border border-border bg-surface p-5" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{heading}</h2>
            <p className="mt-0.5 text-xs text-muted">{modeLabel}</p>
          </div>
          <button type="button" onClick={requestClose} aria-label="Close" className="rounded p-1 text-muted hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p role="status" aria-live="polite" className="mt-6 flex items-center gap-2 text-sm text-muted"><LoaderCircle className="h-4 w-4 animate-spin" />Checking for an existing opinion…</p>
        ) : admissionBlocked ? (
          <div role="alert" className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground"><AlertTriangle className="h-4 w-4 text-accent" />Invitation access required</div>
            <p className="mt-1 text-xs text-muted">The account is signed in, but the backend has not admitted it through invitation access yet. Complete invitation access first; retrying here will not change this.</p>
            <p className="mt-2 font-mono text-xs text-muted">code 430114 · trace {admissionTrace ?? 'unavailable'}</p>
          </div>
        ) : loadError ? (
          <div className="mt-4">
            <p role="alert" className="rounded border border-down/40 bg-down/5 p-3 text-xs text-down">{loadError}</p>
            <button type="button" onClick={() => session?.jwt && void load(session.jwt)} className="mt-2 rounded-md border border-border px-3 py-2 text-sm text-foreground">Retry</button>
          </div>
        ) : (
          <>
            <label className="mt-4 block text-xs text-muted">
              Body
              <textarea
                value={body}
                onChange={(event) => setBody(event.target.value)}
                disabled={busy || uncertain}
                rows={4}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className={overLimit ? 'text-down' : 'text-muted'}>{bodyWeight} / {BODY_WEIGHT_LIMIT}</span>
              <span className="text-muted">Non-ASCII characters count as 2.</span>
            </div>
            <label className="mt-3 block text-xs text-muted">
              X link (optional)
              <input
                value={xLinkURL}
                onChange={(event) => setXLinkURL(event.target.value)}
                disabled={busy || uncertain}
                inputMode="url"
                placeholder="https://x.com/handle/status/123"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-accent disabled:opacity-60"
              />
            </label>
            {linkInvalid ? <p className="mt-1 text-xs text-down">Only https://x.com/… or https://twitter.com/… links are accepted; clear the field to remove the attachment.</p> : null}
            {storageWarning ? <p className="mt-2 rounded border border-down/40 bg-down/5 p-2 text-xs text-down">The idempotency marker could not be stored in this browser. If this submission is lost mid-flight it cannot be recovered here.</p> : null}

            {uncertain ? (
              <div className="mt-4 rounded-lg border border-accent/40 bg-accent/5 p-3">
                <p className="text-xs text-accent">
                  A previous submission has an unknown result and may have gone through. Only the exact same submission can be replayed — same key, same content. Editing or creating a new one stays blocked until it resolves.
                </p>
                <button type="button" onClick={retrySameSubmission} disabled={busy} className="mt-2 rounded-md border border-accent px-3 py-2 text-xs font-semibold text-accent disabled:opacity-50">
                  Retry same submission
                </button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={busy || !canSubmit}
                  className="mt-4 w-full rounded-md bg-accent px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {mode === 'edit' ? 'Save changes' : 'Post opinion'}
                </button>
                {mode === 'edit' && opinionID !== undefined ? (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={requestDelete}
                      disabled={busy}
                      className={confirmDelete
                        ? 'rounded-md bg-down px-3 py-2 text-xs font-semibold text-white disabled:opacity-50'
                        : 'rounded-md border border-border px-3 py-2 text-xs text-muted hover:text-down disabled:opacity-50'}
                    >
                      {confirmDelete ? 'Confirm delete' : 'Delete opinion'}
                    </button>
                  </div>
                ) : null}
              </>
            )}

            {busy ? <p role="status" className="mt-2 flex items-center gap-2 text-xs text-muted"><LoaderCircle className="h-3.5 w-3.5 animate-spin" />Submitting…</p> : null}
            {formMessage ? (
              <div
                role={formMessage.tone === 'error' ? 'alert' : 'status'}
                className={`mt-3 rounded border p-3 text-xs ${formMessage.tone === 'error' ? 'border-down/40 bg-down/5 text-down' : 'border-accent/40 bg-accent/5 text-accent'}`}
              >
                <p>{formMessage.text}</p>
                {formMessage.detail ? <p className="mt-1 font-mono text-[11px] text-muted">{formMessage.detail}</p> : null}
              </div>
            ) : null}
            {confirmClose ? (
              <div className="mt-3 rounded border border-accent/40 bg-accent/5 p-3 text-xs text-accent">
                <p>The submission result is still unresolved. Closing now keeps the stored recovery marker; reopening this composer offers the exact same submission again.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => setConfirmClose(false)} className="rounded border border-border px-3 py-2 text-xs text-muted">Keep resolving</button>
                  <button type="button" onClick={onClose} className="rounded border border-accent px-3 py-2 text-xs text-accent">Close anyway</button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
