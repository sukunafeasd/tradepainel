"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const I = require("../src/engine/indicators.cjs");

test("indicadores preservam tamanho e valores finitos no fim", () => {
  const values = Array.from({ length: 260 }, (_, i) => 100 + i * 0.2 + Math.sin(i / 7) * 3);
  for (const series of [I.ema(values, 20), I.rsi(values, 14), I.sma(values, 30)]) {
    assert.equal(series.length, values.length);
    assert.ok(Number.isFinite(series.at(-1)));
  }
  const rsi = I.rsi(values, 14).at(-1);
  assert.ok(rsi >= 0 && rsi <= 100);
});

test("Bollinger mantém banda superior acima da inferior", () => {
  const values = Array.from({ length: 80 }, (_, i) => 500 + Math.sin(i / 3) * 20);
  const bands = I.bollinger(values, 20, 2);
  assert.ok(bands.upper.at(-1) > bands.lower.at(-1));
});

