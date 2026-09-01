"use strict";

const { AppError } = require("./contracts.cjs");

function providerError({ provider, model, status, body = "" }) {
  const gemini = provider === "gemini"; let detail = ""; let reason = "";
  try { const parsed = JSON.parse(body); detail = parsed?.error?.message || ""; reason = parsed?.error?.status || parsed?.error?.details?.map((item) => item.reason || item.metadata?.reason || "").join(" ") || ""; } catch {}
  const evidence = `${detail} ${reason} ${body}`;
  if (status === 429) return new AppError(gemini ? "A chave Gemini foi aceita, mas a cota ou o limite temporário do projeto foi atingido." : /no credits|insufficient_quota|quota/i.test(evidence) ? "A chave foi reconhecida, mas a conta da API está sem créditos." : "A OpenAI atingiu o limite temporário. Aguarde e tente novamente.", { status: 429, code: "AI_QUOTA" });
  if (gemini && /standard api key|standard key|migrat/i.test(evidence)) return new AppError("O Gemini exige a migração desta chave Standard para uma Auth key (AQ.). A credencial antiga foi preservada.", { status: 401, code: "AI_KEY_MIGRATION_REQUIRED" });
  if (gemini && status === 400 && /api key|API_KEY_INVALID|invalid.*key/i.test(evidence)) return new AppError("O Gemini recusou a chave. Gere uma Auth key AQ. no Google AI Studio e confirme o projeto selecionado.", { status: 401, code: "AI_INVALID_KEY" });
  if (status === 401) return new AppError(`${gemini ? "O Gemini" : "A OpenAI"} recusou a autenticação. Gere uma chave nova e salve novamente.`, { status: 401, code: "AI_AUTH" });
  if (status === 403) return new AppError(/leak|blocked|reported/i.test(evidence) ? "A chave foi bloqueada pelo provedor por segurança. Revogue-a e gere uma nova." : `A chave não tem permissão para usar o modelo ${model}.`, { status: 403, code: "AI_FORBIDDEN" });
  if (status === 404) return new AppError(`O modelo ${model} não foi encontrado ou não está liberado para esse projeto.`, { status: 404, code: "AI_MODEL_NOT_FOUND" });
  const transient = [408, 425, 500, 502, 503, 504].includes(status);
  return new AppError(transient ? "O provedor de IA está temporariamente indisponível. Tente novamente." : `A IA respondeu HTTP ${status}${detail ? ` — ${detail.slice(0, 180)}` : ""}`, { status: transient ? 503 : 502, code: transient ? "AI_UNAVAILABLE" : "AI_PROVIDER_ERROR" });
}

class GeminiAdapter {
  constructor({ apiKey, model, request }) { this.provider = "gemini"; this.apiKey = apiKey; this.model = model || "gemini-2.5-flash"; this.request = request; }
  headers(json = false) { return { "x-goog-api-key": this.apiKey, ...(json ? { "Content-Type": "application/json" } : {}) }; }
  async validateModel({ signal } = {}) {
    const response = await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}`, { headers: this.headers(), signal }, { provider: this.provider, model: this.model }, { attempts: 1, timeoutMs: 12000 });
    const data = await response.json().catch((cause) => { throw new AppError("O Gemini retornou JSON inválido no diagnóstico.", { status: 502, code: "AI_MALFORMED_HTTP", cause }); });
    const resolved = String(data.name || "").replace(/^models\//, "");
    if (resolved !== this.model) throw new AppError(`A chave não confirmou acesso ao modelo ${this.model}.`, { status: 409, code: "AI_MODEL_MISMATCH" });
    if (!(data.supportedGenerationMethods || []).includes("generateContent")) throw new AppError(`O modelo ${this.model} existe, mas não está liberado para gerar conteúdo neste projeto.`, { status: 409, code: "AI_MODEL_UNSUPPORTED" });
    return { model: resolved, displayName: data.displayName || resolved, supportsGenerateContent: true, requestId: this.extractRequestId(response) };
  }
  async generateStructured({ instructions, payload, schema, signal, maxOutputTokens = 1200 }) {
    const response = await this.request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`, { method: "POST", headers: this.headers(true), body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: `${instructions}\n\nDADOS TÉCNICOS:\n${JSON.stringify(payload)}` }] }], generationConfig: { temperature: 0.15, maxOutputTokens, responseMimeType: "application/json", responseSchema: schema } }), signal }, { provider: this.provider, model: this.model });
    const data = await response.json().catch((cause) => { throw new AppError("O provedor retornou uma resposta malformada.", { status: 502, code: "AI_MALFORMED_HTTP", cause }); });
    if (data.promptFeedback?.blockReason) throw new AppError(`O Gemini bloqueou a leitura: ${data.promptFeedback.blockReason}.`, { status: 422, code: "AI_BLOCKED" });
    const finishReason = data.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") throw new AppError(finishReason === "MAX_TOKENS" ? "A resposta do Gemini foi truncada. Tente novamente." : `O Gemini não concluiu a leitura: ${finishReason}.`, { status: 502, code: "AI_INCOMPLETE" });
    const text = (data.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text).filter((value) => typeof value === "string").join("\n");
    return { text, requestId: this.extractRequestId(response), response: data };
  }
  normalizeError(error) { return error; }
  extractRequestId(response) { return response.headers?.get?.("x-guploader-uploadid") || response.headers?.get?.("x-request-id") || null; }
}

