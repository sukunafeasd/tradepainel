# Integração de IA — DiefTrade

## Arquitetura

`GeminiAdapter` e `OpenAIAdapter` implementam o mesmo contrato: `validateModel()`, `generateStructured()`, `normalizeError()` e `extractRequestId()`. `AiReader` centraliza retry/timeout, schema, parser, guardrails, contrato do sinal e telemetria.

## Autenticação e modelos

- Gemini Auth `AQ.`: formato preferencial.
- Gemini Standard `AIza`: preservada, identificada como `migrationRequired`, nunca anunciada como plenamente atual.
- OpenAI `sk-`: suportada com modelo configurável.
- O modelo exato é consultado e precisa suportar geração.

Nenhuma chave entra em log, telemetria, resposta HTTP, executável ou GitHub. A credencial continua protegida pelo Windows.

## Diagnóstico ponta a ponta

O diagnóstico usa o mesmo adaptador e o mesmo schema da leitura real. As fases são: AUTH, MODEL, GENERATION, STRUCTURED JSON, SCHEMA, PARSER e GUARDRAIL. `IA OPERACIONAL` só aparece se todas passarem. Uma resposta de metadados isolada não basta.

## Snapshot e contexto auditável

`POST /api/ai/read` exige `analysisId`, `symbol` e `interval`. O backend rejeita snapshot ausente, expirado, incompatível, stale ou de baixa qualidade; nunca calcula/analisará outro silenciosamente. A resposta mostra provider, model, requestId, analysisId, signalId, mercado, timeframe, horário da análise, idade dos dados e horário da geração.

## Contratos de segurança

- Motor `AGUARDE` → IA somente `AGUARDE`.
- Motor `COMPRA` → IA `COMPRA` ou `AGUARDE`.
- Motor `VENDA` → IA `VENDA` ou `AGUARDE`.
- A IA não cria lifecycle, preço ou horário.
- O guardrail aceita negações seguras como “não há certeza” e rejeita promessas como “lucro garantido”.
- Bloqueio de segurança, recusa, JSON vazio/truncado, schema inválido, 401/403/404/429/5xx, timeout e indisponibilidade geram códigos e mensagens distintas.

## Telemetria local

`ai-telemetry.json` registra somente provider, model, fase, errorCode, requestId, analysisId, latência, retries e horários do último diagnóstico/geração. API key e conteúdo sensível não são armazenados.

## Testes

Mocks cobrem os contratos sem rede. `pnpm run test:ai:live` é opcional e só roda com credenciais fornecidas por ambiente; nunca faz parte do CI normal nem imprime a chave.
