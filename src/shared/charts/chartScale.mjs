// Presentation only. Protocol values stay decimal strings; only bounded layout
// ratios and logarithms become Numbers. Nothing here supplies protocol math.
const RATIO_PRECISION = 1000000000n;
const MAX_DECIMAL_DIGITS = 4096;

function parseDecimal(value) {
  if (typeof value !== 'string' || value.length > MAX_DECIMAL_DIGITS) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) return null;
  const exponent = Number(match[4] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_DIGITS) return null;
  let scale = (match[3] || '').length - exponent;
  let units = BigInt(`${match[1] === '-' ? '-' : ''}${match[2]}${match[3] || ''}`);
  if (scale < 0) {
    units *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { units, scale };
}

function decimalString(units, scale) {
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, '0');
  const fraction = scale ? digits.slice(-scale).replace(/0+$/, '') : '';
  const integer = scale ? digits.slice(0, -scale) : digits;
  return `${negative ? '-' : ''}${integer}${fraction ? `.${fraction}` : ''}`;
}

function scaledUnits(parsed, scale) {
  return parsed.units * 10n ** BigInt(scale - parsed.scale);
}

function boundedRatio(numerator, denominator) {
  if (denominator <= 0n) return 0.5;
  return Number((numerator * RATIO_PRECISION) / denominator) / Number(RATIO_PRECISION);
}

function floorDivide(value, divisor) {
  const quotient = value / divisor;
  return value < 0n && value % divisor !== 0n ? quotient - 1n : quotient;
}

function niceStep(range) {
  const target = (range + 3n) / 4n;
  const magnitude = 10n ** BigInt(Math.max(0, target.toString().length - 1));
  return [1n, 2n, 5n, 10n].map((n) => n * magnitude).find((n) => n >= target) || magnitude * 10n;
}

function logOfUnits(units, scale) {
  const digits = units.toString();
  const prefix = digits.slice(0, 15);
  return Math.log10(Number(prefix)) + digits.length - prefix.length - scale;
}

function powerOfTen(exponent) {
  return exponent < 0 ? `0.${'0'.repeat(-exponent - 1)}1` : `1${'0'.repeat(exponent)}`;
}

/**
 * Coordinates for an exact-decimal observation set. Auto uses Log only when
 * every available value is positive and the exact maximum/minimum is >= 100.
 * Invalid values remain unavailable and can never silently become zero.
 */
