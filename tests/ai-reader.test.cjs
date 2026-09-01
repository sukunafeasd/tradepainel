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
    if (String(url).includes(":generateContent")) return { ok: true, status: 200, headers: new Headers({"x-guploader-uploadid":"diag-gemini"}), json: async () => ({ candidates: [{ finishReason:"STOP", content:{ parts:[{ text:JSON.stringify({veredito:"AGUARDE",resumo:"Diagnóstico",contexto:"Contrato válido",confirmacoes:[],conflitos:[],riscos:["Teste"],gatilho:"Aguardar",invalidacao:"Sem entrada",gerenciamento:"Não operar"}) }] } }] }) };
    return { ok: true, status: 200, headers:new Headers(), json: async () => ({ name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", supportedGenerationMethods: ["generateContent"] }) };
  };
  try {
    const reader = new AiReader({ load: () => ({ apiKey: "AQ." + "x".repeat(32), provider: "gemini", model: "gemini-2.5-flash" }) });
    const result = await reader.diagnose();
    assert.equal(result.ok, true);
    assert.equal(result.supportsGenerateContent, true);
    assert.match(request.url, /generateContent/);
    assert.equal(request.options.headers["x-goog-api-key"], "AQ." + "x".repeat(32));
    assert.doesNotMatch(JSON.stringify(result), /AQ\./);
  } finally { global.fetch = original; }
});

test("falha do provedor não consome a única leitura diária", async () => {
  const original = global.fetch; let succeed = false;
  const content = { veredito: "AGUARDE", resumo: "Teste", contexto: "Contexto", confirmacoes: [], conflitos: [], riscos: ["Risco"], gatilho: "Aguardar", invalidacao: "Sem entrada", gerenciamento: "Não operar" };
  global.fetch = async () => succeed ? { ok: true, status: 200, headers: new Headers(), json: async () => ({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify(content) }] } }] }) } : { ok: false, status: 500, text: async () => "temporário" };
  try {
    const reader = new AiReader({ load: () => ({ apiKey: "AQ." + "x".repeat(32), provider: "gemini", model: "gemini-2.5-flash" }) }, { cooldownMs: 0, dailyLimit: 1, requestTimeoutMs: 1000 });
    await assert.rejects(() => reader.read({ symbol: "BTCUSDT", interval: "1m" }), /temporariamente/i);
    succeed = true; const result = await reader.read({ symbol: "BTCUSDT", interval: "1m" });
    assert.equal(result.content.veredito, "AGUARDE"); assert.equal(reader.dailyCalls, 1);
  } finally { global.fetch = original; }
});

test("diagnóstico rejeita modelo Gemini sem generateContent", async () => {
  const original=global.fetch;
  global.fetch=async()=>({ok:true,status:200,json:async()=>({name:"models/gemini-2.5-flash",supportedGenerationMethods:["countTokens"]})});
  try { const reader=new AiReader({load:()=>({apiKey:"AQ."+"x".repeat(32),provider:"gemini",model:"gemini-2.5-flash"})}); await assert.rejects(()=>reader.diagnose(),error=>error.code==="AI_MODEL_UNSUPPORTED"); }
  finally { global.fetch=original; }
});

test("diagnóstico OpenAI consulta e confirma exatamente o modelo escolhido", async () => {
  const original=global.fetch;const requested=[];
  global.fetch=async(url)=>{requested.push(url);if(String(url).endsWith("/responses"))return{ok:true,status:200,headers:new Headers({"x-request-id":"diag-openai"}),json:async()=>({output_text:JSON.stringify({veredito:"AGUARDE",resumo:"Diagnóstico",contexto:"Contrato válido",confirmacoes:[],conflitos:[],riscos:["Teste"],gatilho:"Aguardar",invalidacao:"Sem entrada",gerenciamento:"Não operar"})})};return{ok:true,status:200,headers:new Headers(),json:async()=>({id:"gpt-5"})};};
  try { const reader=new AiReader({load:()=>({apiKey:"sk-test",provider:"openai",model:"gpt-5"})});const result=await reader.diagnose();assert.match(requested[0],/\/v1\/models\/gpt-5$/);assert.match(requested[1],/\/v1\/responses$/);assert.equal(result.model,"gpt-5");assert.equal(result.generationValidated,true); }
  finally { global.fetch=original; }
});

test("guardrail contextual aceita negações seguras e rejeita promessas", () => {
  const { violatesGuarantee } = require("../src/engine/ai-reader.cjs");
  for (const resumo of ["não há certeza", "não existe operação sem risco", "lucro não é garantido", "o movimento pode falhar"]) assert.equal(violatesGuarantee({resumo}), false, resumo);
  for (const resumo of ["lucro garantido", "você certamente ganhará", "operação sem risco", "100% de certeza de alta"]) assert.equal(violatesGuarantee({resumo}), true, resumo);
});

test("contrato da IA permite somente veredito igual ou mais conservador", () => {
  const { enforceVerdict } = require("../src/engine/ai-reader.cjs");
  assert.equal(enforceVerdict("AGUARDE","COMPRA"),false);assert.equal(enforceVerdict("COMPRA","VENDA"),false);assert.equal(enforceVerdict("VENDA","COMPRA"),false);
  assert.equal(enforceVerdict("COMPRA","AGUARDE"),true);assert.equal(enforceVerdict("VENDA","VENDA"),true);
});

test("erros HTTP dos provedores são normalizados por camada", () => {
  const { providerError } = require("../src/engine/ai-reader.cjs");
  assert.equal(providerError({provider:"gemini",model:"gemini-2.5-flash",status:401}).code,"AI_AUTH");
  assert.equal(providerError({provider:"gemini",model:"gemini-2.5-flash",status:403}).code,"AI_FORBIDDEN");
  assert.equal(providerError({provider:"openai",model:"gpt-5",status:404}).code,"AI_MODEL_NOT_FOUND");
  assert.equal(providerError({provider:"openai",model:"gpt-5",status:429,body:"quota"}).code,"AI_QUOTA");
  assert.equal(providerError({provider:"openai",model:"gpt-5",status:500}).code,"AI_UNAVAILABLE");
  assert.equal(providerError({provider:"gemini",model:"gemini-2.5-flash",status:401,body:'{"error":{"message":"standard key migration required"}}'}).code,"AI_KEY_MIGRATION_REQUIRED");
});

test("parser aceita invólucro textual mas rejeita resposta truncada", async () => {
  const { parseJson } = require("../src/engine/ai-reader.cjs");
  const value = { veredito: "AGUARDE", resumo: "Teste", contexto: "Contexto", confirmacoes: [], conflitos: [], riscos: ["Risco"], gatilho: "Aguardar", invalidacao: "Sem entrada", gerenciamento: "Não operar" };
  assert.deepEqual(parseJson(`Resposta:\n\`\`\`json\n${JSON.stringify(value)}\n\`\`\``), value);
  assert.throws(() => parseJson('{"veredito":"AGUARDE"'), /incompleta/i);
});
