import {parseExactDecimal} from './exact-decimal';

/** Total token PnL / lifetime bought cost, rounded to two percentage decimals. */
export function holdingRoi(profit?: string, boughtCost?: string): {text: string; direction: -1 | 0 | 1} {
  const missing = {text: '—', direction: 0 as const};
  if (!profit || !boughtCost) return missing;
  try {
    const p = parseExactDecimal(profit), c = parseExactDecimal(boughtCost);
    if (c.coefficient <= BigInt(0)) return missing;
    const negative = p.coefficient < BigInt(0);
    const numerator = (negative ? -p.coefficient : p.coefficient) * BigInt(10) ** BigInt(c.scale) * BigInt(10000);
    const denominator = c.coefficient * BigInt(10) ** BigInt(p.scale);
    const rounded = numerator / denominator + ((numerator % denominator) * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
    const direction = rounded === BigInt(0) ? 0 : negative ? -1 : 1;
    const digits = rounded.toString().padStart(3, '0');
    return {text: `${direction < 0 ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}%`, direction};
  } catch {
    return missing;
  }
}
