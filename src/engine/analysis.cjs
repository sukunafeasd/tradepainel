"use strict";

const I = require("./indicators.cjs");

const at = (series, offset = 1) => series[series.length - offset];
const percent = (part, total) => total ? (part / total) * 100 : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const priceRound = (value) => Number.isFinite(value) ? Number(value.toPrecision(10)) : null;

function validateCandles(candles) {
  if (!Array.isArray(candles) || candles.length < 60) throw new Error("São necessárias pelo menos 60 velas.");
  for (const candle of candles) {
    for (const field of ["t", "open", "high", "low", "close", "volume"]) {
      if (!Number.isFinite(candle[field])) throw new Error(`Vela inválida: ${field}.`);
    }
    if (candle.high < candle.low || candle.high < candle.open || candle.high < candle.close || candle.low > candle.open || candle.low > candle.close) {
      throw new Error("OHLC inconsistente.");
    }
  }
}

function detectPivots(candles, width = 3, lookback = 180) {
  const start = Math.max(width, candles.length - lookback);
  const highs = [];
  const lows = [];
  for (let i = start; i < candles.length - width; i += 1) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - width; j <= i + width; j += 1) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: candles[i].high, t: candles[i].t });
    if (isLow) lows.push({ index: i, price: candles[i].low, t: candles[i].t });
  }
  return { highs, lows };
}

function clusterLevels(points, tolerance) {
  const clusters = [];
  for (const point of points) {
    let cluster = clusters.find((item) => Math.abs(item.price - point.price) <= tolerance);
    if (!cluster) {
      cluster = { price: point.price, touches: 0, lastIndex: point.index };
      clusters.push(cluster);
    }
    cluster.price = (cluster.price * cluster.touches + point.price) / (cluster.touches + 1);
    cluster.touches += 1;
    cluster.lastIndex = Math.max(cluster.lastIndex, point.index);
  }
  return clusters.sort((a, b) => b.touches - a.touches || b.lastIndex - a.lastIndex);
}

function supportResistance(candles, pivots, atrValue) {
  const price = at(candles).close;
  const tolerance = Math.max(atrValue * 0.35, price * 0.0008);
  const levels = clusterLevels([...pivots.highs, ...pivots.lows], tolerance)
    .filter((level) => level.touches >= 2)
    .map((level) => ({ ...level, distancePct: ((level.price / price) - 1) * 100 }));
  const supports = levels.filter((level) => level.price < price).sort((a, b) => b.price - a.price).slice(0, 4);
  const resistances = levels.filter((level) => level.price > price).sort((a, b) => a.price - b.price).slice(0, 4);
  return { supports, resistances };
}

function candleReading(candles, atrValue) {
  const current = at(candles);
  const previous = at(candles, 2);
  const body = Math.abs(current.close - current.open);
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const bullish = current.close > current.open;
  const previousBullish = previous.close > previous.open;
  const patterns = [];
  if (body / range < 0.12) patterns.push({ id: "doji", label: "Doji / indecisão", bias: 0 });
  if (lowerWick > body * 2.2 && upperWick < body * 0.9) patterns.push({ id: "hammer", label: "Rejeição compradora", bias: 1 });
  if (upperWick > body * 2.2 && lowerWick < body * 0.9) patterns.push({ id: "shooting-star", label: "Rejeição vendedora", bias: -1 });
  if (bullish && !previousBullish && current.open <= previous.close && current.close >= previous.open) {
    patterns.push({ id: "bullish-engulfing", label: "Engolfo de alta", bias: 1 });
  }
  if (!bullish && previousBullish && current.open >= previous.close && current.close <= previous.open) {
    patterns.push({ id: "bearish-engulfing", label: "Engolfo de baixa", bias: -1 });
  }
  if (body > atrValue * 0.9 && body / range > 0.68) {
    patterns.push({ id: bullish ? "bull-impulse" : "bear-impulse", label: bullish ? "Vela de impulso comprador" : "Vela de impulso vendedor", bias: bullish ? 1 : -1 });
  }
  return {
    direction: bullish ? "alta" : current.close < current.open ? "baixa" : "neutra",
    bodyPct: percent(body, range),
    upperWickPct: percent(upperWick, range),
    lowerWickPct: percent(lowerWick, range),
    patterns,
  };
}

