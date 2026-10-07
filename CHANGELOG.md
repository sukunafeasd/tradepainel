# Historico de Versoes

## Versao 0.9.5

- Painel mais compacto, com faixa de indicadores alinhada, grafico em destaque,
  controles e acabamento consistentes nos cinco temas e nas seis abas.
- Radar atualiza os mesmos botoes em vez de recriar a lista a cada preco,
  preservando foco e usando um unico listener para selecionar ativos.
- Canvas reutiliza a superficie enquanto o tamanho nao muda, limita a densidade
  a 2x e retoma o desenho ao voltar para uma janela oculta.
- Grafico do simulador acompanha o tema e so redesenha quando visivel e alterado.
- Book e negocios identicos nao reconstroem o DOM a cada snapshot.
- Runtime distribuido apenas com idiomas pt-BR e en-US, mantendo isolamento,
  seguranca, identidade do aplicativo e os dados locais.
- Medicao de abertura inclui carregamento dos modulos no processo principal;
  extracao do portatil e inicializacao anterior do Windows continuam separadas.

## Versao 0.9.4

- Interface local abre sem esperar consultas externas de relogio, radar ou analise.
- Radar REST carregado em segundo plano, compartilhado e limitado a um refresh
  a cada 30 segundos; precos ao vivo continuam chegando pelo WebSocket.
- Horario REST preserva o `closeTime` da bolsa, inclusive quando vem do cache.
  Respostas antigas nao substituem precos mais recentes da interface.
- Sincronizacao do relogio usa o RTT da tentativa que respondeu, sem somar
  tentativas fracassadas e deslocar artificialmente o horario dos negocios.
- Watchdog reconecta tambem quando so as velas oficiais param, mesmo com book
  ativo. Velas provisorias nao escondem esse problema.
- Icone proprio com Bitcoin e velas, mantendo a identidade verde Dief.
- Versao instalada opcional evita a extracao repetida do runtime Electron.
  A desinstalacao nao apaga os dados do usuario.
- Smoke test registra tempo do servidor local e da primeira janela; esses tempos
  nao incluem a extracao inicial do pacote portatil pelo Windows. Quando o
  launcher fornece `DIEFTRADE_SMOKE_STARTED_AT`, registra tambem o tempo total
  ate a primeira janela, incluindo a extracao.
- Nao garante latencia zero nem maior taxa de acerto: disponibilidade da bolsa,
  rede e validacao estatistica continuam sendo limites reais.

## Versão 0.9.3

- Primeiro negocio de um novo periodo cria uma previa marcada explicitamente;
  abertura e volume oficiais substituem a previa quando chega o kline da bolsa.
- Fechamento oficial do periodo anterior e preservado mesmo apos a nova vela
  aparecer; eventos em ordem incorreta nao fazem o preco voltar para tras.
- Dados de agressao ausentes nao sao interpretados como volume vendedor.

- Entrada considera ask na compra e bid na venda, cotacoes com ate dois segundos
  e risco/retorno tecnico ate o primeiro alvo. Plano revalidado preserva stop e
  alvos e recalcula quantidade de referencia sem aumentar o risco nominal.
- A indicacao READY expira tambem no cliente com relogio monotonicamente contado;
  respostas lentas ou de selecoes anteriores nao mantem entrada aparentemente atual.
- Desenhos de tendencia alinhados ao centro das velas, com conversao reversivel.

- Velas com corpo delineado, volume separado, estado de formacao e precos pequenos
  preservados. Visual adaptado aos cinco temas.
- Leitura em aguarde quando ha lacunas, dados atrasados, volume insuficiente,
  volatilidade extrema ou conflitos relevantes. Score tecnico permanece auditavel.
- Faixa de entrada simulada mostra confirmacao, preco e janela de validade. Revisa
  cotacao, plano, distancia em ATR e idade da analise a cada segundo, sem consultar
  a bolsa a cada refresh. Limites sao heuristicas conservadoras, nao previsoes.
- Analise em cache nao conta duas vezes para invalidar um sinal.
- Testes de software nao demonstram melhora estatistica de acerto ou rentabilidade;
  isso exige avaliacao historica fora da amostra, incluindo custos e risco.

## Versão 0.9.2

- Book parcial validado por sequencia, separado da atualidade do melhor bid/ask;
  diffs incrementais nao sao confundidos com snapshots completos.
- Queda de socket invalida cada fonte ate ela receber novos dados; erros de
  conexoes substituidas nao alteram a conexao atual.
- Janela de fluxo expira sem depender de novos negocios, usa cursor na fila e
  consolida a lista de negocios apenas quando precisa de um snapshot.
