# Fechamento da auditoria pós-0.6.0

Esta versão corrige os achados do relatório baseado no commit `2de07e2fec90332850ede6448394e7e9ccf83006` e adiciona testes de regressão para as fronteiras críticas.

## Simulador e liquidação

- A cotação de encerramento precisa pertencer ao mesmo par, estar dentro da tolerância e nunca pode ser posterior ao vencimento.
- Falhas de liquidação usam backoff exponencial persistido, sem uma consulta por segundo.
- Depois do limite de tentativas/tempo, a operação termina como `unresolved`, devolve o valor e explica o motivo.
- Chaves de idempotência são normalizadas antes de consultar e gravar.
- Métricas de toda a vida da simulação não dependem mais da retenção dos resultados recentes.

## Mercado, tempo e análise

- Eventos excessivamente futuros ou atrasados são rejeitados na entrada.
- Baixa atividade de negócios não derruba o WebSocket se candle, book ou ticker continuam chegando.
- Spread atrasado não altera confiança, qualidade, alertas ou plano.
- Volume só aumenta qualidade quando a última vela confirma a direção calculada.
- Alvos e stops permanecem no lado correto mesmo sem níveis técnicos aproveitáveis.
- O ticker REST usa um único snapshot de 24 h; o histórico só aceita negócios no instante ou antes do vencimento.

## Alertas, diário e tempo real

- Preços de todos os pares do scanner alimentam alertas, mesmo fora da seleção visível.
- Alertas de sinal/confiança guardam o timeframe e são monitorados em segundo plano.
- Baselines de cruzamento são persistidas sem disparar no primeiro preço observado.
- Alertas e diário confirmam que o par existe e está negociável.
- A fila SSE consolida eventos substituíveis e preserva alertas e resultados sob backpressure.
- O diário possui validação profunda, busca e paginação real.

## IA complementar

- Gemini e OpenAI recebem schema estrito e a resposta é normalizada antes de aparecer.
- Respostas vazias, truncadas, bloqueadas ou fora do contrato viram erros claros.
- Timeout por tentativa, retry limitado e cancelamento externo são combinados corretamente.
- A cota/cooldown local só é consumida após uma resposta válida.
- A rota reaproveita a última análise visível recente, evitando refazer vários timeframes antes de chamar a IA.
- A interface mostra o tempo de processamento e mantém o erro do provedor legível.

## Calibração e interface

- O aprendizado é isolado por par e timeframe, só é aplicado após 30 amostras compatíveis e ignora resultado sem cotação.
- Operações mais curtas que 80% do horizonte do timeframe não treinam os pesos.
- O selo de atualidade envelhece sozinho, mesmo sem novo render.
- O simulador consulta em frequência moderada e atualiza cronômetros separadamente.
- O resultado via SSE é identificado antes da reconciliação HTTP para impedir aviso duplicado.

## Evidência automatizada

A suíte cobre falha de IA sem consumo de cota, resposta truncada, backoff e devolução, idempotência longa, alvo correto, isolamento de calibração, preço histórico anterior, eventos futuros, baseline após reinício, schema profundo e fila SSE. O comando de validação é `pnpm run check`.
