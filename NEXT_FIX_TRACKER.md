# DiefTrade — Tracker da rodada pós-v0.8

| ID | Status | Causa raiz | Correção | Testes/resultado |
|---|---|---|---|---|
| AI-001 | concluído | formatos Gemini não distinguidos operacionalmente | Auth preferencial; Standard/legacy preservadas com migração explícita | credential-store |
| AI-002 | concluído | diagnóstico provava apenas metadata | pipeline completo pelo mesmo adapter/schema/parser | ai-reader |
| AI-003 | concluído | regex global rejeitava negações | guardrail contextual | frases seguras/perigosas |
| AI-004 | concluído | cache por par podia trocar snapshot | analysisId obrigatório, cache por ID, freshness e conflito 409 | servidor |
| AI-005 | concluído | resposta sem cadeia de origem | provider/model/request/analysis/signal/timestamps | UI + ai-reader |
| AI-006 | concluído | prompt era a única barreira | contrato de veredito após parse | ai-reader |
| AI-007 | concluído | linguagem podia inventar horário | lifecycle determinístico + bloqueio de horários não originados | ai-reader |
| AI-008 | concluído | lógica de provedores misturada | GeminiAdapter/OpenAIAdapter | ai-reader/adapters |
| AI-009 | concluído | somente mocks | smoke live opcional via ambiente | script dedicado |
| AI-010 | concluído | falhas sem memória operacional | telemetria local sem segredo | health/ai-telemetry |
| SIG-001 | concluído | leitura stateless tratada como entrada | lifecycle persistente separado | signal-lifecycle |
| SIG-002 | concluído | threshold único causava chatter | ativação, histerese, confirmação e invalidação configuráveis | replay sintético |
| SIG-003 | concluído | preço de candle confundido com entrada | preço aggTrade/realtime fresco na confirmação | lifecycle |
| SIG-004 | concluído | evento desaparecia no poll seguinte | signalId e histórico imutável | lifecycle/restart |
| SIG-005 | concluído | stale parecia invalidação | SUSPENDED_DATA e reconciliação | lifecycle |
| SIG-006 | concluído | reversão instantânea | invalidação + novo candidato + confirmação | lifecycle |
| SIG-007 | concluído | alertas testavam estado, não transição | alertas direcionais consomem signal-confirmed | paper/server |
| SIG-008 | concluído | paper/calibração sem vínculo | IDs e preços/horários relacionados | expiry/calibration |
| SIG-009 | concluído | UI misturava leitura e entrada | cartões e histórico distintos | UI |
| OPS-001 | concluído | capacidade do monitor opaca | métricas de fila, atraso, intervalo e ciclo | health |

Validação final obrigatória: `pnpm run check`, `pnpm test`, `pnpm run audit:prod`, build portátil, smoke Electron e revisão integral do diff.
