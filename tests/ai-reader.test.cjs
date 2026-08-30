"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { AiReader } = require("../src/engine/ai-reader.cjs");

test("erro de créditos da IA vira mensagem clara e não revela a chave", async () => {
  const original = global.fetch;
  global.fetch = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { type: "insufficient_quota", message: "You have no credits remaining." } }) });
  try {
    const reader = new AiReader({ load: () => ({ apiKey: "not-a-real-key", model: "gpt-5" }) });
    await assert.rejects(() => reader.read({ symbol: "BTCUSDT", interval: "15m" }), (error) => {
      assert.match(error.message, /sem créditos/i);
      assert.doesNotMatch(error.message, /not-a-real-key/);
      return true;
    });
  } finally { global.fetch = original; }
});
