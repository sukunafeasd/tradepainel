"use strict";

const { AppError } = require("./contracts.cjs");

const REQUIRED_FIELDS = ["veredito", "resumo", "contexto", "confirmacoes", "conflitos", "riscos", "gatilho", "invalidacao", "gerenciamento"];
const LIST_FIELDS = new Set(["confirmacoes", "conflitos", "riscos"]);
const AI_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    veredito: { type: "string", enum: ["COMPRA", "VENDA", "AGUARDE"] },
    resumo: { type: "string" }, contexto: { type: "string" },
    confirmacoes: { type: "array", items: { type: "string" } }, conflitos: { type: "array", items: { type: "string" } }, riscos: { type: "array", items: { type: "string" } },
    gatilho: { type: "string" }, invalidacao: { type: "string" }, gerenciamento: { type: "string" },
  },
  required: REQUIRED_FIELDS,
};

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response.output || []) for (const content of item.content || []) if (typeof content.text === "string") texts.push(content.text);
  return texts.join("\n");
}

function extractJsonObject(text) {
  const source = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!source) return "";
  try { JSON.parse(source); return source; } catch {}
  let start = -1, depth = 0, inString = false, escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) { if (escaped) escaped = false; else if (char === "\\") escaped = true; else if (char === '"') inString = false; continue; }
    if (char === '"') { inString = true; continue; }
    if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}" && depth > 0) { depth -= 1; if (depth === 0 && start >= 0) return source.slice(start, index + 1); }
  }
  return source;
}

function cleanText(value, field) {
  if (typeof value !== "string") throw new AppError(`A resposta da IA não contém texto válido em ${field}.`, { status: 502, code: "AI_INVALID_RESPONSE" });
  const clean = value.trim().slice(0, 2400);
  if (!clean) throw new AppError(`A resposta da IA deixou ${field} vazio.`, { status: 502, code: "AI_INVALID_RESPONSE" });
  return clean;
}

