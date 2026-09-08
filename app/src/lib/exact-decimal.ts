type ExactDecimal = {coefficient: bigint; scale: number};

const DECIMAL_PATTERN = /^-?\d+(?:\.\d+)?$/;

export function parseExactDecimal(value: string): ExactDecimal {
  const input = value.trim();
  if (!DECIMAL_PATTERN.test(input)) throw new Error(`Invalid decimal value: ${value}`);
  const negative = input.startsWith('-');
  const unsigned = negative ? input.slice(1) : input;
  const [integer, fraction = ''] = unsigned.split('.');
  const coefficient = BigInt(`${integer}${fraction}`);
  return {coefficient: negative ? -coefficient : coefficient, scale: fraction.length};
}

function exactToString(value: ExactDecimal): string {
  const negative = value.coefficient < BigInt(0);
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, '0');
  const integer = value.scale === 0 ? digits : digits.slice(0, -value.scale);
  const fraction = value.scale === 0 ? '' : digits.slice(-value.scale).replace(/0+$/, '');
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function align(a: ExactDecimal, b: ExactDecimal): [bigint, bigint, number] {
  const scale = Math.max(a.scale, b.scale);
  return [
    a.coefficient * BigInt(10) ** BigInt(scale - a.scale),
    b.coefficient * BigInt(10) ** BigInt(scale - b.scale),
    scale,
  ];
}

export function subtractDecimalStrings(left: string, right: string): string {
  const [a, b, scale] = align(parseExactDecimal(left), parseExactDecimal(right));
  return exactToString({coefficient: a - b, scale});
}

export function addDecimalStrings(left: string, right: string): string {
  const [a, b, scale] = align(parseExactDecimal(left), parseExactDecimal(right));
  return exactToString({coefficient: a + b, scale});
}

export function marketValueFromBaseUnits(amountRaw: string, decimals: number, priceUsd: string): string {
  if (!/^\d+$/.test(amountRaw)) throw new Error('Base-unit amount must be an unsigned integer.');
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) throw new Error('Invalid token decimals.');
  const price = parseExactDecimal(priceUsd);
  return exactToString({
    coefficient: BigInt(amountRaw) * price.coefficient,
    scale: decimals + price.scale,
  });
}

export function formatBaseUnitsExact(amountRaw: string, decimals?: number): string {
  if (!/^\d+$/.test(amountRaw)) return `${amountRaw} base units`;
  if (decimals === undefined) return `${amountRaw} base units`;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return `${amountRaw} base units`;
  return exactToString({coefficient: BigInt(amountRaw), scale: decimals});
}

function rounded(value: ExactDecimal, maxFraction: number): ExactDecimal {
  if (value.scale <= maxFraction) return value;
  const dropped = value.scale - maxFraction;
  const divisor = BigInt(10) ** BigInt(dropped);
  const negative = value.coefficient < BigInt(0);
  const abs = negative ? -value.coefficient : value.coefficient;
  let quotient = abs / divisor;
  if ((abs % divisor) * BigInt(2) >= divisor) quotient += BigInt(1);
  return {coefficient: negative ? -quotient : quotient, scale: maxFraction};
}

export function formatDecimalExact(value: string | undefined, maxFraction = 2): string {
  if (value === undefined || value === '') return '—';
  try {
    const parsed = rounded(parseExactDecimal(value), maxFraction);
    const output = exactToString(parsed);
    const negative = output.startsWith('-');
    const unsigned = negative ? output.slice(1) : output;
    const [integer, fraction] = unsigned.split('.');
    const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return `${negative ? '-' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
  } catch {
    return '—';
  }
}

export function decimalSign(value: string | undefined): -1 | 0 | 1 | undefined {
  if (!value) return undefined;
  try {
    const coefficient = parseExactDecimal(value).coefficient;
    return coefficient < BigInt(0) ? -1 : coefficient > BigInt(0) ? 1 : 0;
  } catch {
    return undefined;
  }
}
