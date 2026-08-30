"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { analyze, combineTimeframes } = require("../src/engine/analysis.cjs");

function candles(direction = 1) {
  return Array.from({ length: 500 }, (_, i) => {
    const base = 100 + direction * i * 0.08 + Math.sin(i / 8) * 1.2;
    const open = base - direction * 0.07;
    const close = base + direction * 0.07;
    return { t: 1700000000000 + i * 60000, open, high: Math.max(open, close) + .35, low: Math.min(open, close) - .35, close, volume: 1000 + i * 2, quoteVolume: (1000 + i * 2) * close };
  });
}

test("análise produz leitura explicável e série gráfica", () => {
  const result = analyze(candles(1), { symbol: "BTCUSDT", interval: "15m", micro: { buyRatio: .64, bookImbalance: .6, spreadPct: .01, delta: 20 } });
  assert.equal(result.symbol, "BTCUSDT");
  assert.ok(["COMPRA", "VENDA", "AGUARDE"].includes(result.signal));
  assert.ok(result.confidence >= 0 && result.confidence <= 100);
  assert.ok(result.reasons.length > 3);
  assert.equal(result.series.candles.length, 260);
  assert.match(result.confidenceMeaning, /não probabilidade/i);
});

test("confluência agrega timeframes sem prometer probabilidade", () => {
  const up = analyze(candles(1));
  const down = analyze(candles(-1));
  const value = combineTimeframes({ "1m": up, "5m": up, "15m": down });
  assert.ok(["COMPRA", "VENDA", "AGUARDE"].includes(value.signal));
  assert.ok(value.alignment >= 0 && value.alignment <= 100);
});

