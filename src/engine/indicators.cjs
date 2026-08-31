"use strict";

const nils = (n) => new Array(n).fill(null);
const finite = (value) => Number.isFinite(value) ? value : null;
const round = (value, digits = 6) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function sma(values, period) {
  const out = nils(values.length);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  const out = nils(values.length);
  if (period <= 0 || values.length < period) return out;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = seed;
  const factor = 2 / (period + 1);
  for (let i = period; i < values.length; i += 1) {
    out[i] = values[i] * factor + out[i - 1] * (1 - factor);
  }
  return out;
}

function rsi(values, period = 14) {
  const out = nils(values.length);
  if (values.length <= period) return out;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i += 1) {
    const diff = values[i] - values[i - 1];
    gains += Math.max(diff, 0);
    losses += Math.max(-diff, 0);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  const valueOf = () => avgGain === 0 && avgLoss === 0 ? 50 : avgLoss === 0 ? 100 : avgGain === 0 ? 0 : 100 - (100 / (1 + avgGain / avgLoss));
  out[period] = valueOf();
  for (let i = period + 1; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = valueOf();
  }
  return out;
}

function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const fastLine = ema(values, fast);
  const slowLine = ema(values, slow);
  const line = values.map((_, index) => (
    fastLine[index] == null || slowLine[index] == null ? null : fastLine[index] - slowLine[index]
  ));
  const start = line.findIndex((value) => value != null);
  const signal = nils(values.length);
  if (start >= 0) {
    const compact = ema(line.slice(start), signalPeriod);
    compact.forEach((value, index) => { signal[start + index] = value; });
  }
  const histogram = line.map((value, index) => (
    value == null || signal[index] == null ? null : value - signal[index]
  ));
  return { line, signal, histogram };
}

function standardDeviation(values, period) {
  const mean = sma(values, period);
  const out = nils(values.length);
  for (let i = period - 1; i < values.length; i += 1) {
    const m = mean[i];
    let variance = 0;
    for (let j = i - period + 1; j <= i; j += 1) variance += (values[j] - m) ** 2;
    out[i] = Math.sqrt(variance / period);
  }
  return out;
}

function bollinger(values, period = 20, deviations = 2) {
  const middle = sma(values, period);
  const deviation = standardDeviation(values, period);
  const upper = values.map((_, index) => middle[index] == null ? null : middle[index] + deviation[index] * deviations);
  const lower = values.map((_, index) => middle[index] == null ? null : middle[index] - deviation[index] * deviations);
  const percentB = values.map((value, index) => {
    if (upper[index] == null || lower[index] == null) return null;
    const width = upper[index] - lower[index];
    return width === 0 ? 0.5 : (value - lower[index]) / width;
  });
  const bandwidth = values.map((_, index) => (
    middle[index] == null || middle[index] === 0 ? null : (upper[index] - lower[index]) / middle[index]
  ));
  return { middle, upper, lower, percentB, bandwidth };
}

function trueRange(candles) {
  return candles.map((candle, index) => {
    if (index === 0) return candle.high - candle.low;
    const previous = candles[index - 1].close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previous), Math.abs(candle.low - previous));
  });
}

function wilder(values, period) {
  const out = nils(values.length);
  if (values.length < period) return out;
  let seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  out[period - 1] = seed;
  for (let i = period; i < values.length; i += 1) out[i] = ((out[i - 1] * (period - 1)) + values[i]) / period;
  return out;
}

function atr(candles, period = 14) {
  return wilder(trueRange(candles), period);
}

function vwap(candles, { anchor = "day" } = {}) {
  const out = [];
  let weighted = 0;
  let volume = 0;
  let sessionKey = null;
  for (const candle of candles) {
    const date = new Date(candle.t);
    if (Number.isNaN(date.getTime())) throw new RangeError("Timestamp inválido para VWAP.");
    const key = anchor === "week"
      ? `${date.getUTCFullYear()}-${Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 1)) / 604800000)}`
      : date.toISOString().slice(0, 10);
    if (key !== sessionKey) {
      sessionKey = key;
      weighted = 0;
      volume = 0;
    }
    const typical = (candle.high + candle.low + candle.close) / 3;
    weighted += typical * candle.volume;
    volume += candle.volume;
    out.push(volume > 0 ? weighted / volume : null);
  }
  return out;
}

function obv(candles) {
  const out = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const direction = candles[i].close > candles[i - 1].close ? 1 : candles[i].close < candles[i - 1].close ? -1 : 0;
    out.push(out[i - 1] + direction * candles[i].volume);
  }
  return out;
}

function stochastic(candles, period = 14, smooth = 3) {
  const k = nils(candles.length);
  for (let i = period - 1; i < candles.length; i += 1) {
    const window = candles.slice(i - period + 1, i + 1);
    const highest = Math.max(...window.map((item) => item.high));
    const lowest = Math.min(...window.map((item) => item.low));
    k[i] = highest === lowest ? 50 : ((candles[i].close - lowest) / (highest - lowest)) * 100;
  }
  const start = k.findIndex((value) => value != null);
  const d = nils(candles.length);
  if (start >= 0) {
    const compact = sma(k.slice(start), smooth);
    compact.forEach((value, index) => { d[start + index] = value; });
  }
  return { k, d };
}

