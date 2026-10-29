import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {RiskBanner, RiskDialog} from '../src/components/TokenRisk';
import {normalizeRiskAssessment, RISK_COPY} from '../src/lib/risk-assessment';
import '../src/app/globals.css';

function Fixture() {
  const [grade, setGrade] = useState(4);
  const [dialog, setDialog] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [longList, setLongList] = useState(false);
  const risk = normalizeRiskAssessment({mode: 'enforce', grade, checks_complete: grade !== 0, confirmation_version: 'fixture-v1', buy_action: grade === 5 ? 'block' : grade === 4 ? 'confirm' : 'allow', items:
    grade < 2 ? [] : longList ? Object.keys(RISK_COPY).map((code) => ({code, grade, display_source: code.startsWith('goplus_') ? 'goplus' : 'codex'})) : grade === 5 ? [{code: 'goplus_honeypot', display_source: 'goplus', grade: 5}] : grade === 4 ? [
      {code: 'goplus_mintable', display_source: 'goplus', grade: 4},
      {code: 'codex_minimum_liquidity', display_source: 'codex', grade: 4},
    ] : [{code: 'goplus_buy_tax', display_source: 'goplus', grade, params: {rate: '3.88'}}],
  });
  return <main className="mx-auto max-w-3xl space-y-4 p-4 sm:p-8">
    <p className="text-xs uppercase tracking-widest text-muted">Component preview · Fixture data · No orders or wallet connections</p>
    <h1 className="text-2xl font-semibold">Token risk UI</h1>
    <div className="flex flex-wrap gap-2">{[0, 1, 2, 3, 4, 5].map((value) => <button key={value} onClick={() => {setGrade(value); setConfirmed(false);}} className={`rounded-md border border-border px-3 py-2 text-sm ${grade === value ? 'bg-accent text-white' : 'bg-surface text-muted'}`}>{value === 0 ? 'Unknown' : `R${value}`}</button>)}</div>
    <label className="flex items-center gap-2 text-sm text-muted"><input type="checkbox" checked={longList} onChange={(event) => setLongList(event.target.checked)} />Long risk list</label>
    <section className="rounded-lg border border-border bg-surface p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">Example Token <span className="text-sm text-muted">EXM</span></h2><p className="text-xs text-muted">Base · Fixture</p></div><p className="text-2xl font-semibold">$0.01234</p></div></section>
    <RiskBanner key={grade} risk={risk} />
    <section className="rounded-lg border border-border bg-surface p-5"><h2 className="font-semibold">Trade action preview</h2><p className="my-3 text-sm text-muted">Buy and Sell controls below demonstrate the risk components only. The ordinary Trade integration is covered by mounted tests.</p><div className="flex gap-3">
      <button aria-disabled={grade === 5 || undefined} onClick={() => {if (grade >= 4) setDialog(true); else setConfirmed(true);}} className={`flex-1 rounded-md px-4 py-3 text-sm font-semibold ${grade === 5 ? 'bg-red-900/60 text-red-200' : 'bg-accent text-white'}`}>{grade === 5 ? 'Buy unavailable · Why?' : 'Buy'}</button>
      <button className="flex-1 rounded-md border border-border px-4 py-3 text-sm text-foreground" onClick={() => setConfirmed(true)}>Sell</button>
    </div>{confirmed ? <p className="mt-3 text-xs text-muted">Preview action completed. No transaction was created.</p> : null}</section>
    <RiskDialog risk={risk} open={dialog} blocked={grade === 5} onClose={() => setDialog(false)} onConfirm={grade === 4 ? () => {setDialog(false); setConfirmed(true);} : undefined} />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
