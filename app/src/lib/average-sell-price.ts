import {parseExactDecimal} from './exact-decimal';

/** USD per whole token, rounded to 12 decimal places without floating point. */
export function averageSellPrice(income?: string, amount?: string): string | undefined {
  if (!income || !amount) return undefined;
  try {
    const revenue = parseExactDecimal(income), quantity = parseExactDecimal(amount);
    if (revenue.coefficient < BigInt(0) || quantity.coefficient <= BigInt(0)) return undefined;
    const numerator = revenue.coefficient * BigInt(10) ** BigInt(quantity.scale + 12);
    const denominator = quantity.coefficient * BigInt(10) ** BigInt(revenue.scale);
    const rounded = numerator / denominator + ((numerator % denominator) * BigInt(2) >= denominator ? BigInt(1) : BigInt(0));
    const digits = rounded.toString().padStart(13, '0');
    return `${digits.slice(0, -12)}.${digits.slice(-12)}`;
  } catch {
    return undefined;
  }
}
