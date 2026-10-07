# Signal Lifecycle — DiefTrade

## Objetivo

A leitura bruta (`COMPRA`, `VENDA`, `AGUARDE`) continua sendo recalculada e pode oscilar. Ela não é uma entrada. O ciclo de vida cria uma segunda entidade persistente, auditável e determinística: o sinal confirmado.

## Estados e transições

- `NEUTRAL` → `CANDIDATE_BUY/SELL`: leitura supera o limiar de ativação, qualidade, MTF e freshness mínimos.
- `CANDIDATE_*` → `CONFIRMED_*`: duas avaliações **distintas** e compatíveis; uma cotação realtime fresca está disponível.
- `CANDIDATE_*` → `NEUTRAL`: a condição desaparece antes da confirmação. Nenhum sinal confirmado é criado.
- `CONFIRMED_*` → `WEAKENING_*`: a condição cai abaixo do limiar de manutenção.
- `WEAKENING_*` → `CONFIRMED_*`: a condição se recupera.
- `WEAKENING_*` → `INVALIDATED`: duas avaliações consecutivas não sustentam a direção.
- qualquer estado ativo → `SUSPENDED_DATA`: preço realtime/data quality ficam indisponíveis; isso não falsifica invalidação.
- `SUSPENDED_DATA` → estado anterior: dados válidos voltam.
- uma direção oposta nunca confirma diretamente; o sinal atual precisa ser invalidado, voltar a candidato e cumprir nova confirmação.

## Parâmetros

Os parâmetros ficam centralizados em `SignalLifecycleStore.config`: 2 avaliações distintas para confirmar, 2 para invalidar, margem de ativação 4 pontos, histerese de manutenção 6 pontos, qualidade mínima 65, cobertura MTF 60%, alinhamento MTF 45% e preço realtime com idade máxima de 2,5 s. Eles são explícitos, testados por replay sintético e não representam probabilidade de lucro.

## Identidade, horários e preços

- `analysisId`: identifica uma avaliação.
- `signalId`: identifica um ciclo confirmado e permanece igual em polls repetidos.
- `sourceCandleCloseTime`: fechamento da vela que contribuiu para a análise.
- `confirmedAt`: instante no relógio sincronizado do backend em que os critérios foram confirmados.
- `confirmedPriceAt`: timestamp da exchange do negócio realtime usado.
- `confirmedPrice`: preço realtime autoritativo, nunca o fechamento antigo tratado como entrada atual.

O plano confirmado é reancorado no preço realtime e só é aceito se preservar as invariantes: LONG com `stop < entry < targets`; SHORT com `targets < entry < stop`.

## Persistência, APIs e eventos

`signal-lifecycle.json` guarda o estado atual por `symbol|interval` e um log imutável de até 20.000 eventos. A gravação usa a fila atômica já existente.

- `GET /api/signals/current`
- `GET /api/signals/history` com `symbol`, `interval`, `direction`, `from`, `to`, `limit`
- SSE: `signal-candidate`, `signal-confirmed`, `signal-weakened`, `signal-invalidated`, `signal-suspended`, `signal-resumed`, `signal-candidate-cancelled`

Cada evento possui `eventId`; `signal-confirmed` possui `signalId`, evitando duplicação.

## Integrações

- Alertas COMPRA/VENDA consomem apenas `signal-confirmed`, não o estado bruto.
- Simulações originadas na tela guardam `signalId`, `signalConfirmedAt`, `signalConfirmedPrice`, `signalAgeAtOrder`, `sourceAnalysisId` e o preço real da ordem separadamente.
- A calibração sombra observa somente sinais confirmados, usa `confirmedPrice/confirmedAt` e liquida no horizonte do timeframe.
- A IA recebe leitura bruta e lifecycle, mas não pode decidir, inverter nem inventar preço/horário do sinal.

## Métricas e limites

Health expõe avaliações, candidatos, falsos candidatos, confirmações, invalidações, estados ativos e configuração. O monitor de alertas expõe alvos ativos/em fila, atraso mais antigo, atraso máximo, intervalo médio e duração do ciclo.

## Testes

`tests/signal-lifecycle.test.cjs` cobre estabilidade, cancelamento de candidato, chatter, identidade, histerese, reversão, stale/resume, persistência, imutabilidade e isolamento por par/timeframe. Os testes de servidor cobrem integração com calibração e APIs.
