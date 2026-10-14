import {notFound} from 'next/navigation';
import {ENABLE_HARNESS} from '@/config';
import {TokenRiskClient} from './TokenRiskClient';

export default function TokenRiskPage() {
  if (!ENABLE_HARNESS) notFound();
  return <TokenRiskClient />;
}