function inferStructure(pivots, ema20, ema50, ema200, close, emaSlope) {
  const highs = pivots.highs.slice(-3);
  const lows = pivots.lows.slice(-3);
  const higherHighs = highs.length >= 2 && highs[highs.length - 1].price > highs[highs.length - 2].price;
  const higherLows = lows.length >= 2 && lows[lows.length - 1].price > lows[lows.length - 2].price;
  const lowerHighs = highs.length >= 2 && highs[highs.length - 1].price < highs[highs.length - 2].price;
  const lowerLows = lows.length >= 2 && lows[lows.length - 1].price < lows[lows.length - 2].price;
  if (higherHighs && higherLows && close > ema20 && ema20 > ema50 && emaSlope > 0) return { regime: "tendência de alta", bias: 1, hh: true, hl: true };
  if (lowerHighs && lowerLows && close < ema20 && ema20 < ema50 && emaSlope < 0) return { regime: "tendência de baixa", bias: -1, lh: true, ll: true };
  if (ema200 && close > ema200 && ema20 > ema50 && emaSlope > 0) return { regime: "alta em construção", bias: 0.65 };
  if (ema200 && close < ema200 && ema20 < ema50 && emaSlope < 0) return { regime: "baixa em construção", bias: -0.65 };
  return { regime: "lateral / transição", bias: 0 };
}

function buildRiskPlan({ signal, price, atrValue, levels, account = 10000, riskPct = 0.5 }) {
  if (signal === "AGUARDE") return null;
  const side = signal === "COMPRA" ? 1 : -1;
  const nearestLevel = side > 0 ? levels.supports[0]?.price : levels.resistances[0]?.price;
  const technicalStop = nearestLevel == null
    ? price - side * atrValue * 1.35
    : side > 0
      ? Math.min(price - atrValue * 0.9, nearestLevel - atrValue * 0.18)
      : Math.max(price + atrValue * 0.9, nearestLevel + atrValue * 0.18);
  const riskPerUnit = Math.abs(price - technicalStop);
  const target1 = price + side * riskPerUnit * 1.25;
  const target2 = price + side * riskPerUnit * 2;
  const riskBudget = Math.max(0, account) * clamp(riskPct, 0.1, 3) / 100;
  const quantity = riskPerUnit > 0 ? riskBudget / riskPerUnit : 0;
  return {
    entry: priceRound(price),
    stop: priceRound(technicalStop),
    target1: priceRound(target1),
    target2: priceRound(target2),
    invalidation: side > 0 ? "Fechamento abaixo do stop ou perda da estrutura compradora." : "Fechamento acima do stop ou perda da estrutura vendedora.",
    riskReward1: 1.25,
    riskReward2: 2,
    riskBudget: Number(riskBudget.toFixed(2)),
    suggestedQuantity: Number(quantity.toPrecision(8)),
    riskPct: clamp(riskPct, 0.1, 3),
  };
}