- Velas identicas nao geram novos desenhos. Contratos de streams conferidos
  na [documentacao oficial da Binance](https://developers.binance.com/docs/binance-spot-api-docs/web-socket-streams).

- Fluxo local consolida snapshots a cada 100 ms, com redraw por frame e sem
  reconstruir book e negocios enquanto essa aba esta oculta.
- Negocios atualizam OHLC provisorio sem duplicar volume; velas fechadas e
  mudancas de periodo sao preservadas entre consultas de analise.
- Eventos antigos nao fazem o preco retroceder e mudancas concorrentes de par
  respeitam a selecao mais recente. Campos indisponiveis nao viram zero.
- Latencia da rede/bolsa continua existindo; velas e sinais confirmados nao sao
  substituidos por extrapolacoes de preco.

- Atualizacao automatica nao cancela uma analise lenta ainda em andamento.
- Timeout cobre tambem o corpo HTTP e remove listeners de cancelamento ao concluir.
- Troca de mercado limpa a vela provisoria e invalida a resposta anterior da IA.
- Mudanca de retorno preserva saldo e historico; buscas antigas do diario nao
  substituem resultados mais recentes.
- Desenhos invalidos sao filtrados; falha de armazenamento nao interrompe o grafico.
- Backup validado recupera um arquivo principal ausente. Falha ao limpar o
  historico preserva seu indice em memoria.
- Controles, seletores, feedback e formularios seguem os cinco temas; foco do
  radar e mantido durante atualizacoes e as escalas ajustam a densidade das linhas.
- Acabamento visual alinhado ao Painel Dief: superficies neutras, trilha de luz,
  navegacao com icones, tipografia legivel e formularios com hierarquia uniforme.
- Regressao automatizada inclui respostas lentas, recuperacao e estados da interface.

## Versão 0.9.1

- Identidade visual da Equipe Dief, icone oficial no Windows e nome DiefTrade preservado.
- Cinco temas refinados, layout adaptativo, controles Lucide e maior legibilidade.
- Configuracoes com rolagem, isolamento do fundo e navegacao por teclado.
- Motor tecnico, credenciais protegidas e dados de simulacao preservados.
- Radar realtime ignora itens fora do contrato sem interromper pares validos.
- Simulador consulta uma cotacao nova quando o radar tem dados mais antigos
  que o limite de entrada; dados atrasados continuam bloqueados sem debitar saldo.
- `pnpm run test:ui` valida temas, tamanhos, abas, grafico e acessibilidade
  com dados locais de teste. Instale o Chromium com `pnpm exec playwright install chromium`.

## Versão 0.9.0

- A leitura bruta e o sinal confirmado são entidades distintas. Um sinal só confirma após avaliações diferentes e estáveis, MTF/qualidade mínimos e uma cotação realtime fresca.
- Cada confirmação recebe `signalId`, `confirmedAt`, `confirmedPrice`, timestamp da exchange, vela de origem e histórico imutável. Oscilação marginal vira “enfraquecendo”; dados atrasados suspendem a validação sem apagar o sinal.
- A histerese impede chatter e uma direção oposta precisa invalidar o ciclo atual, formar novo candidato e confirmar novamente.
- Alertas direcionais consomem a transição `signal-confirmed`; o simulador e a calibração guardam o vínculo com o sinal. A calibração sombra deixou de aprender com leituras transitórias.
- A IA exige o `analysisId` exato da tela e rejeita snapshot expirado, incompatível ou de baixa qualidade. A resposta mostra provider, modelo, requestId, analysisId, signalId e horários relacionados.
- Gemini e OpenAI usam adaptadores separados. O diagnóstico executa metadata, geração estruturada, schema, parser e guardrails pelo mesmo fluxo da leitura real.
- Gemini Auth `AQ.` é preferencial; chaves Standard `AIza` existentes são preservadas, porém identificadas como migração necessária.
- O guardrail agora entende negações seguras e bloqueia promessas reais. A IA pode ser mais conservadora, mas nunca inverter o motor nem inventar horário/preço do sinal.
- Health ganhou métricas do lifecycle, telemetria de IA sem segredos e capacidade/atraso do monitor de alertas.
- O desenho completo está em [signal-lifecycle](docs/architecture/signal-lifecycle.md); a integração de IA em [ai-integration](docs/architecture/ai-integration.md); o fechamento da auditoria em [NEXT_FIX_TRACKER](docs/history/NEXT_FIX_TRACKER.md).

## Versão 0.8.0

- Alertas técnicos deixam de ter corte oculto após o 25º alvo: todos os pares/timeframes ativos entram no agendamento, processado em lotes com concorrência limitada e retentativa individual.
- Cruzamentos de preço usam negócios `aggTrade` dedicados para todos os símbolos monitorados, reduzindo a chance de um movimento rápido desaparecer entre atualizações do radar.
- A calibração manual aceita somente operações entre `0,8x` e `1,25x` do horizonte do timeframe. Em paralelo, a calibração sombra observa automaticamente, uma vez por vela fechada, sinais direcionais válidos e os avalia no horizonte exato; assim, timeframes como 1h, 4h e 1d podem amadurecer sem depender de uma duração disponível no simulador.
- Maturidade e pesos adaptativos continuam isolados por par/timeframe. A interface mostra a amostra desse par/timeframe, enquanto o total global fica apenas como diagnóstico.
- Cotações REST autoritativas passam a carregar o timestamp real do último negócio da exchange. A busca da cotação de vencimento pagina janelas com mais de 1.000 `aggTrades` e nunca aceita negócio posterior à expiração.
- Schemas do simulador e da calibração agora validam profundamente registros e invariantes. Gravações JSON rotineiras usam uma fila assíncrona ordenada, com arquivo temporário, `fsync`, backup e renomeação atômica.
- Recuperações de backup, quarentenas e reinicializações por corrupção aparecem no painel de Saúde e geram aviso local. As leituras de inicialização e o arquivo durável de resultados podem continuar síncronos por segurança; a fila assíncrona se aplica às gravações JSON de rotina.
- Resultados detalhados passam a ser anexados, com `fsync`, a um arquivo histórico completo antes da retenção da lista visível. A exportação CSV usa esse arquivo e informa quando está completa. Registros que já haviam sido descartados antes da v0.8 não podem ser reconstruídos e são sinalizados como indisponíveis.
- O diagnóstico de IA confirma o modelo exato na OpenAI e, no Gemini, confirma tanto o modelo quanto o suporte a `generateContent` antes de considerar a configuração operacional.
- A fila SSE continua consolidando snapshots substituíveis, mas agora possui limite rígido também para eventos críticos: um cliente travado é encerrado ao atingir o teto, evitando crescimento ilimitado de memória.
- O cache das últimas análises finais ganhou teto consistente; a abertura demo usa a cotação autoritativa do instante de confirmação e exibe preço e horário confirmados; alertas de qualidade só disparam quando existe sinal ativo (`COMPRA` ou `VENDA`).

## Versão 0.7.0

- Leitura complementar de IA com resposta estruturada, validação completa, timeout coerente, progresso visível e mensagens de erro úteis.
- Falhas de rede, quota ou resposta inválida não consomem mais a leitura local; chamadas simultâneas são bloqueadas com segurança.
- Liquidação demo com backoff exponencial e devolução automática se a cotação histórica continuar indisponível.
- Estatísticas, drawdown, sequências e curva de patrimônio preservados além do limite do histórico visível.
- Alertas de preço acompanham todos os pares do radar; alertas técnicos guardam o timeframe e funcionam em segundo plano.
- Baseline de cruzamento persistida, SSE com fila para eventos críticos e proteção ampliada contra dados futuros ou atrasados.
- Calibração isolada por par e timeframe, só após amostra madura e somente com operações de horizonte compatível.
- Diário com busca, total e paginação; interface atualiza cronômetros sem reconstruir o painel duas vezes por segundo.
- Cotação REST obtida em um snapshot consistente e liquidação histórica proibida de usar negócio posterior ao vencimento.
- Schemas persistidos aprofundados e regressões da auditoria cobertas pela suíte automatizada.

## Versão 0.6.0

- Chaves Gemini Auth (`AQ.`) e padrão aceitas, sempre criptografadas pelo Windows.
- Diagnóstico separado de chave, projeto, modelo, permissão e latência.
- Calibração adaptativa local com prior estatístico e limites contra sobreajuste.
- Simulador com fator de lucro, expectativa, drawdown, sequências, curva de patrimônio e exportação CSV.
- Gráfico com níveis técnicos automáticos, linhas horizontais e tendências persistentes por par.
- Alertas de preço, sinal e confluência com aviso visual e sonoro local.
- Painel de saúde para fluxo ao vivo, failover, latência, IA e memória.
- Liquidação do simulador exclusivamente por cotação histórica do instante de expiração, com estado pendente quando a fonte não está disponível.
- Contratos centrais de símbolo, intervalo, timestamps, preço e corpo HTTP, além de persistência atômica com schema, backup, quarentena e diagnóstico.
- Freshness independente para candle, ticker, book e fluxo; proteção contra sockets antigos, eventos duplicados e relógio local alterado.
- Gate MTF real, cobertura explícita, velas fechadas e 500 candles para EMA200.
- Limites, paginação, confirmações destrutivas, idempotência e feedback de acessibilidade na interface.
- Testes de regressão para engine, simulador, realtime, REST/failover, persistência, credenciais, IA e fronteira HTTP.
- CI no Windows, auditoria de dependências e hardening dos Electron Fuses no pacote final.
