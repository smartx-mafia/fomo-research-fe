export function parseUnits(value: string, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals.');
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) throw new Error('Enter a positive decimal amount.');
  const [whole, fraction = ''] = normalized.split('.');
  if (fraction.length > decimals) throw new Error(`This asset supports at most ${decimals} decimal places.`);
  const raw = `${whole}${fraction.padEnd(decimals, '0')}`.replace(/^0+(?=\d)/, '');
  if (BigInt(raw) <= BigInt(0)) throw new Error('Amount must be greater than zero.');
  return raw;
}

export function formatUnits(value: string | null | undefined, decimals: number, maximumFractionDigits = 8): string {
  if (value === null || value === undefined) return 'Unavailable';
  if (!/^\d+$/.test(value) || !Number.isInteger(decimals) || decimals < 0) return 'Invalid';
  const padded = value.padStart(decimals + 1, '0');
  const whole = decimals === 0 ? padded : padded.slice(0, -decimals);
  const fraction = decimals === 0 ? '' : padded.slice(-decimals).slice(0, maximumFractionDigits).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function shortAddress(value: string): string {
  return value.length <= 15 ? value : `${value.slice(0, 7)}…${value.slice(-6)}`;
}
