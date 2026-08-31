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

test("Gemini usa o endpoint, cabeçalho e resposta corretos", async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      status: 200,
      headers: new Headers({ "x-guploader-uploadid": "gemini-request" }),
      json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ veredito: "AGUARDE", resumo: "Teste controlado", contexto: "Mercado em teste", confirmacoes: [], conflitos: [], riscos: ["Teste"], gatilho: "Aguardar", invalidacao: "Sem entrada", gerenciamento: "Não operar" }) }] } }] }),
    };
  };
  try {
    const reader = new AiReader({ load: () => ({ apiKey: "AIza-not-a-real-key-123456789", provider: "gemini", model: "gemini-2.5-flash" }) });
    const result = await reader.read({ symbol: "BTCUSDT", interval: "1m", reasons: [] });
    assert.match(request.url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
    assert.equal(request.options.headers["x-goog-api-key"], "AIza-not-a-real-key-123456789");
    assert.match(JSON.parse(request.options.body).contents[0].parts[0].text, /BTCUSDT/);
    assert.equal(result.mode, "gemini");
    assert.equal(result.content.veredito, "AGUARDE");
  } finally { global.fetch = original; }
});

test("diagnóstico Gemini confirma modelo sem revelar a chave", async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, options };
    return { ok: true, status: 200, json: async () => ({ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] }) };
  };
  try {
    const reader = new AiReader({ load: () => ({ apiKey: "AQ." + "x".repeat(32), provider: "gemini", model: "gemini-2.5-flash" }) });
    const result = await reader.diagnose();
    assert.equal(result.ok, true);
    assert.equal(result.supportsGenerateContent, true);
    assert.match(request.url, /models\/gemini-2.5-flash/);
    assert.equal(request.options.headers["x-goog-api-key"], "AQ." + "x".repeat(32));
    assert.doesNotMatch(JSON.stringify(result), /AQ\./);
  } finally { global.fetch = original; }
});
