import type {PortfolioActivityRecord} from '@/api/portfolio-activities';
import {formatDecimalExact} from '@/lib/exact-decimal';

const titles: Record<string, string> = {buy: 'Buy', sell: 'Sell', transfer_in: 'Transfer in'};
const timeLabels: Record<string, string> = {transfer_time: 'Transfer time', observed_time: 'Observed time', trade_confirmation: 'Confirmed time', order_time: 'Order time'};
const explorers: Record<string, string> = {bsc: 'https://bscscan.com/tx/', solana: 'https://solscan.io/tx/', eth: 'https://etherscan.io/tx/', ethereum: 'https://etherscan.io/tx/', base: 'https://basescan.org/tx/', arbitrum: 'https://arbiscan.io/tx/', optimism: 'https://optimistic.etherscan.io/tx/', polygon: 'https://polygonscan.com/tx/'};
const usd = (value?: string) => value === undefined ? '—' : `$${formatDecimalExact(value, 20)}`;

export function PortfolioCycleActivityRow({record, symbol}: {record: PortfolioActivityRecord; symbol?: string}) {
  const external = record.side === 'transfer_in';
  const trade = record.side === 'buy' || record.side === 'sell';
  const amount = external || trade ? record.trade_value_usd : undefined;
  const price = external || trade ? record.execution_price_usd : undefined;
  const date = new Date(record.created_at ?? NaN);
  const explorer = record.tx_hash && record.tx_chain && explorers[record.tx_chain];
  return <tr className="border-t border-border align-top text-xs">
    <td className="px-3 py-3">{titles[record.side] ?? 'Other activity'}{external && record.time_basis === 'observed_time' ? <p className="mt-1 text-muted">On-chain balance sync</p> : null}</td>
    <td className="px-3 py-3 text-right font-mono">{record.token_amount === undefined ? 'Quantity unavailable' : `${formatDecimalExact(record.token_amount, 20)} ${record.symbol ?? symbol ?? ''}`}</td>
    <td className="px-3 py-3 text-right"><p className="font-mono">{usd(amount)}</p><p className="mt-1 text-muted">{external ? 'Reference acquisition cost' : record.side === 'buy' ? 'Actual paid' : record.side === 'sell' ? 'Actual received' : '—'}</p>{external && amount === undefined ? <p className="text-muted">Valuation pending</p> : null}</td>
    <td className="px-3 py-3 text-right"><p className="font-mono">{usd(price)}</p><p className="mt-1 text-muted">{external ? 'Reference unit price' : trade ? 'Execution price' : '—'}</p></td>
    <td className="px-3 py-3"><p>{Number.isFinite(date.getTime()) ? date.toLocaleString() : '—'}</p><p className="mt-1 text-muted">{trade ? 'Order time' : timeLabels[record.time_basis] ?? 'Time basis unavailable'}</p></td>
    <td className="px-3 py-3">{explorer ? <a className="text-accent underline" href={`${explorer}${encodeURIComponent(record.tx_hash!)}`} target="_blank" rel="noopener noreferrer">View transaction</a> : '—'}</td>
  </tr>;
}
