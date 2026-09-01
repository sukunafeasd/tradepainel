"use strict";
const { AiReader } = require("../src/engine/ai-reader.cjs");

const provider = process.env.DIEFTRADE_AI_TEST_PROVIDER;
const apiKey = process.env.DIEFTRADE_AI_TEST_KEY;
const model = process.env.DIEFTRADE_AI_TEST_MODEL;
if (!provider || !apiKey || !model) {
  console.log("Smoke de IA ignorado: defina DIEFTRADE_AI_TEST_PROVIDER, DIEFTRADE_AI_TEST_KEY e DIEFTRADE_AI_TEST_MODEL.");
  process.exit(0);
}
const credentials = { load: () => ({ provider, apiKey, model }), status: () => ({ stored: true, operational: true }) };
new AiReader(credentials, { cooldownMs: 0, dailyLimit: 1 }).diagnose().then((result) => {
  console.log(JSON.stringify({ ok: result.ok, provider: result.provider, model: result.model, stages: result.stages, latencyMs: result.latencyMs }));
}).catch((error) => {
  console.error(JSON.stringify({ ok: false, code: error.code || "AI_TEST_FAILED", message: error.publicMessage || error.message, phase: error.diagnostic?.phase || null }));
  process.exitCode = 1;
});