class OpenAIAdapter {
  constructor({ apiKey, model, request }) { this.provider = "openai"; this.apiKey = apiKey; this.model = model || "gpt-5"; this.request = request; }
  headers(json = false) { return { Authorization: `Bearer ${this.apiKey}`, ...(json ? { "Content-Type": "application/json" } : {}) }; }
  async validateModel({ signal } = {}) {
    const response = await this.request(`https://api.openai.com/v1/models/${encodeURIComponent(this.model)}`, { headers: this.headers(), signal }, { provider: this.provider, model: this.model }, { attempts: 1, timeoutMs: 12000 });
    const data = await response.json().catch((cause) => { throw new AppError("A OpenAI retornou JSON inválido no diagnóstico.", { status: 502, code: "AI_MALFORMED_HTTP", cause }); });
    if (String(data.id || "") !== this.model) throw new AppError(`A chave não confirmou acesso ao modelo ${this.model}.`, { status: 409, code: "AI_MODEL_MISMATCH" });
    return { model: data.id, displayName: data.id, supportsGenerateContent: true, requestId: this.extractRequestId(response) };
  }
  async generateStructured({ instructions, payload, schema, signal, maxOutputTokens = 1200 }) {
    const response = await this.request("https://api.openai.com/v1/responses", { method: "POST", headers: this.headers(true), body: JSON.stringify({ model: this.model, instructions, input: JSON.stringify(payload), max_output_tokens: maxOutputTokens, text: { format: { type: "json_schema", name: "dieftrade_reading", strict: true, schema } } }), signal }, { provider: this.provider, model: this.model });
    const data = await response.json().catch((cause) => { throw new AppError("O provedor retornou uma resposta malformada.", { status: 502, code: "AI_MALFORMED_HTTP", cause }); });
    if (data.status === "incomplete") throw new AppError("A OpenAI não concluiu a resposta estruturada.", { status: 502, code: "AI_INCOMPLETE" });
    const texts = typeof data.output_text === "string" ? [data.output_text] : (data.output || []).flatMap((item) => item.content || []).map((content) => content.text).filter((value) => typeof value === "string");
    return { text: texts.join("\n"), requestId: this.extractRequestId(response), response: data };
  }
  normalizeError(error) { return error; }
  extractRequestId(response) { return response.headers?.get?.("x-request-id") || null; }
}

function createAdapter({ provider, apiKey, model, request }) { return provider === "gemini" ? new GeminiAdapter({ apiKey, model, request }) : new OpenAIAdapter({ apiKey, model, request }); }

module.exports = { GeminiAdapter, OpenAIAdapter, createAdapter, providerError };
