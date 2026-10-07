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

O executável portátil é criado como `dist/DiefTrade.exe`. A opcao instalada usa
`dist/DiefTrade-Instalar.exe` e abre o aplicativo `DiefTrade` sem extrair o pacote
novamente a cada uso. Dados pessoais, chave protegida, simulações, alertas, sinais e diário ficam fora do repositório, na pasta de dados do aplicativo do Windows.

## Estrutura do repositorio

- `src/engine/`: contratos, mercado, analise, simulador e persistencia.
- `src/security/`: protecao das credenciais locais.
- `src/ui/`: interface e recursos usados pelo aplicativo.
- `assets/`: icone Windows e licencas de terceiros.
- `tests/`: testes automatizados de regressao.
- `scripts/`: verificacao, empacotamento, testes de interface e publicacao.
- `docs/architecture/`: desenho tecnico do ciclo de sinais e da IA.
- `docs/history/`: relatorios de auditorias anteriores, apenas como evidencia historica.
- `dist/`: pacotes gerados localmente; nao entra no Git.

## Verificacao e pacotes

```text
pnpm run check
pnpm exec playwright install chromium
pnpm run test:ui
pnpm run audit:prod
pnpm run build
pnpm run build:installer
pnpm run build:all
```

`build` gera o portatil; `build:installer` gera o instalador; `build:all` gera ambos.
Os scripts de IA ao vivo sao opcionais e podem consumir a quota do provedor.
Nao sao executados automaticamente pela suite local ou CI.

## Documentacao

- [Historico de versoes](CHANGELOG.md)
- [Arquitetura de IA](docs/architecture/ai-integration.md)
- [Ciclo de sinais](docs/architecture/signal-lifecycle.md)
- [Operacao e publicacao](docs/maintenance.md)

Preferencias, chaves, saldo simulado e historico pessoais nao devem ser colocados
no repositorio ou apagados em limpezas de build. O identificador do aplicativo
permanece `br.com.dief.trade` para preservar a continuidade dos dados.