export function createChartScale(values, { mode = 'auto' } = {}) {
  const requested = ['auto', 'linear', 'log'].includes(mode) ? mode : 'auto';
  const parsed = values.map(parseDecimal);
  const valid = parsed.filter(Boolean);
  const invalidCount = parsed.length - valid.length;
  if (!valid.length) {
    return {
      requested, effective: 'linear', logAvailable: false, invalidCount,
      minimum: null, maximum: null, ticks: [], position: () => null,
    };
  }
  // Four extra decimal places belong only to the chart's axis and allow
  // readable bounds for constant values and one-subatom changes.
  const scale = valid.reduce((maximum, value) => Math.max(maximum, value.scale), 0) + 4;
  const integers = valid.map((value) => scaledUnits(value, scale));
  let min = integers[0];
  let max = integers[0];
  for (const integer of integers) {
    if (integer < min) min = integer;
    if (integer > max) max = integer;
  }
  const logAvailable = min > 0n;
  const effective = logAvailable && (requested === 'log' || (requested === 'auto' && max >= min * 100n))
    ? 'log' : 'linear';
  const common = {
    requested, effective, logAvailable, invalidCount,
    minimum: decimalString(min, scale), maximum: decimalString(max, scale),
  };
  if (effective === 'log') {
    const logMin = logOfUnits(min, scale);
    const logMax = logOfUnits(max, scale);
    let lower = Math.floor(logMin);
    let upper = Math.ceil(logMax);
    if (lower === upper) {
      lower -= 1;
      upper += 1;
    }
    const step = Math.max(1, Math.ceil((upper - lower) / 4));
    const exponents = [lower];
    for (let exponent = lower + step; exponent < upper; exponent += step) exponents.push(exponent);
    exponents.push(upper);
    return {
      ...common,
      ticks: exponents.map((exponent) => ({
        value: powerOfTen(exponent),
        position: (exponent - lower) / (upper - lower),
      })),
      position(value) {
        const item = parseDecimal(value);
        if (!item || item.units <= 0n) return null;
        return (logOfUnits(item.units, item.scale) - lower) / (upper - lower);
      },
    };
  }
  let range = max - min;
  if (range === 0n) {
    const absolute = min < 0n ? -min : min;
    range = absolute ? (absolute / 5n || 1n) : 10n ** BigInt(scale);
  }
  const step = niceStep(range);
  let lower = floorDivide(min, step) * step;
  let upper = -floorDivide(-max, step) * step;
  if (lower === upper) {
    lower -= step;
    upper += step;
    if (min > 0n && lower < 0n) lower = 0n;
  }
  const ticks = [];
  for (let value = lower; value <= upper; value += step) {
    ticks.push({ value: decimalString(value, scale), position: boundedRatio(value - lower, upper - lower) });
  }
  // A very large amount can change by a single atom. Compact labels would
  // otherwise repeat; expose a labeled exact baseline and compact deltas.
  const labels = ticks.map((tick) => compactChartValue(tick.value));
  const axisOffset = new Set(labels).size < labels.length ? decimalString(lower, scale) : undefined;
  if (axisOffset) ticks.forEach((tick) => {
    const value = scaledUnits(parseDecimal(tick.value), scale);
    tick.axisValue = decimalString(value - lower, scale);
  });
  return {
    ...common,
    axisOffset,
    ticks,
    position(value) {
      const item = parseDecimal(value);
      if (!item) return null;
      // Position values with extra precision without rounding the observation.
      const coordinateScale = Math.max(scale, item.scale);
      const multiplier = 10n ** BigInt(coordinateScale - scale);
      return boundedRatio(scaledUnits(item, coordinateScale) - lower * multiplier, (upper - lower) * multiplier);
    },
  };
}

/** Compact axis labels only; original strings remain in the inspector/table. */
export function compactChartValue(value) {
  const parsed = parseDecimal(value);
  if (!parsed) return 'Unavailable';
  if (parsed.units === 0n) return '0';
  const negative = parsed.units < 0n;
  const digits = (negative ? -parsed.units : parsed.units).toString();
  const exponent = digits.length - parsed.scale - 1;
  const sign = negative ? '−' : '';
  if (exponent >= 15 || exponent <= -5) {
    const significant = digits.slice(0, 3).padEnd(3, '0');
    const fraction = significant.slice(1).replace(/0+$/, '');
    return `${sign}${significant[0]}${fraction ? `.${fraction}` : ''}e${exponent}`;
  }
  const suffixes = [[12, 'T'], [9, 'B'], [6, 'M'], [3, 'K']];
  const suffix = suffixes.find(([power]) => exponent >= power);
  if (suffix) {
    const shiftedScale = parsed.scale + suffix[0];
    const shifted = decimalString(negative ? -parsed.units : parsed.units, shiftedScale);
    const [integer, fraction = ''] = shifted.split('.');
    const decimal = fraction.slice(0, integer.length >= 3 ? 0 : integer.length === 2 ? 1 : 2).replace(/0+$/, '');
    return `${sign}${integer}${decimal ? `.${decimal}` : ''}${suffix[1]}`;
  }
  const exact = decimalString(negative ? -parsed.units : parsed.units, parsed.scale);
  if (exact.length <= 9) return `${sign}${exact}`;
  const [integer, fraction = ''] = exact.split('.');
  const retained = fraction.slice(0, Math.max(2, 5 - integer.length)).replace(/0+$/, '');
  return `${sign}${integer}${retained ? `.${retained}` : ''}`;
}
