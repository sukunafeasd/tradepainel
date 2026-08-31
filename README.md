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

Requer Node.js 22+ e pnpm.

```text
pnpm install
pnpm run check
pnpm start
pnpm build
```

O executável portátil é criado em `dist/`. Dados pessoais, chave protegida, simulações, alertas e diário ficam fora do repositório, na pasta de dados do aplicativo do Windows.
## Versão 0.5.0

- Chaves Gemini Auth (`AQ.`) e padrão aceitas, sempre criptografadas pelo Windows.
- Diagnóstico separado de chave, projeto, modelo, permissão e latência.
- Calibração adaptativa local com prior estatístico e limites contra sobreajuste.
- Simulador com fator de lucro, expectativa, drawdown, sequências, curva de patrimônio e exportação CSV.
- Gráfico com níveis técnicos automáticos, linhas horizontais e tendências persistentes por par.
- Alertas de preço, sinal e confluência com aviso visual e sonoro local.
- Painel de saúde para fluxo ao vivo, failover, latência, IA e memória.
