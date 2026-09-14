'use client';

import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {ApiError} from '@/api/envelope';
import {followTarget, getRelations, unfollowTarget} from '@/api/social';

export type AuthorRelation = {phase: 'loading' | 'ready' | 'saving' | 'failed'; following?: boolean; remark?: string};

/** One relation per author across all cards/lanes, scoped to the exact login session. */
export function useSquareAuthorRelations(bearer: string | undefined, callbacks: {
  onError: (error: unknown) => void;
  onMutation: (identifier: string, following?: boolean) => void;
}) {
  const scope = useMemo(() => ({bearer, active: true, rows: {} as Record<string, AuthorRelation>,
    versions: new Map<string, number>(), locks: new Set<string>(), uncertain: new Set<string>(), controllers: new Set<AbortController>()}), [bearer]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const handlers = useRef(callbacks);
  handlers.current = callbacks;
  const [snapshot, setSnapshot] = useState({scope, rows: scope.rows});
  const current = useCallback(() => scope.active && currentScope.current === scope, [scope]);
  const publish = useCallback(() => {
    if (current()) setSnapshot({scope, rows: {...scope.rows}});
  }, [scope, current]);

  useEffect(() => {
    scope.active = true;
    return () => {
      scope.active = false;
      for (const controller of scope.controllers) controller.abort();
      scope.controllers.clear();
      for (const id of Object.keys(scope.rows)) {
        scope.versions.set(id, (scope.versions.get(id) ?? 0) + 1);
        if (scope.rows[id].phase === 'loading') delete scope.rows[id];
      }
    };
  }, [scope]);

  const ensure = useCallback(async (identifiers: string[], retry = false) => {
    if (!scope.bearer || !current()) return;
    const ids = [...new Set(identifiers)].filter((id) => !scope.locks.has(id) &&
      (retry ? scope.rows[id]?.phase !== 'loading' : !scope.rows[id]));
    if (!ids.length) return;
    const versions = new Map(ids.map((id) => {
      const version = (scope.versions.get(id) ?? 0) + 1;
      scope.versions.set(id, version);
      scope.rows[id] = {...scope.rows[id], phase: 'loading'};
      return [id, version];
    }));
    publish();
    const batches = Array.from({length: Math.ceil(ids.length / 100)}, (_, i) => ids.slice(i * 100, (i + 1) * 100));
    await Promise.all(batches.map(async (batch) => {
      const controller = new AbortController();
      scope.controllers.add(controller);
      try {
        const result = await getRelations(scope.bearer!, {userIdentifiers: batch, addresses: []}, controller.signal);
        if (!current() || controller.signal.aborted) return;
        const users = result.data.users ?? [];
        for (const id of batch) {
          if (scope.versions.get(id) !== versions.get(id)) continue;
          const matches = users.filter((user) => user.identifier === id);
          const user = matches.length === 1 ? matches[0] : undefined;
          // Missing or malformed facts remain unknown, never an invented "not following".
          scope.rows[id] = user && typeof user.following === 'boolean'
            ? {phase: 'ready', following: user.following, remark: typeof user.remark === 'string' && user.remark ? user.remark : undefined}
            : {phase: 'failed'};
          if (scope.rows[id].phase === 'ready' && scope.uncertain.delete(id)) handlers.current.onMutation(id, scope.rows[id].following);
        }
        publish();
      } catch (error) {
        if (!current() || controller.signal.aborted) return;
        for (const id of batch) if (scope.versions.get(id) === versions.get(id)) scope.rows[id] = {phase: 'failed'};
        publish();
        if (error instanceof ApiError && (error.code === 400000 || error.code === 430114)) handlers.current.onError(error);
      } finally {
        scope.controllers.delete(controller);
      }
    }));
  }, [scope, current, publish]);

  const toggle = useCallback(async (identifier: string) => {
    if (!scope.bearer || !current() || scope.locks.has(identifier)) return;
    const before = scope.rows[identifier];
    if (before?.phase !== 'ready' || typeof before.following !== 'boolean') {
      await ensure([identifier], true);
      return;
    }
    scope.locks.add(identifier);
    scope.versions.set(identifier, (scope.versions.get(identifier) ?? 0) + 1);
    scope.rows[identifier] = {...before, phase: 'saving'};
    publish();
    try {
      const result = await (before.following ? unfollowTarget : followTarget)(scope.bearer, 'user', identifier);
      if (!current()) return;
      if (typeof result.data.following !== 'boolean') throw new Error('Follow response is missing its confirmed state.');
      scope.rows[identifier] = {...before, phase: 'ready', following: result.data.following};
      publish();
      handlers.current.onMutation(identifier, result.data.following);
    } catch (error) {
      if (!current()) return;
      // An uncertain write must be read back before another toggle, never blindly resubmitted.
      scope.rows[identifier] = {...before, phase: 'failed', following: undefined};
      scope.uncertain.add(identifier);
      publish();
      handlers.current.onMutation(identifier);
      handlers.current.onError(error);
    } finally {
      scope.locks.delete(identifier);
    }
  }, [scope, current, publish, ensure]);

  return {entries: snapshot.scope === scope ? snapshot.rows : {}, ensure, toggle};
}
