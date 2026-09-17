import type {CreateIntent} from './contract';

const PREFIX = 'smartx-fast-swap.v1.';
export type FastSwapRecovery = {
  actor: string;
  client_intent_id: string;
  create_idempotency_key: string;
  execution_idempotency_key: string | null;
  swap_id: string | null;
  revision: string | null;
  intent: CreateIntent;
  create_recovery_action?: string;
  create_retry_after_at?: string;
  create_related_swap_id?: string;
  pending_operation?: {
    kind: 'refresh' | 'cancel';
    swap_id: string;
    expected_revision: string | null;
    idempotency_key: string;
    recovery_action?: string;
    retry_after_at?: string;
    last_trace_id?: string;
  };
  last_trace_id?: string;
  updated_at: string;
};

function key(actor: string) { return `${PREFIX}${actor}`; }
export function readRecovery(actor: string): FastSwapRecovery | null {
  try {
    const value = localStorage.getItem(key(actor));
    if (!value) return null;
    const parsed = JSON.parse(value) as FastSwapRecovery;
    return parsed.actor === actor && parsed.intent?.client_intent_id === parsed.client_intent_id ? parsed : null;
  } catch { return null; }
}
export function writeRecovery(value: FastSwapRecovery): boolean {
  try { localStorage.setItem(key(value.actor), JSON.stringify(value)); return localStorage.getItem(key(value.actor)) !== null; } catch { return false; }
}
export function clearRecovery(actor: string): void {
  try { localStorage.removeItem(key(actor)); } catch { /* storage is optional after the server has a terminal record */ }
}
