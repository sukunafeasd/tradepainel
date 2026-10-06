# DiefTrade

Assistente desktop de leitura de mercado e **paper trading** para day trade de criptomoedas. Ele acompanha pares líquidos em USDT, combina indicadores técnicos, estrutura, velas e microestrutura e explica por que chegou a `COMPRA`, `VENDA` ou `AGUARDE`.

## O que já existe

- scanner ao vivo dos pares USDT mais líquidos;
- gráfico de velas ao vivo com preços à direita, horários, crosshair, histórico, zoom e acompanhamento da vela atual;
- médias EMA 9/20/50, VWAP e volume;
- RSI, MACD, Bollinger, ATR, ADX, Estocástico, OBV, ROC e volume relativo;
- suportes, resistências, pivôs, padrões de vela e estrutura de mercado;
- fluxo de agressão, delta, spread e desequilíbrio do book;
- confluência de 1m, 5m, 15m, 1h e 4h;
- plano técnico com stop, alvos e tamanho de posição de referência;
- simulador por expiração com US$ 10 mil virtuais, Alta/Baixa, tempos de 30 segundos a 15 minutos, resultado automático, histórico, taxa de acerto e restauração de saldo;
- alertas de preço e diário do trader;
- leitura complementar opcional pelo Google Gemini ou OpenAI;
- ciclo de vida persistente com candidato, sinal confirmado, enfraquecimento, suspensão por dados e invalidação;
- cinco temas, escala de interface e redução de animações;
- Pixel, o pato trader original, reagindo ao sinal do mercado;
- scanner e vela atual atualizados continuamente por WebSocket;

## Princípios

- sinais são leitura técnica, não promessa de lucro;
- “confiança”, exibida como **qualidade da leitura**, mede a força e a consistência das evidências dentro do timeframe analisado; o alinhamento multi-timeframe é uma medida separada e nenhum dos dois números representa probabilidade de acerto, lucro ou resultado futuro;
- o programa não possui chave de corretora e não envia ordens reais;
- a chave opcional do Gemini/OpenAI é criptografada pelo Windows e nunca volta à interface;
- a chave nunca deve ser colocada no código, GitHub ou conversa;
- servidor local limitado a `127.0.0.1`, protegido por token aleatório, mesma origem e CSP;
- dados de mercado públicos da Binance, com WebSocket ao vivo e fallback REST.

## Desenvolvimento

Requer Node.js 22.12+ e pnpm.

```text
pnpm install
pnpm run check
pnpm start
pnpm build
```

O executável portátil é criado em `dist/`. Dados pessoais, chave protegida, simulações, alertas, sinais e diário ficam fora do repositório, na pasta de dados do aplicativo do Windows.

## Versão 0.9.2

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
- O desenho completo está em `SIGNAL_LIFECYCLE_DESIGN.md`; a integração de IA em `AI_INTEGRATION_REPORT.md`; o fechamento da auditoria em `NEXT_FIX_TRACKER.md`.

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
