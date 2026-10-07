# Rastreador de remediação da auditoria

Versão-alvo: **0.6.0**. Este documento registra os 286 achados fornecidos, a ação aplicada e a evidência verificável. “Mitigado e documentado” identifica limites metodológicos/arquiteturais que não admitem promessa absoluta; “Removido” indica código morto eliminado.

| Item | Achado | Situação | Evidência principal | Verificação |
|---:|---|---|---|---|
| #1 | Simulador pode decidir GANHOU/PERDEU usando o preço errado | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #2 | Dados microestruturais atrasados continuam alterando o sinal | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #3 | O mesmo microfluxo de segundos é contado em TODOS os timeframes | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #4 | Confluência pode exibir 100% com apenas UM timeframe disponível | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #5 | Análise antiga pode continuar aparecendo como AO VIVO | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #6 | Race condition pode mostrar análise de outro ativo/timeframe | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #7 | Falha ao trocar ativo deixa frontend e backend dessincronizados | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #8 | Sistema de alertas “dispara”, mas ninguém avisa o usuário | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #9 | Plano de risco usa US$ 10.000 fixos e pode sugerir posição absurda | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #10 | Conteúdo principal do Journal é salvo mas não é mostrado | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #11 | RSI de mercado totalmente parado retorna 100 | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #12 | Análise usa a vela ainda não fechada como se tivesse confirmação | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #13 | Comparação de volume é injusta com candle ainda aberta | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #14 | Volume Profile não é realmente um perfil de volume por preço preciso | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #15 | Volume Profile quebra conceitualmente quando `high === low` | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #16 | Perfil com volume total zero ainda fabrica POC/Value Area | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #17 | Agrupamento de suporte/resistência é dependente da ordem | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #18 | Suporte/resistência mistura pivôs high e low no mesmo processo sem classificação histórica | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #19 | Estrutura de mercado é simplificada demais | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #20 | Score conta diversos indicadores correlacionados como evidências separadas | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #21 | Um grupo fraco pesa igual a um grupo forte no cálculo de confiança | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #22 | Confiança mais alta reduz o limite necessário para gerar sinal | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #23 | Não há evidência no projeto de calibração/backtest dos pesos | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #24 | `validateCandles()` é insuficiente | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #25 | Plano pode gerar stop/alvo negativo em casos extremos | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #26 | Quantidade/preços ignoram regras reais da Binance | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #27 | “Fluxo de 60 segundos” pode representar apenas poucos segundos | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #28 | Fluxo depende da atividade do ativo | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #29 | Recalcula todo o fluxo em cada trade | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #30 | Faz deep clone do snapshot em todo evento do WebSocket sem necessidade | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #31 | Evento `market` também parece trabalho morto | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #32 | Book imbalance dá o mesmo peso para ordem longe e perto do preço | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #33 | Book imbalance é facilmente distorcido por spoofing | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #34 | Scanner REST e scanner WebSocket filtram moedas de forma diferente | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #35 | Market WebSocket não troca de host ao falhar como o socket do símbolo | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #36 | `hostIndex` é compartilhado por duas conexões diferentes | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #37 | Não há watchdog específico para miniTicker | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #38 | Mapa de miniTickers nunca expira símbolos antigos | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #39 | `prices()` usa somente top 500 por volume | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #40 | Rate limit da Binance não possui backoff adequado | Mitigado e documentado | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #41 | Poll de MTF é excessivo para timeframes altos | Mitigado e documentado | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #42 | `currentPrice` atualizado não é necessariamente persistido | Mitigado e documentado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #43 | API aceita duração fora das opções reais da interface | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #44 | `interval` do trade não é validado no simulador | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #45 | Arquivo persistido não tem schema/versionamento | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #46 | Alerta não valida símbolo corretamente dentro do AlertsStore | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #47 | UI não mostra que alerta já disparou | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #48 | Nota do alerta também é salva e nunca exibida | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #49 | Journal backend possui campos que UI não usa | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #50 | Journal só exibe 10 itens e não tem detalhes | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #51 | Exclusões de alert/journal não têm tratamento de erro | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #52 | Arquivo JSON corrompido é silenciosamente tratado como arquivo vazio/default | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #53 | Nenhum schema de persistência | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #54 | Falta backup rotativo | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #55 | savePreference() quebra se localStorage estiver corrompido | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #56 | Poll do simulator a cada 500 ms recria DOM inteiro | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #57 | Falhas de `refreshCoins()` são completamente silenciosas | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #58 | Muitos parses/eventos do SSE também possuem `catch {}` vazio | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #59 | Canvas usa cores hardcoded para candles/EMAs | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #60 | Modal de configurações está incompleto em acessibilidade | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #61 | `will-navigate` usa comparação de string, não origem real | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #62 | Erros internos são enviados diretamente ao frontend | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #63 | JSON inválido retorna 500 em vez de 400 | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #64 | Payload grande destrói socket em vez de responder limpo com 413 | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #65 | Várias rotas de leitura não validam método HTTP | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #66 | Scanner de segredo no `check.cjs` é estreito demais | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #67 | Resposta da IA não é validada por schema rigoroso | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #68 | Guardrail financeiro depende basicamente do prompt | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #69 | Interface diz algo equivalente a enviar “indicadores”, mas payload é maior | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #70 | Rate-limit local da IA penaliza inclusive tentativa falhada | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #71 | Existe `PaperPortfolio` que não é o simulador usado pelo app | Removido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #72 | `PaperPortfolio` possui stop/target que não são executados | Removido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #73 | `CredentialStore` recebe argumento extra no `main` | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #74 | CSS extremamente condensado dificulta manutenção | Mitigado e documentado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #75 | Sem teste do preço exato no vencimento | Validado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #76 | Sem teste de empate real | Validado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #77 | Sem teste de múltiplas operações/símbolos vencendo simultaneamente | Validado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #78 | Sem teste de persistência/restart do simulator | Validado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #79 | Indicadores quase não são comparados com valores de referência | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #80 | Sem teste de RSI plano | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #81 | Sem teste de Volume Profile flat/zero volume | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #82 | Testes da análise verificam mais formato que qualidade do resultado | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #83 | Sem teste de micro stale | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #84 | Sem teste de MTF parcialmente indisponível | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #85 | Sem teste de RealtimeHub | Validado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #86 | Sem teste de MarketClient | Validado | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #87 | Sem teste de AlertsStore integrado com frontend/SSE | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #88 | Sem teste de Journal UI | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #89 | Sem teste de corrupção dos arquivos JSON | Validado | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #90 | Sem teste suficiente da CredentialStore | Validado | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #91 | Sem E2E real automatizado da interface | Validado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #92 | Sem ESLint/static quality forte | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #93 | Sem CI no GitHub | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #94 | Dados do ativo antigo podem contaminar o ativo novo após trocar de moeda. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #95 | Um reconnect antigo pode criar WebSockets duplicados. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #96 | O sistema considera todos os dados “frescos” se qualquer stream estiver funcionando. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #97 | A definição de “fresco” usa hora de recebimento, não hora do evento da Binance. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #98 | Preço stale continua sendo usado como preço oficial do sistema. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #99 | Alerta também pode ser avaliado usando preço velho. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #100 | O MTF pode retornar COMPRA mesmo se nenhum timeframe individual disser COMPRA. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #101 | O alinhamento MTF ignora os próprios pesos do MTF. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #102 | ADX forte pode aumentar a confiança de um sinal que está CONTRA a tendência forte. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #103 | O VWAP utilizado fica conceitualmente ruim nos timeframes altos. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #104 | Microestrutura pode estar até ~4 segundos velha mesmo sem stale=true. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #105 | A vela é atualizada ao vivo, mas EMA e VWAP não. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #106 | Quando nasce uma nova candle, ela é adicionada, mas as séries dos indicadores não recebem um novo ponto. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #107 | O preço mostrado pode “voltar para trás” por alguns instantes. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #108 | Dois refreshAnalysis() podem rodar simultaneamente. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #109 | Se várias operações vencerem ao mesmo tempo, só uma notificação é mostrada. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #110 | Restaurar saldo apaga tudo sem confirmação. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #111 | Preview da operação pode estar usando outro preço que o backend. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #112 | Leitura da IA tem race condition ao trocar de moeda. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #113 | Resultado da IA não mostra claramente a procedência. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #114 | JSON quebrado/truncado da IA pode ser tratado como uma resposta utilizável. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #115 | Intervalo inválido é silenciosamente transformado em `15m`. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #116 | Journal não valida símbolo nem timeframe. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #117 | Há validação numérica insuficiente em algumas stores. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #118 | O programa ordena praticamente todo o mercado várias vezes por segundo. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #119 | Cache REST nunca faz eviction dos itens expirados. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #120 | SSE não trata backpressure. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `realtime-hub.test.cjs` / smoke |
| #121 | Socket é considerado “ao vivo” antes de receber o primeiro dado. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #122 | Qualquer JSON reconhecido pelo socket renova a freshness antes de ser validado. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #123 | Os números vindos do WebSocket não passam por validação de sanidade. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #124 | “Pares líquidos” não verifica explicitamente se o símbolo está atualmente TRADING. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `market-client.test.cjs` |
| #125 | readJson() trata “arquivo não existe”, “JSON corrompido” e “permissão negada” exatamente da mesma maneira. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #126 | A versão está duplicada em vários lugares. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #127 | O código de smoke test está dentro do main.cjs de produção. | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #128 | Excluir alerta/journal pode criar outro sem querer. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #129 | O sinal principal COMPRA/VENDA não é realmente decidido pelo MTF. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #130 | Spread alto possui viés matemático para VENDA. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #131 | Um alerta pode ser completamente perdido mesmo com o aplicativo aberto. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #132 | Recarregar o renderer pode destruir a sessão autenticada. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #133 | WebSocket “zumbi” pode ficar morto indefinidamente. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #134 | Uma falha transitória durante o bootstrap pode deixar o app praticamente sem iniciar. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #135 | Depois de 3.000 operações, as estatísticas deixam de representar o histórico total. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #136 | JSON válido contendo null pode quebrar stores que usam fallback por função. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #137 | Expiração das operações depende integralmente do relógio local do PC. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #138 | Cada request REST volta a tentar primeiro o mesmo host ruim. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #139 | Uma única chamada REST pode ficar presa por dezenas de segundos no failover. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #140 | force=true da análise não garante candles realmente novos. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #141 | Métrica de latência pode esconder tempo perdido em failovers anteriores. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #142 | ATR real igual a zero é substituído por volatilidade inventada. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #143 | ADX em sequência totalmente plana não produz corretamente um ADX neutro/zero. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #144 | Ausência do ADX ainda concede confiança de tendência. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #145 | Mercado com volume zero recebe volumeRatio = 1. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #146 | Volume alto aumenta confiança mesmo quando ele confirma o lado contrário ao sinal final. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #147 | Evidências contrárias praticamente não reduzem a confidence da mesma maneira que evidências favoráveis aumentam. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #148 | Igualdade exata com EMA200/VWAP vira evidência vendedora. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #149 | Candle de alto volume perfeitamente doji pode ser classificada como volume comprador. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #150 | Doji anterior pode gerar falso “bullish engulfing”. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #151 | MTF pode mostrar 100% alinhado em AGUARDE mesmo com os scores discordando completamente. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #152 | Score MTF exibido pode contradizer o threshold usado para sua classificação. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #153 | Targets ignoram obstáculos técnicos que estejam no caminho. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #154 | Vários indicadores calculados têm pouco ou nenhum efeito direto sobre o sinal. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #155 | Encerrar servidor com SSE ativo pode não encerrar imediatamente todas as conexões. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `realtime-hub.test.cjs` / smoke |
| #156 | Não existe limite razoável de operações simuladas simultaneamente abertas. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #157 | Alertas armazenados não possuem limite/expiração automática. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #158 | Stores reescrevem JSON inteiro de forma síncrona. | Mitigado e documentado | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #159 | Duplo clique/duplo submit pode criar posições, alertas e journals duplicados. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #160 | Nota da operação simulada também é guardada e depois fica invisível. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #161 | Histórico do simulador mantém centenas/milhares no backend, mas a tela mostra pouquíssimos. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #162 | O score pode usar mais motivos do que os apresentados ao usuário/IA. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #163 | Gráfico pode “andar sozinho” enquanto o usuário está olhando candles antigas. | Mitigado e documentado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #164 | UI fala em 500 candles, mas a série de análise manda cerca de 260. | Mitigado e documentado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #165 | Eixo X no timeframe diário praticamente não informa a data. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #166 | Mudança de 24h do ativo selecionado pode permanecer mostrando o valor de outro momento. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #167 | Scanner recria centenas de linhas DOM repetidamente. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #168 | Arquivo estático inexistente pode retornar index.html com HTTP 200. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #169 | Token em query string é aceito mais amplamente do que o necessário. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #170 | /api/health pode responder ok:true quando o mercado não está operacional. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #171 | O “REST fallback” anunciado é parcial, não um verdadeiro fallback do estado realtime. | Mitigado e documentado | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #172 | analysis.ts indica hora do cálculo, não idade real dos dados utilizados. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #173 | PaperPortfolio, se for mantido, possui inconsistência contábil com taxas e retenção. | Removido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #174 | HTML do alerta e regra do backend discordam sobre preço zero. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #175 | Operações vencidas podem ser liquidadas na inicialização ANTES de chegar qualquer preço novo. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #176 | Uma mensagem atrasada de BTC pode ser usada como preço de ETH no simulador/alertas. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #177 | Candle do timeframe antigo pode entrar no timeframe novo. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #178 | Antes do primeiro aggTrade, o “último preço” pode ser um midpoint inventado. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #179 | Ao trocar de moeda, a análise antiga permanece visível com o nome da moeda nova. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #180 | Book, tape e agressão antigos também permanecem durante a troca do ativo. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #181 | A interface pode escrever “mercado ao vivo” só porque o SSE local conectou. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #182 | GET /api/paper não é uma operação de leitura: ela pode liquidar trades e gravar arquivo. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #183 | Se TODOS os timeframes falharem, o MTF retorna um AGUARDE aparentemente válido. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #184 | A validação central de símbolo verifica apenas formato, não se o par existe ou sequer termina em USDT. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `market-client.test.cjs` |
| #185 | Erros normais de validação de entrada acabam virando HTTP 500. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #186 | limit de /api/coins não é validado no caminho WebSocket. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `market-client.test.cjs` |
| #187 | analysisCache também cresce sem eviction. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #188 | Uma única confluência MTF não representa um único instante de microestrutura. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #189 | Peso do MTF ignora completamente a confiabilidade individual de cada frame. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #190 | O candle atual participa da própria média usada para dizer que ele tem “volume acima da média”. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #191 | Níveis históricos são agrupados usando a volatilidade ATUAL. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #192 | Quando o usuário seleciona 1D, o próprio timeframe selecionado não participa da confluência MTF. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #193 | A propriedade candle.closed do REST depende do relógio do Windows. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #194 | IA pode aparecer como “configurada” mesmo com chave impossível de descriptografar. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #195 | Uma resposta completamente vazia da IA passa na validação. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #196 | Motivos de bloqueio/refusal/safety do provedor podem desaparecer. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #197 | O Electron inicia o fechamento do servidor, mas não espera ele terminar. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `realtime-hub.test.cjs` / smoke |
| #198 | Um RealtimeHub fechado não pode ser reiniciado corretamente. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #199 | Requisições frontend não possuem timeout próprio nem cancelamento genérico. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #200 | Barras de volume são desenhadas sobre a mesma região dos horários do eixo X. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #201 | Contabilidade do simulador usa Number binário para dinheiro sem normalização monetária. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #202 | O rename atômico não garante durabilidade diante de queda de energia. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #203 | Dados REST inválidos podem ser silenciosamente transformados em zeros legítimos. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #204 | Validação de símbolo é inconsistente dentro do próprio MarketClient. | Mitigado e documentado | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #205 | Excluir ID inexistente retorna sucesso da mesma forma que excluir um registro real. | Mitigado e documentado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #206 | O objeto guardado no cache de análise é posteriormente mutado pela rota. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #207 | Um nível exatamente no preço atual desaparece de suporte/resistência. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #208 | O parse da URL HTTP acontece fora do bloco de tratamento de erros. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #209 | O sistema calcula “força” de suporte/resistência e depois praticamente joga essa informação fora. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #210 | A janela de agressão de “60 segundos” também depende do relógio do Windows. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #211 | O mesmo aggTrade pode ser contado mais de uma vez. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #212 | Alterar o relógio do sistema quebra também o watchdog de stale. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #213 | O throttle do scanner também é vulnerável a relógio retrocedendo. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #214 | O scanner pode considerar que já tem moedas suficientes muito cedo e mostrar universo incompleto. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #215 | Quando um timeframe do MTF falha, perde-se a identidade de qual timeframe falhou. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #216 | A confiança possui piso artificial de 30%. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #217 | O limite de “volatilidade extrema” é igual para 1m e 1D. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #218 | Topos/fundos iguais deixam de ser pivôs. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #219 | Hammer, shooting star e engulfing recebem pontos sem verificar o contexto anterior. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #220 | A soma dos motivos pode não bater com o score apresentado. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #221 | valueAreaLow e valueAreaHigh do Volume Profile são centros de bins, não as bordas reais da Value Area. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #222 | JSON perfeitamente válido, mas com estrutura errada, pode quebrar o app. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #223 | O simulator aceita números não finitos em algumas validações. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #224 | closedAt representa quando o programa processou o settlement, não quando a operação deveria ter terminado. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #225 | A “taxa de acerto” ignora empates. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #226 | O REST ticker é montado usando duas fotografias diferentes do mercado. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #227 | O caminho REST de ticker/depth também carece de validação de sanidade. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #228 | O rate-limit da IA acontece tarde demais. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #229 | Não há retry inteligente para falhas transitórias da IA. | Mitigado e documentado | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #230 | O cooldown de 5 segundos não é um verdadeiro controle de gasto. | Mitigado e documentado | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #231 | Falhar ao substituir a chave da IA deixa backend e UI contando histórias diferentes. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #232 | Preferências são protegidas contra JSON inválido, mas não contra valores semanticamente inválidos. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #233 | RealtimeHub.select() valida símbolo, mas não valida intervalo diretamente. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #234 | A API trata símbolos com diferenças de capitalização de forma inconsistente. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #235 | Resultado de uma operação resolvida durante o bootstrap pode nunca ser notificado ao usuário. | Mitigado e documentado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #236 | Ao ultrapassar 5.000 entradas do Journal, dados antigos são apagados silenciosamente. | Mitigado e documentado | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #237 | O README exige Node 22+, mas package.json não força isso com engines. | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #238 | O script check conta vários tipos de arquivo como “verificados” sem realmente validar sua sintaxe. | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #239 | Os testes de segurança do servidor cobrem apenas uma pequena parte da fronteira real. | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #240 | O fixture principal de análise usa candles espaçadas em 1 minuto enquanto declara timeframe 15m. | Mitigado e documentado | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #241 | As linhas do scanner de ativos não são navegáveis adequadamente pelo teclado. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #242 | Toasts importantes não possuem aria-live/role=status ou equivalente. | Corrigido | `app.js`, `index.html`, `styles.css`, servidor e suíte de regressão | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #243 | O projeto não configura explicitamente hardening de Electron Fuses. | Validado | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #244 | Uma falha entre escrita do .tmp e rename pode deixar arquivos temporários órfãos. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #245 | “Risco/retorno” do plano provavelmente aparece como --. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #246 | O card chamado “CONFLUÊNCIA” não é a confluência multi-timeframe. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #247 | O badge de indicadores pode dizer AO VIVO quando ainda não existe dado realtime algum. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #248 | Um alerta recém-criado pode “disparar” imediatamente sem o preço ter cruzado nada. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #249 | Cada moeda do scanner não possui timestamp próprio. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #250 | marketSnapshot() expõe referências mutáveis do estado interno. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #251 | addClient() pode deixar um cliente morto registrado se o primeiro envio falhar. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #252 | Retroceder o relógio do PC pode congelar o cache REST por muito mais que o TTL. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #253 | O mesmo problema existe no cache de análise. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #254 | Erros HTTP determinísticos da Binance são repetidos em todos os hosts. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #255 | Quando todos os hosts falham, o diagnóstico esconde parte das falhas. | Corrigido | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #256 | Coalescing de requests e TTL possuem um contrato inconsistente. | Mitigado e documentado | `market-client.cjs`, `clock.cjs`, testes REST/failover | `market-client.test.cjs` |
| #257 | Uma nova operação de 30 segundos pode começar com preço REST de até ~1,2 s atrás. | Corrigido | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #258 | A engine aceita somente 60 candles, apesar de calcular EMA200. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #259 | Um timestamp finito, porém fora do intervalo aceito por Date, consegue passar na validação e depois derrubar a análise. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #260 | Com volume zero, o programa fabrica uma VWAP e ainda pode dar ±7 pontos por ela. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #261 | volumeProfile() não valida o argumento bins. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #262 | O stop pode ser baseado em um suporte/resistência tecnicamente “mais próximo”, mas absurdamente distante. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #263 | O R:R exibido é bruto e ignora exatamente o spread que a própria engine conhece. | Mitigado e documentado | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #264 | “Sinal contra a estrutura principal” é somente um aviso; o plano continua sendo gerado integralmente. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #265 | A engine gera explicação detalhada para cada motivo, mas a interface joga essa explicação fora. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #266 | Volume Profile é calculado e enviado ao frontend, mas a tela de níveis simplesmente o ignora. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #267 | A engine gera texto de invalidação do plano, mas a interface não mostra. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #268 | O backend envia score, regime e preço de cada timeframe, mas a UI MTF mostra praticamente só a direção. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #269 | Vários indicadores retornados pela API nunca aparecem no painel de indicadores. | Corrigido | `analysis.cjs`, `indicators.cjs`, UI e testes da engine | `analysis.test.cjs` / `indicators.test.cjs` / smoke |
| #270 | Se a IA devolver arrays contendo objetos, a interface mostra [object Object]. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #271 | “Chave configurada” não significa que a chave sequer é válida no provedor. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #272 | Também não há validação de compatibilidade entre modelo e provedor ao salvar. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #273 | O rate-limit da IA também quebra com alteração do relógio. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #274 | Uma resposta HTTP 200 do provedor com JSON inválido cai numa exceção genérica. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |
| #275 | O body parser aceita qualquer JSON, não necessariamente objeto. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #276 | As rotas JSON não exigem Content-Type: application/json. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #277 | Alterar o relógio para trás pode bagunçar a ordem de alertas e principalmente do Journal. | Corrigido | `storage.cjs`, stores versionadas, testes de corrupção/backup | `storage.test.cjs` |
| #278 | Após falhar em obter o single-instance lock, o código chama app.quit() mas não interrompe explicitamente o restante da inicialização. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #279 | Uma segunda execução durante a inicialização da primeira pode ser simplesmente ignorada. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #280 | Não existe recuperação explícita de crash do renderer. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #281 | pnpm dev é Windows-only. | Corrigido | `server.cjs`, `main.cjs`, CI/fuses e testes da fronteira HTTP | `server-security.test.cjs` / CI |
| #282 | A rentabilidade do simulador depende de um payout fixo de 82% sem configuração ou origem. | Mitigado e documentado | `expiry-simulator.cjs`, `server.cjs`, testes do simulador | `expiry-simulator.test.cjs` |
| #283 | O “Delta” exibido não tem unidade e usa quantidade do ativo-base, não valor financeiro. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #284 | Spread percentual usa o último trade como denominador, não o midpoint atual do book. | Mitigado e documentado | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #285 | O tape possui timestamp dos trades no estado, mas a interface não mostra nenhum horário. | Corrigido | `realtime-hub.cjs`, `app.js`, testes realtime | `realtime-hub.test.cjs` / smoke |
| #286 | Uma leitura antiga da IA continua na tela mesmo após uma troca normal de ativo/timeframe. | Corrigido | `ai-reader.cjs`, `credential-store.cjs`, testes de IA/credenciais | `ai-reader.test.cjs` / `credential-store.test.cjs` |

## Critério de fechamento

- Cada correção de alta criticidade possui contrato explícito ou teste de regressão.
- O simulador não envia ordens reais e não liquida sem cotação histórica válida do vencimento.
- Dados atrasados/indisponíveis não são apresentados como sinal negociável.
- Segredos não são armazenados no repositório e passam por proteção do sistema operacional.
- O pacote final só é considerado aprovado após check estático, 33 testes, auditoria de dependências, smoke Electron e build Windows.