function parseJson(text) {
  const clean = extractJsonObject(text);
  if (!clean) throw new AppError("A IA retornou uma resposta vazia.", { status: 502, code: "AI_EMPTY_RESPONSE" });
  let parsed;
  try { parsed = JSON.parse(clean); } catch (error) { throw new AppError("A IA retornou uma resposta incompleta. Tente novamente.", { status: 502, code: "AI_INVALID_JSON", cause: error }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new AppError("A IA retornou um formato inesperado.", { status: 502, code: "AI_INVALID_RESPONSE" });
  const normalized = {};
  for (const field of REQUIRED_FIELDS) {
    if (!(field in parsed)) throw new AppError(`A resposta da IA não contém o campo obrigatório ${field}.`, { status: 502, code: "AI_INVALID_RESPONSE" });
    if (LIST_FIELDS.has(field)) {
      if (!Array.isArray(parsed[field])) throw new AppError(`O campo ${field} precisa ser uma lista.`, { status: 502, code: "AI_INVALID_RESPONSE" });
      normalized[field] = parsed[field].slice(0, 12).map((item) => cleanText(item, field));
    } else normalized[field] = cleanText(parsed[field], field);
  }
  normalized.veredito = normalized.veredito.toUpperCase();
  if (!["COMPRA", "VENDA", "AGUARDE"].includes(normalized.veredito)) throw new AppError("A IA retornou veredito inválido.", { status: 502, code: "AI_INVALID_VERDICT" });
  return normalized;
}

function extractGeminiText(response) { return (response.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text).filter((text) => typeof text === "string").join("\n"); }

function providerError({ provider, model, status, body = "" }) {
  const gemini = provider === "gemini"; let detail = ""; let reason = "";
  try { const parsed = JSON.parse(body); detail = parsed?.error?.message || ""; reason = parsed?.error?.details?.flatMap((item) => item.reason || item.metadata?.reason || []).join(" ") || parsed?.error?.status || ""; } catch {}
  const evidence = `${detail} ${reason} ${body}`;
  if (status === 429) return new AppError(gemini ? "A chave Gemini foi aceita, mas a cota ou o limite temporário do projeto foi atingido." : /no credits|insufficient_quota|quota/i.test(evidence) ? "A chave foi reconhecida, mas a conta da API está sem créditos." : "A OpenAI atingiu o limite temporário. Aguarde e tente novamente.", { status: 429, code: "AI_QUOTA" });
  if (gemini && status === 400 && /api key|API_KEY_INVALID|invalid.*key/i.test(evidence)) return new AppError("O Gemini recusou a chave. Gere uma chave nova no Google AI Studio e confirme o projeto selecionado.", { status: 401, code: "AI_INVALID_KEY" });
  if (status === 401) return new AppError(`${gemini ? "O Gemini" : "A OpenAI"} recusou a autenticação. Gere uma chave nova e salve novamente.`, { status: 401, code: "AI_AUTH" });
  if (status === 403) return new AppError(/leak|blocked|reported/i.test(evidence) ? "A chave foi bloqueada pelo provedor por segurança. Revogue-a e gere uma nova." : `A chave não tem permissão para usar o modelo ${model}.`, { status: 403, code: "AI_FORBIDDEN" });
  if (status === 404) return new AppError(`O modelo ${model} não foi encontrado ou não está liberado para esse projeto.`, { status: 404, code: "AI_MODEL_NOT_FOUND" });
  const transient = [408, 425, 500, 502, 503, 504].includes(status);
  return new AppError(transient ? "O provedor de IA está temporariamente indisponível. Tente novamente." : `A IA respondeu HTTP ${status}${detail ? ` — ${detail.slice(0, 180)}` : ""}`, { status: transient ? 503 : 502, code: transient ? "AI_UNAVAILABLE" : "AI_PROVIDER_ERROR" });
}

function combinedSignal(external, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!external) return timeout;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([external, timeout]);
  const controller = new AbortController(); const abort = (signal) => { if (!controller.signal.aborted) controller.abort(signal.reason); };
  external.addEventListener("abort", () => abort(external), { once: true }); timeout.addEventListener("abort", () => abort(timeout), { once: true }); return controller.signal;
}

class AiReader {
  constructor(credentialStore, { cooldownMs = 5000, dailyLimit = 100, requestTimeoutMs = 18000, monotonic = () => performance.now(), now = () => Date.now() } = {}) {
    this.credentials = credentialStore; this.cooldownMs = cooldownMs; this.dailyLimit = dailyLimit; this.requestTimeoutMs = requestTimeoutMs; this.monotonic = monotonic; this.now = now; this.lastRequestMono = -Infinity; this.day = null; this.dailyCalls = 0; this.pending = false;
  }

  assertReady() {
    const currentDay = new Date(this.now()).toISOString().slice(0, 10);
    if (this.day !== currentDay) { this.day = currentDay; this.dailyCalls = 0; }
    if (this.pending) throw new AppError("Já existe uma leitura de IA em andamento.", { status: 409, code: "AI_BUSY" });
    const remaining = this.cooldownMs - (this.monotonic() - this.lastRequestMono);
    if (remaining > 0) throw new AppError(`Aguarde ${Math.ceil(remaining / 1000)} segundo(s) antes de pedir outra leitura.`, { status: 429, code: "AI_COOLDOWN" });
    if (this.dailyCalls >= this.dailyLimit) throw new AppError(`Limite local diário de ${this.dailyLimit} leituras atingido.`, { status: 429, code: "AI_DAILY_LIMIT" });
    const status = this.credentials.status?.();
    if (status && !status.operational && status.stored) throw new AppError(status.error || "A chave protegida não está operacional.", { status: 503, code: "AI_CREDENTIAL_UNAVAILABLE" });
    return true;
  }

  #consume() { this.lastRequestMono = this.monotonic(); this.dailyCalls += 1; }

  async #request(url, options, context, { attempts = 2, timeoutMs = this.requestTimeoutMs } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        const response = await fetch(url, { ...options, signal: combinedSignal(options.signal, timeoutMs) });
        if (!response.ok) {
          const content = await response.text().catch(() => ""); const error = providerError({ ...context, status: response.status, body: content });
          if (error.code !== "AI_UNAVAILABLE" || attempt === attempts - 1) throw error; lastError = error;
        } else return response;
      } catch (error) {
        if (options.signal?.aborted) throw new AppError("A leitura foi cancelada.", { status: 499, code: "AI_CANCELLED" });
        if (error?.name === "TimeoutError" || error?.name === "AbortError") lastError = new AppError("A IA demorou demais para responder. Tente novamente em instantes.", { status: 504, code: "AI_TIMEOUT", cause: error });
        else lastError = error instanceof AppError ? error : new AppError("Não foi possível conectar ao provedor de IA.", { status: 503, code: "AI_NETWORK", cause: error });
        if (attempt === attempts - 1 || !["AI_UNAVAILABLE", "AI_TIMEOUT", "AI_NETWORK"].includes(lastError.code)) throw lastError;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
    throw lastError;
  }

  async read(payload, { signal } = {}) {
    this.assertReady();
    const { apiKey, provider = "openai", model } = this.credentials.load();
    if (!apiKey) throw new AppError("Configure uma chave de IA nas preferências.", { status: 409, code: "AI_NOT_CONFIGURED" });
    this.pending = true;
    try {
      const safePayload = { analysisId: payload.id, symbol: payload.symbol, interval: payload.interval, price: payload.price, calculatedAt: payload.calculatedAt, latestCandleCloseTime: payload.latestCandleCloseTime, marketDataAgeMs: payload.marketDataAgeMs, microDataAgeMs: payload.microDataAgeMs, signal: payload.signal, singleTimeframeSignal: payload.singleTimeframeSignal, score: payload.score, confidence: payload.confidence, confidenceMeaning: payload.confidenceMeaning, regime: payload.regime, reasons: payload.reasons || [], warnings: payload.warnings || [], indicators: payload.indicators || {}, levels: payload.levels || {}, micro: payload.micro || {}, multiTimeframe: payload.multiTimeframe || null, plan: payload.plan || null, dataQuality: payload.dataQuality || null, calibration: payload.calibration || null };
      const instructions = ["Você é o Dief, assistente técnico educacional de day trade de criptomoedas.", "Use somente o JSON fornecido. Não invente notícias, preços, probabilidade, lucro ou certeza.", "Se o MTF não confirmar, houver dados atrasados, cobertura insuficiente ou conflito relevante, responda AGUARDE.", "Responda em português do Brasil.", "Não faça promessa, recomendação financeira nem instrução automática."].join(" ");
      const gemini = provider === "gemini"; const endpoint = gemini ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent` : "https://api.openai.com/v1/responses";
      const response = await this.#request(endpoint, { method: "POST", headers: gemini ? { "x-goog-api-key": apiKey, "Content-Type": "application/json" } : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(gemini ? { contents: [{ role: "user", parts: [{ text: `${instructions}\n\nDADOS TÉCNICOS:\n${JSON.stringify(safePayload)}` }] }], generationConfig: { temperature: 0.15, maxOutputTokens: 1200, responseMimeType: "application/json", responseSchema: AI_SCHEMA } } : { model, instructions, input: JSON.stringify(safePayload), max_output_tokens: 1200, text: { format: { type: "json_schema", name: "dieftrade_reading", strict: true, schema: AI_SCHEMA } } }), signal }, { provider, model });
      let json; try { json = await response.json(); } catch (error) { throw new AppError("O provedor retornou uma resposta malformada.", { status: 502, code: "AI_MALFORMED_HTTP", cause: error }); }
      if (gemini && json.promptFeedback?.blockReason) throw new AppError(`O Gemini bloqueou a leitura: ${json.promptFeedback.blockReason}.`, { status: 422, code: "AI_BLOCKED" });
      const finishReason = json.candidates?.[0]?.finishReason;
      if (gemini && finishReason && finishReason !== "STOP") throw new AppError(finishReason === "MAX_TOKENS" ? "A resposta do Gemini foi truncada. Tente novamente." : `O Gemini não concluiu a leitura: ${finishReason}.`, { status: 502, code: "AI_INCOMPLETE" });
      const content = parseJson(gemini ? extractGeminiText(json) : extractText(json));
      if (/garantid|certeza|sem risco|lucro certo/i.test(JSON.stringify(content))) throw new AppError("A resposta da IA violou o controle de segurança e foi descartada.", { status: 422, code: "AI_GUARDRAIL" });
      this.#consume();
      return { mode: gemini ? "gemini" : "openai", model, content, context: { analysisId: payload.id, symbol: payload.symbol, interval: payload.interval, price: payload.price, calculatedAt: payload.calculatedAt, marketDataAgeMs: payload.marketDataAgeMs }, requestId: response.headers.get("x-request-id") || response.headers.get("x-guploader-uploadid") || null };
    } finally { this.pending = false; }
  }

  async diagnose({ signal } = {}) {
    const { apiKey, provider = "gemini", model } = this.credentials.load(); if (!apiKey) throw new AppError("Configure uma chave de IA antes do diagnóstico.", { status: 409, code: "AI_NOT_CONFIGURED" }); const started = performance.now();
    if (provider === "gemini") { const response = await this.#request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}`, { headers: { "x-goog-api-key": apiKey }, signal }, { provider, model }, { attempts: 1, timeoutMs: 12000 }); let data; try { data = await response.json(); } catch (error) { throw new AppError("O Gemini retornou JSON inválido no diagnóstico.", { status: 502, code: "AI_MALFORMED_HTTP", cause: error }); } return { ok: true, provider, model: String(data.name || model).replace(/^models\//, ""), displayName: data.displayName || model, latencyMs: Math.round(performance.now() - started), supportsGenerateContent: (data.supportedGenerationMethods || []).includes("generateContent") }; }
    const response = await this.#request("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal }, { provider, model }, { attempts: 1, timeoutMs: 12000 }); return { ok: true, provider, model, latencyMs: Math.round(performance.now() - started), supportsGenerateContent: true };
  }
}

module.exports = { AiReader, AI_SCHEMA, extractText, extractGeminiText, extractJsonObject, parseJson, providerError, REQUIRED_FIELDS };