function analyze(candles, { symbol = "BTCUSDT", interval = "15m", micro = {}, account = 10000, riskPct = 0.5, calibration = null } = {}) {
  validateCandles(candles);
  const closes = candles.map((item) => item.close);
  const volumes = candles.map((item) => item.volume);
  const ema9 = I.ema(closes, 9);
  const ema20 = I.ema(closes, 20);
  const ema50 = I.ema(closes, 50);
  const ema200 = I.ema(closes, 200);
  const rsi14 = I.rsi(closes, 14);
  const macd = I.macd(closes);
  const bb = I.bollinger(closes);
  const atr14 = I.atr(candles, 14);
  const vwap = I.vwap(candles);
  const stochastic = I.stochastic(candles);
  const adx14 = I.adx(candles, 14);
  const obv = I.obv(candles);
  const roc = I.rateOfChange(closes, 12);
  const price = at(candles).close;
  const atrValue = at(atr14) || price * 0.005;
  const pivots = detectPivots(candles);
  const levels = supportResistance(candles, pivots, atrValue);
  const structure = inferStructure(pivots, at(ema20), at(ema50), at(ema200), price, I.slope(ema20.filter(Number.isFinite), 12) || 0);
  const candle = candleReading(candles, atrValue);
  const profile = I.volumeProfile(candles);
  const averageVolume = at(I.sma(volumes, 20)) || 0;
  const volumeRatio = averageVolume > 0 ? at(volumes) / averageVolume : 1;
  const obvSlope = I.slope(obv, 20) || 0;

  const reasons = [];
  const groupWeights = calibration?.groupWeights || {};
  const add = (points, group, label, detail) => {
    if (!points) return;
    const basePoints = points;
    const learnedWeight = clamp(Number(groupWeights[group]) || 1, 0.82, 1.18);
    reasons.push({ points: Math.round(points * learnedWeight), basePoints, learnedWeight, group, label, detail });
  };

  add(Math.round(structure.bias * 24), "estrutura", structure.regime, "Sequência de pivôs e alinhamento das médias.");
  if (at(ema9) > at(ema20) && at(ema20) > at(ema50)) add(14, "tendência", "Médias alinhadas para alta", "EMA 9 acima da 20 e da 50.");
  else if (at(ema9) < at(ema20) && at(ema20) < at(ema50)) add(-14, "tendência", "Médias alinhadas para baixa", "EMA 9 abaixo da 20 e da 50.");
  if (at(ema200) != null) add(price > at(ema200) ? 7 : -7, "macro", price > at(ema200) ? "Preço acima da EMA 200" : "Preço abaixo da EMA 200", "Viés direcional de fundo.");

  const rsiValue = at(rsi14);
  if (rsiValue >= 55 && rsiValue <= 72) add(8, "momentum", `RSI ${rsiValue.toFixed(1)} comprador`, "Força sem extremo grave.");
  else if (rsiValue <= 45 && rsiValue >= 28) add(-8, "momentum", `RSI ${rsiValue.toFixed(1)} vendedor`, "Fraqueza sem extremo grave.");
  else if (rsiValue > 78) add(-4, "exaustão", `RSI ${rsiValue.toFixed(1)} muito esticado`, "Risco de realização compradora.");
  else if (rsiValue < 22) add(4, "exaustão", `RSI ${rsiValue.toFixed(1)} muito esticado`, "Risco de repique vendedor.");

  const hist = at(macd.histogram);
  const previousHist = at(macd.histogram, 2);
  if (hist != null && previousHist != null) {
    if (hist > 0 && hist > previousHist) add(10, "momentum", "MACD acelera para cima", "Histograma positivo e crescente.");
    if (hist < 0 && hist < previousHist) add(-10, "momentum", "MACD acelera para baixo", "Histograma negativo e decrescente.");
  }

  const vwapValue = at(vwap);
  add(price > vwapValue ? 7 : -7, "fluxo", price > vwapValue ? "Preço acima da VWAP" : "Preço abaixo da VWAP", "Controle intradiário pelo preço médio ponderado.");
  if (volumeRatio >= 1.5) add(at(candles).close >= at(candles).open ? 7 : -7, "volume", `Volume ${volumeRatio.toFixed(2)}x acima da média`, "A última vela teve participação relevante.");
  if (obvSlope > 0) add(4, "volume", "OBV acumula", "Volume acompanha altas recentes.");
  else if (obvSlope < 0) add(-4, "volume", "OBV distribui", "Volume acompanha baixas recentes.");

  for (const pattern of candle.patterns) add(pattern.bias * 5, "vela", pattern.label, "Padrão detectado na vela atual.");

  if (Number.isFinite(micro.bookImbalance)) {
    if (micro.bookImbalance >= 0.58) add(8, "book", `Book comprador ${(micro.bookImbalance * 100).toFixed(0)}%`, "Maior liquidez imediata do lado comprador.");
    else if (micro.bookImbalance <= 0.42) add(-8, "book", `Book vendedor ${((1 - micro.bookImbalance) * 100).toFixed(0)}%`, "Maior liquidez imediata do lado vendedor.");
  }
  if (Number.isFinite(micro.buyRatio)) {
    if (micro.buyRatio >= 0.58) add(8, "agressão", `Agressão compradora ${(micro.buyRatio * 100).toFixed(0)}%`, "Compradores tomam mais liquidez no curto prazo.");
    else if (micro.buyRatio <= 0.42) add(-8, "agressão", `Agressão vendedora ${((1 - micro.buyRatio) * 100).toFixed(0)}%`, "Vendedores tomam mais liquidez no curto prazo.");
  }
  if (!Number.isFinite(micro.buyRatio)) {
    const recent = candles.slice(-20);
    const quote = recent.reduce((sum, item) => sum + Number(item.quoteVolume || item.volume * item.close || 0), 0);
    const taker = recent.reduce((sum, item) => sum + Number(item.takerBuyQuoteVolume || 0), 0);
    if (quote > 0 && taker > 0) {
      const ratio = taker / quote;
      if (ratio >= 0.56) add(5, "agressão", `Compradores tomaram ${(ratio * 100).toFixed(0)}% do volume`, "Agressão estimada pelas velas fechadas recentes.");
      else if (ratio <= 0.44) add(-5, "agressão", `Vendedores tomaram ${((1 - ratio) * 100).toFixed(0)}% do volume`, "Agressão estimada pelas velas fechadas recentes.");
    }
  }
  if (Number.isFinite(micro.spreadPct) && micro.spreadPct > 0.08) add(-3, "liquidez", "Spread elevado", "Execução pode sofrer mais derrapagem.");

  let rawScore = reasons.reduce((sum, reason) => sum + reason.points, 0);
  rawScore = clamp(rawScore, -100, 100);
  const adxValue = at(adx14);
  const volatilityPct = percent(atrValue, price);
  const trendQuality = adxValue == null ? 0.45 : clamp(adxValue / 45, 0, 1);
  const evidenceGroups = new Set(reasons.filter((reason) => Math.sign(reason.points) === Math.sign(rawScore)).map((reason) => reason.group)).size;
  const conflictingGroups = new Set(reasons.filter((reason) => Math.sign(reason.points) !== Math.sign(rawScore)).map((reason) => reason.group)).size;
  const rawConfidence = 34 + evidenceGroups * 7 + trendQuality * 18 + Math.min(volumeRatio, 2) * 4 - conflictingGroups * 2;
  const confidence = Math.round(clamp(rawConfidence * (Number(calibration?.confidenceFactor) || 1), 28, 92));
  const minimum = (confidence >= 68 ? 24 : 30) + clamp(Number(calibration?.thresholdAdjustment) || 0, -2, 5);
  const signal = rawScore >= minimum ? "COMPRA" : rawScore <= -minimum ? "VENDA" : "AGUARDE";
  const warnings = [];
  if (volatilityPct > 2.2) warnings.push("Volatilidade extrema: reduza o tamanho da posição.");
  if (volumeRatio < 0.55) warnings.push("Volume fraco: rompimentos têm menor qualidade.");
  if (micro.stale) warnings.push("Dados ao vivo estão atrasados; aguarde a reconexão.");
  if (signal !== "AGUARDE" && Math.sign(structure.bias) !== Math.sign(rawScore) && structure.bias !== 0) warnings.push("Sinal está contra a estrutura principal.");
  if (conflictingGroups >= 3) warnings.push("Existem grupos técnicos conflitantes; a leitura exige confirmação adicional.");
  if ((calibration?.samples || 0) > 12 && Number(calibration.reliability) < 0.46) warnings.push("A calibração recente está abaixo do esperado; o painel elevou o filtro de entrada.");

  const lastCandle = at(candles);
  const ageMs = Math.max(0, Date.now() - Number(lastCandle.closeTime || lastCandle.t || Date.now()));
  const freshnessScore = micro.stale ? 25 : ageMs > 12 * 60 * 60 * 1000 ? 55 : 100;
  const liquidityScore = Number.isFinite(micro.spreadPct) ? Math.round(clamp(100 - micro.spreadPct * 900, 20, 100)) : 72;
  const completenessScore = lastCandle.closed === false ? 88 : 100;
  const dataQualityScore = Math.round(freshnessScore * 0.45 + liquidityScore * 0.35 + completenessScore * 0.2);

  return {
    symbol,
    interval,
    ts: Date.now(),
    price: priceRound(price),
    signal,
    score: rawScore,
    confidence,
    confidenceMeaning: "qualidade da confluência, não probabilidade garantida de lucro",
    regime: structure.regime,
    structure,
    candle,
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    warnings,
    dataQuality: {
      score: dataQualityScore,
      freshness: freshnessScore,
      liquidity: liquidityScore,
      completeness: completenessScore,
      lastCandleClosed: lastCandle.closed !== false,
      ageMs,
      conflictingGroups,
      samples: candles.length,
    },
    calibration: calibration ? {
      samples: calibration.samples || 0,
      reliability: Number(calibration.reliability || 0.5),
      state: (calibration.samples || 0) < 12 ? "aquecendo" : (calibration.samples || 0) < 60 ? "calibrando" : "maduro",
      adjusted: (calibration.samples || 0) >= 12,
    } : { samples: 0, reliability: 0.5, state: "aquecendo", adjusted: false },
    indicators: {
      ema9: priceRound(at(ema9)), ema20: priceRound(at(ema20)), ema50: priceRound(at(ema50)), ema200: priceRound(at(ema200)),
      rsi: I.round(rsiValue, 2), macd: priceRound(at(macd.line)), macdSignal: priceRound(at(macd.signal)), macdHistogram: priceRound(hist),
      bollingerUpper: priceRound(at(bb.upper)), bollingerMiddle: priceRound(at(bb.middle)), bollingerLower: priceRound(at(bb.lower)), bollingerPercentB: I.round(at(bb.percentB), 3), bandwidth: I.round(at(bb.bandwidth), 4),
      atr: priceRound(atrValue), atrPct: I.round(volatilityPct, 3), vwap: priceRound(vwapValue), adx: I.round(adxValue, 2),
      stochasticK: I.round(at(stochastic.k), 2), stochasticD: I.round(at(stochastic.d), 2), obvSlope: I.round(obvSlope, 2), roc: I.round(at(roc), 3), volumeRatio: I.round(volumeRatio, 2),
    },
    levels: {
      supports: levels.supports.map((level) => ({ price: priceRound(level.price), touches: level.touches, distancePct: I.round(level.distancePct, 3) })),
      resistances: levels.resistances.map((level) => ({ price: priceRound(level.price), touches: level.touches, distancePct: I.round(level.distancePct, 3) })),
      volumeProfile: profile,
    },
    micro: {
      spreadPct: I.round(micro.spreadPct, 4), bookImbalance: I.round(micro.bookImbalance, 4), buyRatio: I.round(micro.buyRatio, 4), delta: I.round(micro.delta, 4),
    },
    plan: buildRiskPlan({ signal, price, atrValue, levels, account, riskPct }),
    series: {
      candles: candles.slice(-260),
      ema9: ema9.slice(-260).map(priceRound),
      ema20: ema20.slice(-260).map(priceRound),
      ema50: ema50.slice(-260).map(priceRound),
      vwap: vwap.slice(-260).map(priceRound),
    },
  };
}

function combineTimeframes(results) {
  const weights = { "1m": 0.7, "3m": 0.8, "5m": 1, "15m": 1.25, "30m": 1.35, "1h": 1.6, "4h": 1.9 };
  const entries = Object.entries(results).filter(([, value]) => value && !value.error);
  const totalWeight = entries.reduce((sum, [interval]) => sum + (weights[interval] || 1), 0) || 1;
  const weightedScore = entries.reduce((sum, [interval, value]) => sum + value.score * (weights[interval] || 1), 0) / totalWeight;
  const direction = weightedScore >= 18 ? "COMPRA" : weightedScore <= -18 ? "VENDA" : "AGUARDE";
  const aligned = entries.filter(([, value]) => value.signal === direction).length;
  return {
    signal: direction,
    score: Math.round(weightedScore),
    alignment: entries.length ? Math.round((aligned / entries.length) * 100) : 0,
    frames: Object.fromEntries(entries.map(([interval, value]) => [interval, { signal: value.signal, score: value.score, regime: value.regime, price: value.price }])),
  };
}

module.exports = { analyze, combineTimeframes, validateCandles, detectPivots, supportResistance, candleReading, buildRiskPlan };
