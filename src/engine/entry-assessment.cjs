"use strict";
const {validateMarketDatum}=require('./contracts.cjs');

// Conservative simulation guards, not a probability model or future schedule.
function assessEntry(analysis, signal, datum, now=Date.now(), quote=null) {
  const result={status:'WAIT',direction:signal?.direction||null,confirmedAt:signal?.confirmedAt||null,confirmedPrice:signal?.confirmedPrice||null,checkedAt:now,expiresAt:null,currentPrice:null,executionPrice:null,estimatedRiskReward:null,plan:null,reasons:[]};
  const block=reason=>{result.reasons.push(reason);return result;};
  if(analysis?.decision?.blockers?.length)return block(analysis.decision.blockers.join(' '));
  if(!analysis||!signal||!/^CONFIRMED_(BUY|SELL)$/.test(signal.status))return block('Aguarde uma confirmação estável; direção técnica não é entrada.');
  if(signal.symbol!==analysis.symbol||signal.interval!==analysis.interval)return block('A confirmação pertence a outro mercado ou período.');
  if(!['COMPRA','VENDA'].includes(signal.direction)||signal.status!==(signal.direction==='COMPRA'?'CONFIRMED_BUY':'CONFIRMED_SELL'))return block('Estado de confirmação inconsistente.');
  const age=Number(signal.confirmedAt),duration={'1m':60000,'3m':180000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'2h':7200000,'4h':14400000,'6h':21600000,'8h':28800000,'12h':43200000,'1d':86400000}[analysis.interval];
  result.expiresAt=age+Math.min(300000,Math.max(30000,(duration||60000)/4));
  if(!Number.isFinite(age)||age<=0||age>now||now>=result.expiresAt){result.status='EXPIRED';return block('Janela da confirmação encerrada; aguarde nova avaliação.');}
  const price=validateMarketDatum(datum,{symbol:analysis.symbol,maxAgeMs:2000,maxExchangeAgeMs:2000,now});
  if(!price||price.stale)return block('Cotação atual indisponível ou atrasada.');
  result.currentPrice=price.value;
  if(!Number.isFinite(analysis.calculatedAt)||now-analysis.calculatedAt>15000||analysis.calculatedAt>now)return block('Leitura precisa ser atualizada.');
  if(analysis.signal!==signal.direction||!Number.isFinite(analysis.confidence)||analysis.confidence<65||!Number.isFinite(analysis.dataQuality?.score)||analysis.dataQuality.score<65||analysis.decision?.blockers?.length)return block('A leitura atual não sustenta a confirmação anterior.');
  if(analysis.multiTimeframe?.status!=='ready'||!Number.isFinite(analysis.multiTimeframe.coverage)||!Number.isFinite(analysis.multiTimeframe.alignment)||analysis.multiTimeframe.coverage<60||analysis.multiTimeframe.alignment<45)return block('Aguarde confluência entre os períodos.');
  const plan=signal.confirmedPlan,atr=analysis.indicators?.atr,reference=signal.confirmedPrice;
  if(!plan||![plan.stop,plan.target1,atr,reference].every(v=>Number.isFinite(v)&&v>0))return block('Plano ou amplitude de mercado indisponíveis.');
  const buy=signal.direction==='COMPRA';
  if(!quote||quote.symbol!==analysis.symbol||quote.stale||![quote.bid,quote.ask,quote.receivedAt].every(v=>Number.isFinite(v)&&v>0)||quote.bid>quote.ask||quote.receivedAt>now||now-quote.receivedAt>2000)return block('Melhor bid/ask indisponível ou atrasado.');
  const execution=buy?quote.ask:quote.bid;
  result.executionPrice=execution;
  if(!(buy?plan.stop<reference&&plan.target1>reference:plan.stop>reference&&plan.target1<reference))return block('Níveis do plano inconsistentes.');
  if(buy?execution<=plan.stop:execution>=plan.stop)return block('Preço atingiu a invalidação do plano.');
  if(buy?execution>=plan.target1:execution<=plan.target1)return block('Primeiro alvo já alcançado; não perseguir esta entrada.');
  if(Math.abs(execution-reference)>atr*.5)return block('Preço afastado mais de meio ATR da confirmação.');
  const risk=buy?execution-plan.stop:plan.stop-execution,reward=buy?plan.target1-execution:execution-plan.target1;
  result.estimatedRiskReward=reward/risk;
  if(!Number.isFinite(result.estimatedRiskReward)||result.estimatedRiskReward<1)return block('Distância até o primeiro alvo menor que o risco técnico atual.');
  const secondReward=Number.isFinite(plan.target2)?(buy?plan.target2-execution:execution-plan.target2):null;
  const nominalLimit=Number.isFinite(plan.notional)&&plan.notional>0?plan.notional:Infinity;
  const riskLimit=Number.isFinite(plan.riskBudget)&&plan.riskBudget>=0?plan.riskBudget:Infinity;
  const quantity=Number.isFinite(plan.suggestedQuantity)&&plan.suggestedQuantity>0?Math.min(plan.suggestedQuantity*Math.abs(reference-plan.stop),riskLimit)/risk:null;
  const boundedQuantity=quantity==null?null:Math.min(quantity,nominalLimit/execution);
  result.plan={...plan,entry:execution,riskReward1:result.estimatedRiskReward,riskReward2:secondReward>0?secondReward/risk:null,suggestedQuantity:boundedQuantity,notional:boundedQuantity==null?null:boundedQuantity*execution,basedOn:'live-quote',note:'Bid/ask observado; não inclui taxas, slippage ou garantia de execução.'};
  result.status='READY';result.reasons=['Condições técnicas mantidas para simulação; revalidar no momento da execução.'];
  return result;
}
module.exports={assessEntry};
