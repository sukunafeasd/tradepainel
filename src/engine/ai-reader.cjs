"use strict";

function extractText(response) {
  if (typeof response.output_text === "string") return response.output_text;
  const texts = [];
  for (const item of response.output || []) {
    for (const content of item.content || []) if (typeof content.text === "string") texts.push(content.text);
  }
  return texts.join("\n");
}

function parseJson(text) {
  const clean = String(text || "").trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(clean); } catch { return { resumo: clean }; }
}

function extractGeminiText(response) {
  return (response.candidates || []).flatMap((candidate) => candidate.content?.parts || []).map((part) => part.text).filter((text) => typeof text === "string").join("\n");
}

function providerError({ provider, model, status, body = "" }) {
  const gemini = provider === "gemini";
  let detail = "";
  let reason = "";
  try {
    const parsed = JSON.parse(body);
    detail = parsed?.error?.message || "";
    reason = parsed?.error?.details?.flatMap((item) => item.reason || item.metadata?.reason || []).join(" ") || parsed?.error?.status || "";
  } catch {}
  const evidence = `${detail} ${reason} ${body}`;
  if (status === 429) return gemini
    ? new Error("A chave Gemini foi aceita, mas a cota ou o limite temporário do projeto foi atingido.")
    : new Error(/no credits|insufficient_quota|quota/i.test(evidence) ? "A chave foi reconhecida, mas a conta da API está sem créditos." : "A OpenAI atingiu o limite temporário. Aguarde e tente novamente.");
  if (gemini && status === 400 && /api key|API_KEY_INVALID|invalid.*key/i.test(evidence)) return new Error("O Gemini recusou a chave. Crie uma chave Auth nova no Google AI Studio e confirme que ela pertence ao projeto selecionado.");
  if (status === 401) return new Error(`${gemini ? "O Gemini" : "A OpenAI"} recusou a autenticação. Gere uma chave nova e salve novamente.`);
  if (status === 403) return new Error(/leak|blocked|reported/i.test(evidence)
    ? "A chave foi bloqueada pelo provedor por segurança. Revogue-a e gere uma nova."
    : `A chave não tem permissão para usar o modelo ${model}. Confira o projeto e as restrições da API.`);
  if (status === 404) return new Error(`O modelo ${model} não foi encontrado ou não está liberado para esse projeto.`);
  return new Error(`A IA respondeu HTTP ${status}${detail ? ` — ${detail.slice(0, 220)}` : ""}`);
}

class AiReader {
  constructor(credentialStore) {
    this.credentials = credentialStore;
    this.lastRequestAt = 0;
  }

  async read(payload) {
    if (Date.now() - this.lastRequestAt < 5000) throw new Error("Aguarde alguns segundos antes de pedir outra leitura.");
    this.lastRequestAt = Date.now();
    const { apiKey, provider = "openai", model } = this.credentials.load();
    if (!apiKey) throw new Error("Configure uma chave de IA nas preferências.");
    const safePayload = {
      symbol: payload.symbol,
      interval: payload.interval,
      price: payload.price,
      signal: payload.signal,
      score: payload.score,
      confidence: payload.confidence,
      confidenceMeaning: payload.confidenceMeaning,
      regime: payload.regime,
      reasons: (payload.reasons || []).slice(0, 12),
      warnings: payload.warnings || [],
      indicators: payload.indicators || {},
      levels: payload.levels || {},
      micro: payload.micro || {},
      multiTimeframe: payload.multiTimeframe || null,
      plan: payload.plan || null,
      dataQuality: payload.dataQuality || null,
      calibration: payload.calibration || null,
    };
    const instructions = [
      "Você é o Dief, assistente técnico de day trade de criptomoedas.",
      "Use somente os números do JSON fornecido. Não invente notícias, preços, probabilidades ou certeza.",
      "Diferencie confluência técnica de chance real de lucro. Se os dados forem conflitantes, diga AGUARDE.",
      "Responda em português do Brasil, direto e profissional.",
      "Considere qualidade dos dados, alinhamento entre tempos e calibração histórica. Penalize conflito, atraso e pouca amostra.",
      "Retorne JSON válido com: veredito, resumo, contexto, confirmacoes (array), conflitos (array), riscos (array), gatilho, invalidacao, gerenciamento.",
      "Nunca trate a análise como recomendação financeira e nunca instrua operação automática.",
    ].join(" ");
    const gemini = provider === "gemini";
    const endpoint = gemini
      ? `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}:generateContent`
      : "https://api.openai.com/v1/responses";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: gemini ? { "x-goog-api-key": apiKey, "Content-Type": "application/json" } : { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(gemini ? {
        contents: [{ role: "user", parts: [{ text: `${instructions}\n\nDADOS TÉCNICOS:\n${JSON.stringify(safePayload)}` }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 900, responseMimeType: "application/json" },
      } : { model, instructions, input: JSON.stringify(safePayload), max_output_tokens: 900 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw providerError({ provider, model, status: response.status, body });
    }
    const json = await response.json();
    const content = parseJson(gemini ? extractGeminiText(json) : extractText(json));
    if (!Object.keys(content || {}).length) throw new Error("A IA não retornou uma leitura utilizável.");
    return { mode: gemini ? "gemini" : "openai", model, content, requestId: response.headers.get("x-request-id") || response.headers.get("x-guploader-uploadid") || null };
  }

  async diagnose() {
    const { apiKey, provider = "gemini", model } = this.credentials.load();
    if (!apiKey) throw new Error("Configure uma chave de IA antes do diagnóstico.");
    const started = performance.now();
    if (provider === "gemini") {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-2.5-flash")}`;
      const response = await fetch(endpoint, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw providerError({ provider, model, status: response.status, body: await response.text().catch(() => "") });
      const data = await response.json();
      return {
        ok: true,
        provider,
        model: String(data.name || model).replace(/^models\//, ""),
        displayName: data.displayName || model,
        latencyMs: Math.round(performance.now() - started),
        supportsGenerateContent: (data.supportedGenerationMethods || []).includes("generateContent"),
      };
    }
    const response = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw providerError({ provider, model, status: response.status, body: await response.text().catch(() => "") });
    return { ok: true, provider, model, latencyMs: Math.round(performance.now() - started), supportsGenerateContent: true };
  }
}

module.exports = { AiReader, extractText, extractGeminiText, parseJson, providerError };
