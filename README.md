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
- cinco temas, escala de interface e redução de animações;
- Pixel, o pato trader original, reagindo ao sinal do mercado;
- scanner e vela atual atualizados continuamente por WebSocket;

## Princípios

- sinais são leitura técnica, não promessa de lucro;
- “confiança” mede a qualidade da confluência, não uma probabilidade garantida;
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

O executável portátil é criado em `dist/`. Dados pessoais, chave protegida, simulações, alertas e diário ficam fora do repositório, na pasta de dados do aplicativo do Windows.
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
