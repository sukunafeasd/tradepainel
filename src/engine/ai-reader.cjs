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

class AiReader {
  constructor(credentialStore) {
    this.credentials = credentialStore;
    this.lastRequestAt = 0;
  }

  async read(payload) {
    if (Date.now() - this.lastRequestAt < 5000) throw new Error("Aguarde alguns segundos antes de pedir outra leitura.");
    this.lastRequestAt = Date.now();
    const { apiKey, model } = this.credentials.load();
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
    };
    const instructions = [
      "Você é o Dief, assistente técnico de day trade de criptomoedas.",
      "Use somente os números do JSON fornecido. Não invente notícias, preços, probabilidades ou certeza.",
      "Diferencie confluência técnica de chance real de lucro. Se os dados forem conflitantes, diga AGUARDE.",
      "Responda em português do Brasil, direto e profissional.",
      "Retorne JSON válido com: veredito, resumo, contexto, confirmacoes (array), riscos (array), gatilho, invalidacao, gerenciamento.",
      "Nunca trate a análise como recomendação financeira e nunca instrua operação automática.",
    ].join(" ");
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, instructions, input: JSON.stringify(safePayload), max_output_tokens: 900 }),
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      let detail = "";
      try { detail = JSON.parse(body)?.error?.message || ""; } catch {}
      if (response.status === 429 && /no credits|insufficient_quota|quota/i.test(`${detail} ${body}`)) {
        throw new Error("A chave foi reconhecida, mas a conta da API está sem créditos. Adicione créditos na cobrança da OpenAI e tente novamente.");
      }
      if (response.status === 401) throw new Error("A OpenAI recusou a chave. Crie uma chave nova e salve novamente.");
      if (response.status === 403) throw new Error("Essa chave não tem permissão para usar o modelo selecionado.");
      throw new Error(`A IA respondeu HTTP ${response.status}${detail ? ` — ${detail.slice(0, 180)}` : ""}`);
    }
    const json = await response.json();
    return { mode: "openai", model, content: parseJson(extractText(json)), requestId: response.headers.get("x-request-id") || null };
  }
}

module.exports = { AiReader, extractText, parseJson };
