"use strict";

const I = require("./indicators.cjs");
const { cleanInterval, cleanSymbol, validTimestamp } = require("./contracts.cjs");

const at = (series, offset = 1) => series[series.length - offset];
const percent = (part, total) => total ? (part / total) * 100 : 0;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const priceRound = (value) => Number.isFinite(value) ? Number(value.toPrecision(10)) : null;
const INTERVAL_MS = { "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000, "8h": 28800000, "12h": 43200000, "1d": 86400000 };
const SHORT_MICRO_INTERVALS = new Set(["1m", "3m", "5m"]);

function validateCandles(candles, { interval = null, minimum = 200 } = {}) {
  if (!Array.isArray(candles) || candles.length < minimum) throw new Error(`São necessárias pelo menos ${minimum} velas válidas.`);
  const expected = interval ? INTERVAL_MS[cleanInterval(interval)] : null;
  let previous = null;
  let gaps = 0;
  for (const candle of candles) {
    for (const field of ["t", "open", "high", "low", "close", "volume"]) {
      if (!Number.isFinite(candle[field])) throw new Error(`Vela inválida: ${field}.`);
    }
    validTimestamp(candle.t, "Timestamp da vela");
    if (!(candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0) || candle.volume < 0) throw new Error("Preço/volume inválido na série de velas.");
    if (candle.high < candle.low || candle.high < candle.open || candle.high < candle.close || candle.low > candle.open || candle.low > candle.close) throw new Error("OHLC inconsistente.");
    if (previous != null) {
      const distance = candle.t - previous;
      if (distance <= 0) throw new Error(distance === 0 ? "A série possui timestamps duplicados." : "As velas estão fora de ordem.");
      if (expected && distance !== expected) gaps += 1;
    }
    previous = candle.t;
  }
  return { gaps, expectedIntervalMs: expected };
}

function detectPivots(candles, width = 3, lookback = 180) {
  const start = Math.max(width, candles.length - lookback);
  const highs = [];
  const lows = [];
  for (let i = start; i < candles.length - width; i += 1) {
    const neighbors = candles.slice(i - width, i + width + 1);
    const maxHigh = Math.max(...neighbors.map((item) => item.high));
    const minLow = Math.min(...neighbors.map((item) => item.low));
    if (candles[i].high === maxHigh && neighbors.findIndex((item) => item.high === maxHigh) === width) highs.push({ index: i, price: candles[i].high, t: candles[i].t, type: "resistance" });
    if (candles[i].low === minLow && neighbors.findIndex((item) => item.low === minLow) === width) lows.push({ index: i, price: candles[i].low, t: candles[i].t, type: "support" });
  }
  return { highs, lows };
}

function clusterLevels(points, tolerance) {
  const sorted = [...points].sort((a, b) => a.price - b.price || a.index - b.index);
  const clusters = [];
  for (const point of sorted) {
    const previous = clusters.at(-1);
    if (!previous || Math.abs(previous.price - point.price) > tolerance) {
      clusters.push({ price: point.price, touches: 1, lastIndex: point.index, supportTouches: point.type === "support" ? 1 : 0, resistanceTouches: point.type === "resistance" ? 1 : 0 });
      continue;
    }
    previous.price = (previous.price * previous.touches + point.price) / (previous.touches + 1);
    previous.touches += 1;
    previous.lastIndex = Math.max(previous.lastIndex, point.index);
    previous.supportTouches += point.type === "support" ? 1 : 0;
    previous.resistanceTouches += point.type === "resistance" ? 1 : 0;
  }
  return clusters;
}

function supportResistance(candles, pivots, atrValue) {
  const price = at(candles).close;
  const tolerance = Math.max(Math.max(atrValue, 0) * 0.35, price * 0.0008);
  const lastIndex = candles.length - 1;
  const levels = clusterLevels([...pivots.highs, ...pivots.lows], tolerance)
    .filter((level) => level.touches >= 2)
    .map((level) => {
      const distancePct = ((level.price / price) - 1) * 100;
      const recency = 1 / (1 + Math.max(0, lastIndex - level.lastIndex) / 40);
      const strength = level.touches * 2 + recency * 2;
      return { ...level, distancePct, strength: Number(strength.toFixed(3)), role: level.supportTouches > level.resistanceTouches ? "support" : level.resistanceTouches > level.supportTouches ? "resistance" : "flip" };
    });
  const rank = (a, b) => (Math.abs(a.distancePct) + 0.6 / a.strength) - (Math.abs(b.distancePct) + 0.6 / b.strength);
  const equal = levels.filter((level) => Math.abs(level.price - price) <= tolerance / 2).sort((a, b) => b.strength - a.strength);
  const supports = levels.filter((level) => level.price < price).sort(rank).slice(0, 4);
  const resistances = levels.filter((level) => level.price > price).sort(rank).slice(0, 4);
  return { supports, resistances, atPrice: equal.slice(0, 2), tolerance };
}

function candleReading(candles, atrValue, structureBias = 0) {
  const current = at(candles);
  const previous = at(candles, 2);
  const body = Math.abs(current.close - current.open);
  const range = Math.max(current.high - current.low, Number.EPSILON);
  const upperWick = current.high - Math.max(current.open, current.close);
  const lowerWick = Math.min(current.open, current.close) - current.low;
  const bullish = current.close > current.open;
  const bearish = current.close < current.open;
  const previousBullish = previous.close > previous.open;
  const previousBearish = previous.close < previous.open;
  const patterns = [];
  if (body / range < 0.12) patterns.push({ id: "doji", label: "Doji / indecisão", bias: 0 });
  if (structureBias <= 0 && lowerWick > Math.max(body, range * 0.04) * 2.2 && upperWick < Math.max(body, range * 0.04) * 0.9) patterns.push({ id: "hammer", label: "Rejeição compradora em contexto de queda/transição", bias: 1 });
  if (structureBias >= 0 && upperWick > Math.max(body, range * 0.04) * 2.2 && lowerWick < Math.max(body, range * 0.04) * 0.9) patterns.push({ id: "shooting-star", label: "Rejeição vendedora em contexto de alta/transição", bias: -1 });
  if (bullish && previousBearish && current.open <= previous.close && current.close >= previous.open) patterns.push({ id: "bullish-engulfing", label: "Engolfo de alta", bias: 1 });
  if (bearish && previousBullish && current.open >= previous.close && current.close <= previous.open) patterns.push({ id: "bearish-engulfing", label: "Engolfo de baixa", bias: -1 });
  if (body > Math.max(atrValue, Number.EPSILON) * 0.9 && body / range > 0.68 && (bullish || bearish)) patterns.push({ id: bullish ? "bull-impulse" : "bear-impulse", label: bullish ? "Vela de impulso comprador" : "Vela de impulso vendedor", bias: bullish ? 1 : -1 });
  return { direction: bullish ? "alta" : bearish ? "baixa" : "neutra", bodyPct: percent(body, range), upperWickPct: percent(upperWick, range), lowerWickPct: percent(lowerWick, range), patterns };
}

function inferStructure(pivots, ema20, ema50, ema200, close, emaSlope) {
  const highs = pivots.highs.slice(-3);
  const lows = pivots.lows.slice(-3);
  const lastHigh = highs.at(-1);
  const previousHigh = highs.at(-2);
  const lastLow = lows.at(-1);
  const previousLow = lows.at(-2);
  const chronological = lastHigh && previousHigh && lastLow && previousLow && Math.max(previousHigh.index, previousLow.index) < Math.max(lastHigh.index, lastLow.index);
  const higherHighs = chronological && lastHigh.price > previousHigh.price;
  const higherLows = chronological && lastLow.price > previousLow.price;
  const lowerHighs = chronological && lastHigh.price < previousHigh.price;
  const lowerLows = chronological && lastLow.price < previousLow.price;
  if (higherHighs && higherLows && close > ema20 && ema20 > ema50 && emaSlope > 0) return { regime: "tendência de alta", bias: 1, hh: true, hl: true };
  if (lowerHighs && lowerLows && close < ema20 && ema20 < ema50 && emaSlope < 0) return { regime: "tendência de baixa", bias: -1, lh: true, ll: true };
  if (Number.isFinite(ema200) && close > ema200 && ema20 > ema50 && emaSlope > 0) return { regime: "alta em construção", bias: 0.65 };
  if (Number.isFinite(ema200) && close < ema200 && ema20 < ema50 && emaSlope < 0) return { regime: "baixa em construção", bias: -0.65 };
  return { regime: "lateral / transição", bias: 0 };
}

function selectPlanLevel(rows, price, atrValue) {
  return (rows || []).filter((level) => Math.abs(level.price - price) <= Math.max(atrValue * 4, price * 0.04)).sort((a, b) => b.strength - a.strength || Math.abs(a.distancePct) - Math.abs(b.distancePct))[0]?.price ?? null;
}

function buildRiskPlan({ signal, price, atrValue, levels, account = 10000, riskPct = 0.5, spreadPct = 0 }) {
  if (signal === "AGUARDE" || !(price > 0) || !(atrValue >= 0)) return null;
  const side = signal === "COMPRA" ? 1 : -1;
  const nearestLevel = selectPlanLevel(side > 0 ? levels.supports : levels.resistances, price, atrValue);
  const technicalStop = nearestLevel == null
    ? price - side * Math.max(atrValue, price * 0.001) * 1.35
    : side > 0 ? Math.min(price - Math.max(atrValue, price * 0.001) * 0.9, nearestLevel - Math.max(atrValue, price * 0.001) * 0.18) : Math.max(price + Math.max(atrValue, price * 0.001) * 0.9, nearestLevel + Math.max(atrValue, price * 0.001) * 0.18);
  if (!(technicalStop > 0)) return null;
  const riskPerUnit = Math.abs(price - technicalStop);
  if (!(riskPerUnit > 0)) return null;
  const target1Raw = price + side * riskPerUnit * 1.25;
  const target2Raw = price + side * riskPerUnit * 2;
  const obstacle = side > 0 ? (levels.resistances || []).filter((level) => level.price > price).sort((a, b) => a.price - b.price)[0] : (levels.supports || []).filter((level) => level.price < price).sort((a, b) => b.price - a.price)[0];
  const obstacleBeforeTarget = obstacle && (side > 0 ? obstacle.price < target2Raw : obstacle.price > target2Raw);
  const padding = Math.max(atrValue * 0.08, price * 0.0002);
  const adjustedTarget = obstacleBeforeTarget ? obstacle.price - side * padding : target2Raw;
  const minimumReward = Math.max(riskPerUnit * 0.25, price * 0.000001);
  const adjustedOnCorrectSide = side > 0 ? adjustedTarget > price + minimumReward : adjustedTarget < price - minimumReward;
  const target2 = adjustedOnCorrectSide ? adjustedTarget : target2Raw;
  const target1Candidate = side > 0 ? Math.min(target1Raw, target2) : Math.max(target1Raw, target2);
  const target1 = side > 0 ? Math.max(price + minimumReward, target1Candidate) : Math.min(price - minimumReward, target1Candidate);
  const cleanAccount = Math.max(0, Number(account) || 0);
  const riskBudget = cleanAccount * clamp(Number(riskPct) || 0.5, 0.1, 3) / 100;
  const riskQuantity = riskBudget / riskPerUnit;
  const cashQuantity = cleanAccount / price;
  const quantity = Math.max(0, Math.min(riskQuantity, cashQuantity));
  const effectiveRisk = riskPerUnit + price * Math.max(0, Number(spreadPct) || 0) / 100;
  const effectiveReward = Math.abs(target2 - price) - price * Math.max(0, Number(spreadPct) || 0) / 100;
  return {
    entry: priceRound(price), stop: priceRound(technicalStop), target1: priceRound(target1), target2: priceRound(target2),
    invalidation: side > 0 ? "Fechamento abaixo do stop ou perda da estrutura compradora." : "Fechamento acima do stop ou perda da estrutura vendedora.",
    riskReward1: Number((Math.abs(target1 - price) / effectiveRisk).toFixed(2)), riskReward2: Number((Math.max(0, effectiveReward) / effectiveRisk).toFixed(2)),
    riskBudget: Number(riskBudget.toFixed(2)), suggestedQuantity: Number(quantity.toPrecision(8)), notional: Number((quantity * price).toFixed(2)), leverageRequired: false,
    riskPct: clamp(Number(riskPct) || 0.5, 0.1, 3), obstacle: obstacleBeforeTarget ? priceRound(obstacle.price) : null,
    executionNote: "Quantidade educativa limitada ao saldo, sem alavancagem; ajuste a tickSize/stepSize da corretora antes de qualquer uso externo.",
  };
}

function analyze(candles, { symbol = "BTCUSDT", interval = "15m", micro = {}, account = 10000, riskPct = 0.5, calibration = null, now = Date.now() } = {}) {
  const cleanSymbolValue = cleanSymbol(symbol);
  const cleanIntervalValue = cleanInterval(interval);
  validateCandles(candles, { interval: cleanIntervalValue, minimum: 200 });
  const confirmed = candles.filter((item) => item.closed !== false);
  if (confirmed.length < 200) throw new Error("Dados insuficientes: são necessárias 200 velas fechadas para EMA 200.");
  const calc = confirmed;
  const validation = validateCandles(calc, { interval: cleanIntervalValue, minimum: 200 });
  const closes = calc.map((item) => item.close);
  const volumes = calc.map((item) => item.volume);
  const ema9 = I.ema(closes, 9); const ema20 = I.ema(closes, 20); const ema50 = I.ema(closes, 50); const ema200 = I.ema(closes, 200);
  const rsi14 = I.rsi(closes, 14); const macd = I.macd(closes); const bb = I.bollinger(closes); const atr14 = I.atr(calc, 14);
  const vwapAllowed = !["4h", "6h", "8h", "12h", "1d"].includes(cleanIntervalValue);
  const vwap = I.vwap(calc, { anchor: cleanIntervalValue === "1h" || cleanIntervalValue === "2h" ? "week" : "day" });
  const stochastic = I.stochastic(calc); const adx14 = I.adx(calc, 14); const obv = I.obv(calc); const roc = I.rateOfChange(closes, 12);
  const price = at(calc).close;
  const atrRaw = at(atr14);
  const atrValue = Number.isFinite(atrRaw) ? atrRaw : null;
  if (atrValue == null) throw new Error("ATR indisponível para a amostra atual.");
  const pivots = detectPivots(calc);
  const levels = supportResistance(calc, pivots, atrValue);
  const structure = inferStructure(pivots, at(ema20), at(ema50), at(ema200), price, I.slope(ema20.filter(Number.isFinite), 12) || 0);
  const candle = candleReading(calc, atrValue, structure.bias);
  const profile = I.volumeProfile(calc);
  const previousVolumes = volumes.slice(-21, -1);
  const averageVolume = previousVolumes.length ? previousVolumes.reduce((sum, value) => sum + value, 0) / previousVolumes.length : 0;
  const volumeRatio = averageVolume > 0 ? at(volumes) / averageVolume : null;
  const obvSlope = I.slope(obv, 20) || 0;
  const reasons = [];
  const groupWeights = calibration?.groupWeights || {};
  const add = (points, group, label, detail) => {
    if (!Number.isFinite(points) || points === 0) return;
    const basePoints = points;
    const learnedWeight = clamp(Number(groupWeights[group]) || 1, 0.82, 1.18);
    reasons.push({ points: Math.round(points * learnedWeight), basePoints, learnedWeight, group, label, detail });
  };

  add(Math.round(structure.bias * 24), "estrutura", structure.regime, "Sequência temporal de pivôs e alinhamento das médias.");
  if (at(ema9) > at(ema20) && at(ema20) > at(ema50)) add(14, "tendência", "Médias alinhadas para alta", "EMA 9 acima da 20 e da 50.");
  else if (at(ema9) < at(ema20) && at(ema20) < at(ema50)) add(-14, "tendência", "Médias alinhadas para baixa", "EMA 9 abaixo da 20 e da 50.");
  if (Number.isFinite(at(ema200))) {
    if (price > at(ema200)) add(7, "macro", "Preço acima da EMA 200", "Viés direcional de fundo.");
    else if (price < at(ema200)) add(-7, "macro", "Preço abaixo da EMA 200", "Viés direcional de fundo.");
  }
  const rsiValue = at(rsi14);
  if (rsiValue >= 55 && rsiValue <= 72) add(8, "momentum", `RSI ${rsiValue.toFixed(1)} comprador`, "Força sem extremo grave.");
  else if (rsiValue <= 45 && rsiValue >= 28) add(-8, "momentum", `RSI ${rsiValue.toFixed(1)} vendedor`, "Fraqueza sem extremo grave.");
  else if (rsiValue > 78) add(-4, "exaustão", `RSI ${rsiValue.toFixed(1)} muito esticado`, "Risco de realização compradora.");
  else if (rsiValue < 22) add(4, "exaustão", `RSI ${rsiValue.toFixed(1)} muito esticado`, "Risco de repique vendedor.");
  const hist = at(macd.histogram); const previousHist = at(macd.histogram, 2);
  if (Number.isFinite(hist) && Number.isFinite(previousHist)) {
    if (hist > 0 && hist > previousHist) add(10, "momentum", "MACD acelera para cima", "Histograma positivo e crescente.");
    if (hist < 0 && hist < previousHist) add(-10, "momentum", "MACD acelera para baixo", "Histograma negativo e decrescente.");
  }
  const vwapValue = at(vwap);
  if (vwapAllowed && Number.isFinite(vwapValue)) {
    if (price > vwapValue) add(7, "fluxo", "Preço acima da VWAP", "Controle pelo preço médio ponderado da sessão.");
    else if (price < vwapValue) add(-7, "fluxo", "Preço abaixo da VWAP", "Controle pelo preço médio ponderado da sessão.");
  }
  if (Number.isFinite(volumeRatio) && volumeRatio >= 1.5) {
    if (at(calc).close > at(calc).open) add(7, "volume", `Volume ${volumeRatio.toFixed(2)}x acima da média`, "A última vela fechada teve participação compradora relevante.");
    else if (at(calc).close < at(calc).open) add(-7, "volume", `Volume ${volumeRatio.toFixed(2)}x acima da média`, "A última vela fechada teve participação vendedora relevante.");
  }
  if (obvSlope > 0) add(4, "volume", "OBV acumula", "Volume acompanha altas recentes.");
  else if (obvSlope < 0) add(-4, "volume", "OBV distribui", "Volume acompanha baixas recentes.");
  for (const pattern of candle.patterns) add(pattern.bias * 5, "vela", pattern.label, "Padrão confirmado na última vela fechada.");

  const useMicro = SHORT_MICRO_INTERVALS.has(cleanIntervalValue) && micro.stale === false;
  if (useMicro && Number.isFinite(micro.bookImbalance)) {
    if (micro.bookImbalance >= 0.58) add(6, "book", `Book comprador ${(micro.bookImbalance * 100).toFixed(0)}%`, "Pressão imediata ponderada por distância ao preço.");
    else if (micro.bookImbalance <= 0.42) add(-6, "book", `Book vendedor ${((1 - micro.bookImbalance) * 100).toFixed(0)}%`, "Pressão imediata ponderada por distância ao preço.");
  }
  if (useMicro && Number.isFinite(micro.buyRatio)) {
    if (micro.buyRatio >= 0.58) add(7, "agressão", `Agressão compradora ${(micro.buyRatio * 100).toFixed(0)}%`, "Compradores tomam mais liquidez nos últimos 60 segundos.");
    else if (micro.buyRatio <= 0.42) add(-7, "agressão", `Agressão vendedora ${((1 - micro.buyRatio) * 100).toFixed(0)}%`, "Vendedores tomam mais liquidez nos últimos 60 segundos.");
  }
  if (!useMicro || !Number.isFinite(micro.buyRatio)) {
    const recent = calc.slice(-20);
    const completeAggression=recent.every(item=>Number.isFinite(item.quoteVolume)&&item.quoteVolume>=0&&Number.isFinite(item.takerBuyQuoteVolume)&&item.takerBuyQuoteVolume>=0&&item.takerBuyQuoteVolume<=item.quoteVolume);
    const quote = recent.reduce((sum, item) => sum + Number(item.quoteVolume || 0), 0);
    const taker = recent.reduce((sum, item) => sum + Number(item.takerBuyQuoteVolume || 0), 0);
    if (completeAggression && quote > 0 && taker >= 0) {
      const ratio = taker / quote;
      if (ratio >= 0.56) add(5, "agressão", `Compradores tomaram ${(ratio * 100).toFixed(0)}% do volume fechado`, "Agressão estimada por velas confirmadas.");
      else if (ratio <= 0.44) add(-5, "agressão", `Vendedores tomaram ${((1 - ratio) * 100).toFixed(0)}% do volume fechado`, "Agressão estimada por velas confirmadas.");
    }
  }

  const rawSum = reasons.reduce((sum, reason) => sum + reason.points, 0);
  const rawScore = clamp(rawSum, -100, 100);
  const directionSign = Math.sign(rawScore);
  const aligned = reasons.filter((reason) => Math.sign(reason.points) === directionSign);
  const conflicting = reasons.filter((reason) => Math.sign(reason.points) === -directionSign);
  const alignedStrength = aligned.reduce((sum, reason) => sum + Math.abs(reason.points), 0);
  const conflictStrength = conflicting.reduce((sum, reason) => sum + Math.abs(reason.points), 0);
  const adxValue = at(adx14);
  const trendAligned = Number.isFinite(adxValue) && structure.bias !== 0 && Math.sign(structure.bias) === directionSign;
  const trendQuality = trendAligned ? clamp(adxValue / 45, 0, 1) : 0;
  const evidenceGroups = new Set(aligned.map((reason) => reason.group)).size;
  const conflictingGroups = new Set(conflicting.map((reason) => reason.group)).size;
  const strengthQuality = alignedStrength + conflictStrength ? alignedStrength / (alignedStrength + conflictStrength) : 0;
  const volumeDirection = Math.sign(Number(at(calc).close) - Number(at(calc).open));
  const volumeQuality = Number.isFinite(volumeRatio) && directionSign !== 0 && volumeDirection === directionSign ? clamp(volumeRatio / 2, 0, 1) : 0;
  let rawConfidence = 10 + evidenceGroups * 7 + strengthQuality * 35 + trendQuality * 12 + volumeQuality * 5 - conflictingGroups * 5;
  const usableSpreadPct = useMicro && Number.isFinite(micro.spreadPct) ? micro.spreadPct : null;
  if (Number.isFinite(usableSpreadPct) && usableSpreadPct > 0.08) rawConfidence -= Math.min(20, usableSpreadPct * 80);
  const confidence = Math.round(clamp(rawConfidence * (Number(calibration?.confidenceFactor) || 1), 0, 92));
  const minimum = 30 + clamp(Number(calibration?.thresholdAdjustment) || 0, -2, 5);
  let signal = rawScore >= minimum ? "COMPRA" : rawScore <= -minimum ? "VENDA" : "AGUARDE";
  const volatilityPct = percent(atrValue, price);
  const volatilityLimit = { "1m": 0.8, "3m": 1.1, "5m": 1.4, "15m": 2.2, "30m": 3, "1h": 4, "2h": 5, "4h": 7, "6h": 9, "8h": 10, "12h": 12, "1d": 18 }[cleanIntervalValue];
  const warnings = [];
  if (volatilityPct > volatilityLimit) warnings.push("Volatilidade extrema para este tempo gráfico: reduza o tamanho da posição.");
  if (!Number.isFinite(volumeRatio)) warnings.push("Volume indisponível: VWAP e confirmação de volume não influenciaram a leitura.");
  else if (volumeRatio < 0.55) warnings.push("Volume fraco: rompimentos têm menor qualidade.");
  if (micro.stale !== false && SHORT_MICRO_INTERVALS.has(cleanIntervalValue)) warnings.push("Microestrutura indisponível ou atrasada; book e agressão foram excluídos do score.");
  if (Number.isFinite(usableSpreadPct) && usableSpreadPct > 0.08) warnings.push("Spread elevado reduziu a qualidade, sem criar viés de compra ou venda.");
  if (signal !== "AGUARDE" && structure.bias !== 0 && Math.sign(structure.bias) !== Math.sign(rawScore)) warnings.push("Sinal contra a estrutura principal: o plano foi bloqueado.");
  if (conflictingGroups >= 3) warnings.push("Existem grupos técnicos conflitantes; a leitura exige confirmação adicional.");
  if (validation.gaps) warnings.push(`A série possui ${validation.gaps} gap(s) temporal(is); interprete com cautela.`);
  const latest = at(calc);
  const latestDataAt = Number(latest.closeTime || latest.t);
  const ageMs = Math.max(0, now - latestDataAt);
  const expectedAge = INTERVAL_MS[cleanIntervalValue] * 1.5;
  const freshnessScore = ageMs > expectedAge * 3 ? 0 : ageMs > expectedAge ? 45 : 100;
  const liquidityScore = Number.isFinite(usableSpreadPct) ? Math.round(clamp(100 - usableSpreadPct * 900, 0, 100)) : 65;
  const completenessScore = validation.gaps ? Math.max(30, 100 - validation.gaps * 10) : 100;
  const dataQualityScore = Math.round(freshnessScore * 0.45 + liquidityScore * 0.35 + completenessScore * 0.2);
  const contraStructure = signal !== "AGUARDE" && structure.bias !== 0 && Math.sign(structure.bias) !== Math.sign(rawScore);
  const technicalSignal = signal,blockers=[];
  if(ageMs>expectedAge)blockers.push('Velas fechadas atrasadas.');
  if(validation.gaps)blockers.push('Histórico com lacunas temporais.');
  if(!Number.isFinite(volumeRatio)||volumeRatio<.55)blockers.push('Volume insuficiente para confirmar a leitura.');
  if(volatilityPct>volatilityLimit)blockers.push('Volatilidade acima do limite deste período.');
  if(conflictingGroups>=3)blockers.push('Conflito entre grupos de evidências.');
  if(contraStructure)blockers.push('Direção contrária à estrutura principal.');
  if(confidence<65||dataQualityScore<65)blockers.push('Qualidade insuficiente para confirmação.');
  if(blockers.length)signal='AGUARDE';
  const plan = contraStructure ? null : buildRiskPlan({ signal, price, atrValue, levels, account, riskPct, spreadPct: usableSpreadPct || 0 });

  return {
    id: `${cleanSymbolValue}|${cleanIntervalValue}|${latest.t}|${now}`,
    symbol: cleanSymbolValue, interval: cleanIntervalValue, ts: now, calculatedAt: now, latestCandleOpenTime: latest.t, latestCandleCloseTime: latest.closeTime || latest.t + INTERVAL_MS[cleanIntervalValue] - 1,
    marketDataAgeMs: ageMs, microDataAgeMs: Number.isFinite(micro.ageMs) ? micro.ageMs : null, price: priceRound(price), signal, score: rawScore, rawScoreSum: rawSum, threshold: minimum, confidence,
    confidenceMeaning: "qualidade das evidências alinhadas, não probabilidade garantida de lucro", regime: structure.regime, structure, candle,
    decision:{technicalSignal,blockers,policy:'conservative-simulation-v1'},
    reasons: reasons.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)), warnings,
    dataQuality: { score: dataQualityScore, freshness: freshnessScore, liquidity: liquidityScore, completeness: completenessScore, lastCandleClosed: true, ageMs, conflictingGroups, samples: calc.length, gaps: validation.gaps },
    calibration: calibration ? (() => {
      const pairSamples = Math.max(0, Number(calibration.pairSamples) || 0);
      const applied = calibration.applied === true;
      return {
        // `samples` remains for backwards-compatible renderers, but now always
        // means samples for this exact symbol+timeframe (never the global total).
        samples: pairSamples,
        pairSamples,
        globalSamples: Math.max(0, Number(calibration.samples) || 0),
        reliability: Number(calibration.reliability || 0.5),
        state: pairSamples < 12 ? "aquecendo" : pairSamples < 60 ? "calibrando" : "maduro",
        adjusted: applied,
        applied,
      };
    })() : { samples: 0, pairSamples: 0, globalSamples: 0, reliability: 0.5, state: "aquecendo", adjusted: false, applied: false },
    indicators: { ema9: priceRound(at(ema9)), ema20: priceRound(at(ema20)), ema50: priceRound(at(ema50)), ema200: priceRound(at(ema200)), rsi: I.round(rsiValue, 2), macd: priceRound(at(macd.line)), macdSignal: priceRound(at(macd.signal)), macdHistogram: priceRound(hist), bollingerUpper: priceRound(at(bb.upper)), bollingerMiddle: priceRound(at(bb.middle)), bollingerLower: priceRound(at(bb.lower)), bollingerPercentB: I.round(at(bb.percentB), 3), bandwidth: I.round(at(bb.bandwidth), 4), atr: priceRound(atrValue), atrPct: I.round(volatilityPct, 3), vwap: vwapAllowed ? priceRound(vwapValue) : null, adx: I.round(adxValue, 2), stochasticK: I.round(at(stochastic.k), 2), stochasticD: I.round(at(stochastic.d), 2), obvSlope: I.round(obvSlope, 2), roc: I.round(at(roc), 3), volumeRatio: I.round(volumeRatio, 2) },
    levels: { supports: levels.supports.map((level) => ({ price: priceRound(level.price), touches: level.touches, supportTouches: level.supportTouches, resistanceTouches: level.resistanceTouches, strength: level.strength, role: level.role, distancePct: I.round(level.distancePct, 3) })), resistances: levels.resistances.map((level) => ({ price: priceRound(level.price), touches: level.touches, supportTouches: level.supportTouches, resistanceTouches: level.resistanceTouches, strength: level.strength, role: level.role, distancePct: I.round(level.distancePct, 3) })), atPrice: levels.atPrice, volumeProfile: profile },
    micro: { used: useMicro, stale: micro.stale !== false, spreadPct: Number.isFinite(usableSpreadPct) ? I.round(usableSpreadPct, 4) : null, bookImbalance: useMicro ? I.round(micro.bookImbalance, 4) : null, buyRatio: useMicro ? I.round(micro.buyRatio, 4) : null, delta: useMicro ? I.round(micro.delta, 4) : null, deltaQuote: useMicro ? I.round(micro.deltaQuote, 2) : null },
    plan,
    series: { candles: calc.slice(-500), ema9: ema9.slice(-500).map(priceRound), ema20: ema20.slice(-500).map(priceRound), ema50: ema50.slice(-500).map(priceRound), vwap: vwap.slice(-500).map(priceRound) },
  };
}

