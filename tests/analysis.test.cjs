"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, combineTimeframes, applyMtfGate, validateCandles, buildRiskPlan } = require("../src/engine/analysis.cjs");

const spacing = { "1m": 60_000, "15m": 900_000 };
function candles(direction = 1, interval = "15m") {
  return Array.from({ length: 500 }, (_, i) => {
    const base = 100 + direction * i * 0.08 + Math.sin(i / 8) * 1.2;
    const open = base - direction * 0.07;
    const close = base + direction * 0.07;
    return { t: 1700000000000 + i * spacing[interval], open, high: Math.max(open, close) + .35, low: Math.min(open, close) - .35, close, volume: 1000 + i * 2, quoteVolume: (1000 + i * 2) * close };
  });
}

test("análise produz leitura explicável e série gráfica", () => {
  const result = analyze(candles(1), { symbol: "BTCUSDT", interval: "15m", micro: { buyRatio: .64, bookImbalance: .6, spreadPct: .01, delta: 20 } });
  assert.equal(result.symbol, "BTCUSDT");
  assert.ok(["COMPRA", "VENDA", "AGUARDE"].includes(result.signal));
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
  assert.ok(result.reasons.length > 3);
  assert.equal(result.series.candles.length, 500);
  assert.match(result.confidenceMeaning, /não probabilidade/i);
});

test("confluência agrega timeframes sem prometer probabilidade", () => {
  const up = analyze(candles(1, "15m"), { interval: "15m" });
  const down = analyze(candles(-1, "15m"), { interval: "15m" });
  const value = combineTimeframes({ "1m": up, "5m": up, "15m": down });
  assert.ok(["COMPRA", "VENDA", "AGUARDE"].includes(value.signal));
  assert.ok(value.alignment >= 0 && value.alignment <= 100);
});

test("MTF indisponível não vira AGUARDE aparentemente válido", () => {
  const value = combineTimeframes({ "1m": { error: "offline" }, "5m": { error: "offline" } }, { expectedFrames: ["1m", "5m"] });
  assert.equal(value.status, "unavailable");
  assert.equal(value.signal, "INDISPONÍVEL");
  assert.equal(value.coverage, 0);
});

test("MTF contrário bloqueia plano e direção individual", () => {
  const base = { signal: "COMPRA", plan: { entry: 100 }, reasons: [], warnings: [] };
  const gated = applyMtfGate(base, { status: "ready", signal: "VENDA", coverage: 100 });
  assert.equal(gated.signal, "AGUARDE");
  assert.equal(gated.plan, null);
  assert.equal(gated.singleTimeframeSignal, "COMPRA");
});

test("candles fora de ordem, duplicadas ou insuficientes são rejeitadas", () => {
  const rows = candles(1, "1m");
  assert.throws(() => validateCandles(rows.slice(0, 100), { interval: "1m" }), /200/);
  const duplicate = rows.map((row) => ({ ...row })); duplicate[100].t = duplicate[99].t;
  assert.throws(() => validateCandles(duplicate, { interval: "1m" }), /ordem|duplicado/i);
});

test("maturidade exibida usa amostras do par/timeframe e preserva total global só como diagnóstico", () => {
  const result = analyze(candles(1), {
    symbol: "BTCUSDT",
    interval: "15m",
    calibration: { samples: 100, pairSamples: 0, applied: false, reliability: 0.5, groupWeights: {} },
  });
  assert.equal(result.calibration.samples, 0);
  assert.equal(result.calibration.pairSamples, 0);
  assert.equal(result.calibration.globalSamples, 100);
  assert.equal(result.calibration.state, "aquecendo");
  assert.equal(result.calibration.adjusted, false);
});

test("plano técnico mantém alvos no lado correto mesmo sem níveis úteis", () => {
  const levels = { supports: [], resistances: [] };
  const buy = buildRiskPlan({ signal: "COMPRA", price: 100, atrValue: 2, levels });
  const sell = buildRiskPlan({ signal: "VENDA", price: 100, atrValue: 2, levels });
  assert.ok(buy.target1 > buy.entry && buy.target2 > buy.entry && buy.stop < buy.entry);
  assert.ok(sell.target1 < sell.entry && sell.target2 < sell.entry && sell.stop > sell.entry);
});
test('filtros de qualidade bloqueiam historico antigo e volume fraco',()=>{const rows=candles(1,'1m');const latest=rows.at(-1).t+60000;const stale=analyze(rows,{interval:'1m',now:latest+300000});assert.equal(stale.signal,'AGUARDE');assert.equal(stale.plan,null);assert.ok(stale.decision.blockers.length);const weak=rows.map(r=>({...r}));weak.at(-1).volume=1;const out=analyze(weak,{interval:'1m',now:latest});assert.equal(out.signal,'AGUARDE');assert.ok(out.decision.blockers.some(r=>r.includes('Volume')));});
test('agressao ausente nao e interpretada como cem por cento vendedora',()=>{const rows=candles(1,'1m');const out=analyze(rows,{interval:'1m',now:rows.at(-1).t+60000});assert.equal(out.reasons.some(r=>r.group==='agressão'),false);const full=rows.map(r=>({...r,takerBuyQuoteVolume:r.quoteVolume*.7}));const known=analyze(full,{interval:'1m',now:full.at(-1).t+60000});assert.equal(known.reasons.some(r=>r.group==='agressão'&&r.points>0),true);});