function adx(candles, period = 14) {
  const plusDM = [0];
  const minusDM = [0];
  for (let i = 1; i < candles.length; i += 1) {
    const up = candles[i].high - candles[i - 1].high;
    const down = candles[i - 1].low - candles[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const tr = wilder(trueRange(candles), period);
  const plus = wilder(plusDM, period);
  const minus = wilder(minusDM, period);
  const dx = nils(candles.length);
  for (let i = period - 1; i < candles.length; i += 1) {
    if (tr[i] === 0) { dx[i] = 0; continue; }
    if (!Number.isFinite(tr[i]) || !Number.isFinite(plus[i]) || !Number.isFinite(minus[i])) continue;
    const plusDI = 100 * plus[i] / tr[i];
    const minusDI = 100 * minus[i] / tr[i];
    dx[i] = plusDI + minusDI === 0 ? 0 : 100 * Math.abs(plusDI - minusDI) / (plusDI + minusDI);
  }
  const start = dx.findIndex((value) => value != null);
  const out = nils(candles.length);
  if (start >= 0) {
    const compact = wilder(dx.slice(start), period);
    compact.forEach((value, index) => { out[start + index] = value; });
  }
  return out;
}

function rateOfChange(values, period = 12) {
  return values.map((value, index) => index < period || values[index - period] === 0
    ? null
    : ((value / values[index - period]) - 1) * 100);
}

function slope(values, period = 20) {
  if (values.length < period) return null;
  const sample = values.slice(-period);
  const meanX = (period - 1) / 2;
  const meanY = sample.reduce((sum, value) => sum + value, 0) / period;
  let numerator = 0;
  let denominator = 0;
  sample.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY);
    denominator += (index - meanX) ** 2;
  });
  return denominator === 0 ? 0 : numerator / denominator;
}

function volumeProfile(candles, bins = 24, lookback = 160) {
  if (!Number.isInteger(bins) || bins < 2 || bins > 500) throw new RangeError("bins precisa ser um inteiro entre 2 e 500.");
  const sample = candles.slice(-lookback);
  if (!sample.length) return { poc: null, valueAreaLow: null, valueAreaHigh: null, nodes: [] };
  const low = Math.min(...sample.map((item) => item.low));
  const high = Math.max(...sample.map((item) => item.high));
  const totalVolume = sample.reduce((sum, item) => sum + Math.max(0, Number(item.volume) || 0), 0);
  if (!(totalVolume > 0)) return { poc: null, valueAreaLow: null, valueAreaHigh: null, nodes: [] };
  if (high === low) return { poc: round(low, 8), valueAreaLow: round(low, 8), valueAreaHigh: round(high, 8), nodes: [{ price: round(low, 8), low: round(low, 8), high: round(high, 8), volume: round(totalVolume, 2) }] };
  const step = (high - low) / bins;
  const nodes = Array.from({ length: bins }, (_, index) => ({ price: low + step * (index + 0.5), volume: 0 }));
  sample.forEach((candle) => {
    const first = Math.max(0, Math.min(bins - 1, Math.floor((candle.low - low) / step)));
    const last = Math.max(first, Math.min(bins - 1, Math.floor((Math.max(candle.low, candle.high - Number.EPSILON) - low) / step)));
    const touched = last - first + 1;
    const share = Math.max(0, Number(candle.volume) || 0) / touched;
    for (let index = first; index <= last; index += 1) nodes[index].volume += share;
  });
  const total = nodes.reduce((sum, node) => sum + node.volume, 0);
  const pocIndex = nodes.reduce((best, node, index) => node.volume > nodes[best].volume ? index : best, 0);
  const included = new Set([pocIndex]);
  let covered = nodes[pocIndex].volume;
  let left = pocIndex - 1;
  let right = pocIndex + 1;
  while (covered < total * 0.7 && (left >= 0 || right < nodes.length)) {
    const leftVolume = left >= 0 ? nodes[left].volume : -1;
    const rightVolume = right < nodes.length ? nodes[right].volume : -1;
    if (rightVolume > leftVolume) { included.add(right); covered += rightVolume; right += 1; }
    else { included.add(left); covered += Math.max(leftVolume, 0); left -= 1; }
  }
  const indices = [...included].sort((a, b) => a - b);
  return {
    poc: round(nodes[pocIndex].price, 8),
    valueAreaLow: round(low + indices[0] * step, 8),
    valueAreaHigh: round(low + (indices[indices.length - 1] + 1) * step, 8),
    nodes: nodes.map((node, index) => ({ price: round(node.price, 8), low: round(low + index * step, 8), high: round(low + (index + 1) * step, 8), volume: round(node.volume, 2) })),
  };
}

module.exports = {
  sma, ema, rsi, macd, bollinger, trueRange, atr, vwap, obv, stochastic, adx,
  rateOfChange, slope, volumeProfile, finite, round,
};