function combineTimeframes(results, { expectedFrames = Object.keys(results), minimumCoverage = 0.6 } = {}) {
  const weights = { "1m": 0.7, "3m": 0.8, "5m": 1, "15m": 1.25, "30m": 1.35, "1h": 1.6, "2h": 1.75, "4h": 1.9, "1d": 2.2 };
  const available = expectedFrames.filter((interval) => results[interval] && !results[interval].error);
  const failed = expectedFrames.filter((interval) => !results[interval] || results[interval].error).map((interval) => ({ interval, error: results[interval]?.error || "indisponível" }));
  const coverage = expectedFrames.length ? available.length / expectedFrames.length : 0;
  if (!available.length) return { status: "unavailable", signal: "INDISPONÍVEL", score: null, scoreExact: null, alignment: 0, available: 0, expected: expectedFrames.length, coverage: 0, frames: {}, failed };
  const effectiveWeight = (interval, value) => (weights[interval] || 1) * clamp(Number(value.confidence || 0) / 100, 0.1, 0.92) * clamp(Number(value.dataQuality?.score || 0) / 100, 0.1, 1);
  const totalWeight = available.reduce((sum, interval) => sum + effectiveWeight(interval, results[interval]), 0) || 1;
  const weightedScore = available.reduce((sum, interval) => sum + results[interval].score * effectiveWeight(interval, results[interval]), 0) / totalWeight;
  const directional = available.filter((interval) => ["COMPRA", "VENDA"].includes(results[interval].signal));
  const buyWeight = directional.filter((interval) => results[interval].signal === "COMPRA").reduce((sum, interval) => sum + effectiveWeight(interval, results[interval]), 0);
  const sellWeight = directional.filter((interval) => results[interval].signal === "VENDA").reduce((sum, interval) => sum + effectiveWeight(interval, results[interval]), 0);
  const candidate = weightedScore >= 30 && buyWeight > sellWeight ? "COMPRA" : weightedScore <= -30 && sellWeight > buyWeight ? "VENDA" : "AGUARDE";
  const directionWeight = candidate === "COMPRA" ? buyWeight : candidate === "VENDA" ? sellWeight : 0;
  const alignment = totalWeight ? Math.round((directionWeight / totalWeight) * 100) : 0;
  const signal = coverage < minimumCoverage ? "AGUARDE" : candidate;
  return {
    status: coverage < minimumCoverage ? "partial" : "ready", signal, candidate, score: Math.round(weightedScore), scoreExact: Number(weightedScore.toFixed(4)), alignment,
    available: available.length, expected: expectedFrames.length, coverage: Math.round(coverage * 100), failed,
    frames: Object.fromEntries(available.map((interval) => { const value = results[interval]; return [interval, { signal: value.signal, score: value.score, confidence: value.confidence, dataQuality: value.dataQuality?.score, regime: value.regime, price: value.price, ts: value.ts }]; })),
  };
}

function applyMtfGate(analysis, multiTimeframe) {
  const gated = structuredClone(analysis);
  gated.singleTimeframeSignal = analysis.signal;
  gated.multiTimeframe = multiTimeframe;
  const compatible = multiTimeframe?.status === "ready" && multiTimeframe.signal === analysis.signal && analysis.signal !== "AGUARDE";
  if (!compatible) {
    gated.signal = "AGUARDE";
    gated.plan = null;
    const reason = multiTimeframe?.status === "unavailable" ? "Confluência multi-timeframe indisponível." : multiTimeframe?.coverage < 60 ? `Cobertura MTF insuficiente (${multiTimeframe.coverage || 0}%).` : `Sinal individual ${analysis.signal} não foi confirmado pelo MTF (${multiTimeframe?.signal || "indisponível"}).`;
    gated.warnings = [reason, ...(gated.warnings || [])];
  }
  return gated;
}

module.exports = { analyze, combineTimeframes, applyMtfGate, validateCandles, detectPivots, clusterLevels, supportResistance, candleReading, buildRiskPlan, INTERVAL_MS };
