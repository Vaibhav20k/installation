/**
 * Fixed-point decimal for measured quantities and rates (6 fractional digits).
 * Binary floating point is never used for quantities, rates or money.
 */
const SCALE = 1_000_000n;
const DIGITS = 6;

export class Dec {
  private constructor(readonly raw: bigint) {}

  static of(value: string | number | bigint | Dec): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === "bigint") return new Dec(value * SCALE);
    const text = typeof value === "number" ? numberToText(value) : value.trim();
    const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
    if (!match) throw new Error(`Not a decimal: "${value}"`);
    const [, sign, whole, frac = ""] = match;
    if (frac.length > DIGITS && /[1-9]/.test(frac.slice(DIGITS))) {
      throw new Error(`More than ${DIGITS} decimal places: "${value}"`);
    }
    const units = BigInt(whole!) * SCALE + BigInt((frac.slice(0, DIGITS) || "0").padEnd(DIGITS, "0"));
    return new Dec(sign ? -units : units);
  }

  static zero = new Dec(0n);

  add(o: Dec | string | number): Dec { return new Dec(this.raw + Dec.of(o).raw); }
  sub(o: Dec | string | number): Dec { return new Dec(this.raw - Dec.of(o).raw); }
  mul(o: Dec | string | number): Dec { return new Dec(roundDiv(this.raw * Dec.of(o).raw, SCALE)); }
  /** Division rounds half away from zero at 6 places. Throws on zero divisor. */
  div(o: Dec | string | number): Dec {
    const d = Dec.of(o).raw;
    if (d === 0n) throw new Error("Division by zero");
    return new Dec(roundDiv(this.raw * SCALE, d));
  }
  cmp(o: Dec | string | number): number {
    const r = Dec.of(o).raw;
    return this.raw < r ? -1 : this.raw > r ? 1 : 0;
  }
  isZero(): boolean { return this.raw === 0n; }
  isNegative(): boolean { return this.raw < 0n; }
  isPositive(): boolean { return this.raw > 0n; }
  max(o: Dec | string | number): Dec { return this.cmp(o) >= 0 ? this : Dec.of(o); }
  min(o: Dec | string | number): Dec { return this.cmp(o) <= 0 ? this : Dec.of(o); }

  /** Round to an integer, half away from zero. */
  roundToInt(): bigint { return roundDiv(this.raw, SCALE); }
  /** Round up to the next integer (used for scheduling slot counts, never for effort). */
  ceilToInt(): bigint {
    const q = this.raw / SCALE;
    return this.raw > q * SCALE ? q + 1n : q;
  }

  toString(): string {
    const neg = this.raw < 0n;
    const abs = neg ? -this.raw : this.raw;
    const whole = abs / SCALE;
    const frac = (abs % SCALE).toString().padStart(DIGITS, "0").replace(/0+$/, "");
    return `${neg ? "-" : ""}${whole}${frac ? "." + frac : ""}`;
  }
  toNumber(): number { return Number(this.toString()); }
  toJSON(): string { return this.toString(); }
}

function roundDiv(n: bigint, d: bigint): bigint {
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n;
  const ad = d < 0n ? -d : d;
  let q = an / ad;
  if ((an % ad) * 2n >= ad) q += 1n;
  return neg ? -q : q;
}

function numberToText(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  // toFixed avoids exponent notation; trailing digits beyond 6 places are rounded off.
  return n.toFixed(DIGITS);
}

export function sumDec(values: Iterable<Dec | string | number>): Dec {
  let total = Dec.zero;
  for (const v of values) total = total.add(v);
  return total;
}
