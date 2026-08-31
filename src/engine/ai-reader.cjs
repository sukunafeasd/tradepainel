"use strict";

const REQUIRED_FIELDS = ["veredito", "resumo", "contexto", "confirmacoes", "conflitos", "riscos", "gatilho", "invalidacao", "gerenciamento"];

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response.output || []) for (const content of item.content || []) if (typeof content.text === "string") texts.push(content.text);
  return texts.join("\n");
}

function parseJson(text) {
  const clean = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  if (!clean) throw new Error("A IA retornou uma resposta vazia.");
  let parsed;
  try { parsed = JSON.parse(clean); } catch (error) { throw new Error("A IA retornou JSON inválido ou truncado.", { cause: error }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("A IA retornou um formato inesperado.");
  for (const field of REQUIRED_FIELDS) if (!(field in parsed)) throw new Error(`A resposta da IA não contém o campo obrigatório ${field}.`);
  if (!["COMPRA", "VENDA", "AGUARDE"].includes(String(parsed.veredito).toUpperCase())) throw new Error("A IA retornou veredito inválido.");
  for (const field of ["confirmacoes", "conflitos", "riscos"]) if (!Array.isArray(parsed[field])) throw new Error(`O campo ${field} precisa ser uma lista.`);
  return parsed;
}

function extractGeminiText(response) { return (response.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text).filter((text) => typeof text === "string").join("\n"); }

function providerError({ provider, model, status, body = "" }) {
  const gemini = provider === "gemini"; let detail = ""; let reason = "";
  try { const parsed = JSON.parse(body); detail = parsed?.error?.message || ""; reason = parsed?.error?.details?.flatMap((item) => item.reason || item.metadata?.reason || []).join(" ") || parsed?.error?.status || ""; } catch {}
  const evidence = `${detail} ${reason} ${body}`;
  if (status === 429) return gemini ? new Error("A chave Gemini foi aceita, mas a cota ou o limite temporário do projeto foi atingido.") : new Error(/no credits|insufficient_quota|quota/i.test(evidence) ? "A chave foi reconhecida, mas a conta da API está sem créditos." : "A OpenAI atingiu o limite temporário. Aguarde e tente novamente.");
  if (gemini && status === 400 && /api key|API_KEY_INVALID|invalid.*key/i.test(evidence)) return new Error("O Gemini recusou a chave. Gere uma chave nova no Google AI Studio e confirme o projeto selecionado.");
  if (status === 401) return new Error(`${gemini ? "O Gemini" : "A OpenAI"} recusou a autenticação. Gere uma chave nova e salve novamente.`);
  if (status === 403) return new Error(/leak|blocked|reported/i.test(evidence) ? "A chave foi bloqueada pelo provedor por segurança. Revogue-a e gere uma nova." : `A chave não tem permissão para usar o modelo ${model}.`);
  if (status === 404) return new Error(`O modelo ${model} não foi encontrado ou não está liberado para esse projeto.`);
  return new Error(`A IA respondeu HTTP ${status}${detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}

class AiReader {
  constructor(credentialStore, { cooldownMs = 5000, dailyLimit = 100, monotonic = () => performance.now(), now = () => Date.now() } = {}) {
    this.credentials = credentialStore; this.cooldownMs = cooldownMs; this.dailyLimit = dailyLimit; this.monotonic = monotonic; this.now = now; this.lastRequestMono = -Infinity; this.day = null; this.dailyCalls = 0;
  }

  assertReady() {
    const currentDay = new Date(this.now()).toISOString().slice(0, 10);
    if (this.day !== currentDay) { this.day = currentDay; this.dailyCalls = 0; }
    const remaining = this.cooldownMs - (this.monotonic() - this.lastRequestMono);
    if (remaining > 0) throw new Error(`Aguarde ${Math.ceil(remaining / 1000)} segundo(s) antes de pedir outra leitura.`);
    if (this.dailyCalls >= this.dailyLimit) throw new Error(`Limite local diário de ${this.dailyLimit} leituras atingido.`);
    const status = this.credentials.status?.();
    if (status && !status.operational && status.stored) throw new Error(status.error || "A chave protegida não está operacional.");
    return true;
  }

  #consume() { this.lastRequestMono = this.monotonic(); this.dailyCalls += 1; }

  async #request(url, options, context) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await fetch(url, options);
        if (!response.ok) {
          const content = await response.text().catch(() => "");
          if (![502, 503, 504].includes(response.status) || attempt === 1) throw providerError({ ...context, status: response.status, body: content });
          lastError = providerError({ ...context, status: response.status, body: content });
        } else return response;
      } catch (error) {
        lastError = error;
        if (attempt === 1 || /autentica|permiss|modelo|chave|cota|créditos/i.test(error.message)) throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 + Math.random() * 250));
    }
    throw lastError;
  }

  async read(payload) {
    this.assertReady();
    const { apiKey, provider = "openai", model } = this.credentials.load();
    if (!apiKey) throw new Error("Configure uma chave de IA nas preferências.");
    this.#consume();
    const safePayload = { analysisId: payload.id, symbol: payload.symbol, interval: payload.interval, price: payload.price, calculatedAt: payload.calculatedAt, latestCandleCloseTime: payload.latestCandleCloseTime, marketDataAgeMs: payload.marketDataAgeMs, microDataAgeMs: payload.microDataAgeMs, signal: payload.signal, singleTimeframeSignal: payload.singleTimeframeSignal, score: payload.score, confidence: payload.confidence, confidenceMeaning: payload.confidenceMeaning, regime: payload.regime, reasons: payload.reasons || [], warnings: payload.warnings || [], indicators: payload.indicators || {}, levels: payload.levels || {}, micro: payload.micro || {}, multiTimeframe: payload.multiTimeframe || null, plan: payload.plan || null, dataQuality: payload.dataQuality || null, calibration: payload.calibration || null };
    const instructions = ["Você é o Dief, assistente técnico educacional de day trade de criptomoedas.", "Use somente o JSON fornecido. Não invente notícias, preços, probabilidade, lucro ou certeza.", "Se o MTF não confirmar, houver dados stale, cobertura insuficiente ou conflito relevante, responda AGUARDE.", "Responda em português do Brasil.", "Retorne JSON válido exatamente com: veredito, resumo, contexto, confirmacoes (array), conflitos (array), riscos (array), gatilho, invalidacao, gerenciamento.", "Não faça promessa, recomendação financeira nem instrução automática."].join(" ");
    const gemini = provider === "gemini";
    const endpoint = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent` : "https://api.openai.com/v1/responses";
    const response = await this.#request(endpoint, { method: "POST", headers: gemini ? { "x-goog-api-key": apiKey, "Content-Type": "application/json" } : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(gemini ? { contents: [{ role: "user", parts: [{ text: `${instructions}\n\nDADOS TÉCNICOS:\n${JSON.stringify(safePayload)}` }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 1100, responseMimeType: "application/json" } } : { model, instructions, input: JSON.stringify(safePayload), max_output_tokens: 1100, text: { format: { type: "json_object" } } }), signal: AbortSignal.timeout(60000) }, { provider, model });
    let json;
    try { json = await response.json(); } catch (error) { throw new Error("O provedor retornou uma resposta HTTP malformada.", { cause: error }); }
    if (gemini && json.promptFeedback?.blockReason) throw new Error(`O Gemini bloqueou a leitura: ${json.promptFeedback.blockReason}.`);
    if (gemini && json.candidates?.[0]?.finishReason && !["STOP", "MAX_TOKENS"].includes(json.candidates[0].finishReason)) throw new Error(`O Gemini não concluiu a leitura: ${json.candidates[0].finishReason}.`);
    if (gemini && json.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new Error("A resposta do Gemini foi truncada pelo limite de tokens.");
    const content = parseJson(gemini ? extractGeminiText(json) : extractText(json));
    if (/garantid|certeza|sem risco|lucro certo/i.test(JSON.stringify(content))) throw new Error("A resposta da IA violou o guardrail financeiro e foi descartada.");
    return { mode: gemini ? "gemini" : "openai", model, content, context: { analysisId: payload.id, symbol: payload.symbol, interval: payload.interval, price: payload.price, calculatedAt: payload.calculatedAt, marketDataAgeMs: payload.marketDataAgeMs }, requestId: response.headers.get("x-request-id") || response.headers.get("x-guploader-uploadid") || null };
  }

  async diagnose() {
    const { apiKey, provider = "gemini", model } = this.credentials.load(); if (!apiKey) throw new Error("Configure uma chave de IA antes do diagnóstico."); const started = performance.now();
    if (provider === "gemini") { const response = await this.#request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}`, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20000) }, { provider, model }); let data; try { data = await response.json(); } catch (error) { throw new Error("O Gemini retornou JSON inválido no diagnóstico.", { cause: error }); } return { ok: true, provider, model: String(data.name || model).replace(/^models\//, ""), displayName: data.displayName || model, latencyMs: Math.round(performance.now() - started), supportsGenerateContent: (data.supportedGenerationMethods || []).includes("generateContent") }; }
    const response = await this.#request("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) }, { provider, model }); return { ok: true, provider, model, latencyMs: Math.round(performance.now() - started), supportsGenerateContent: true };
  }
}

module.exports = { AiReader, extractText, extractGeminiText, parseJson, providerError, REQUIRED_FIELDS };
