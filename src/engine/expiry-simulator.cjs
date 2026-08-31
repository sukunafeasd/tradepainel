"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");
const { AppError, cleanSymbol, cleanInterval, finiteNumber, validateMarketDatum } = require("./contracts.cjs");

const SCHEMA_VERSION = 2;
const ALLOWED_DURATIONS = new Set([30000, 60000, 120000, 300000, 900000]);
const id = () => crypto.randomBytes(8).toString("hex");
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const initial = (balance = 10000) => ({ schemaVersion: SCHEMA_VERSION, initialBalance: money(balance), balance: money(balance), payoutRate: 0.82, open: [], results: [], lifetime: { wins: 0, losses: 0, draws: 0, total: 0, realized: 0, grossProfit: 0, grossLoss: 0 }, idempotency: {}, updatedAt: Date.now() });

function migrate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const migrated = { ...initial(Number(value.initialBalance) || 10000), ...value, schemaVersion: SCHEMA_VERSION };
  migrated.open = Array.isArray(value.open) ? value.open : [];
  migrated.results = Array.isArray(value.results) ? value.results : [];
  migrated.idempotency = value.idempotency && typeof value.idempotency === "object" && !Array.isArray(value.idempotency) ? value.idempotency : {};
  if (!value.lifetime) {
    migrated.lifetime = migrated.results.reduce((totals, trade) => {
      totals.total += 1;
      if (trade.result === "win") { totals.wins += 1; totals.grossProfit += Math.max(0, Number(trade.profit) || 0); }
      else if (trade.result === "loss") { totals.losses += 1; totals.grossLoss += Math.abs(Math.min(0, Number(trade.profit) || 0)); }
      else totals.draws += 1;
      totals.realized += Number(trade.profit) || 0;
      return totals;
    }, { wins: 0, losses: 0, draws: 0, total: 0, realized: 0, grossProfit: 0, grossLoss: 0 });
  }
  return migrated;
}

function validState(value) {
  return Boolean(value && value.schemaVersion === SCHEMA_VERSION && Number.isFinite(value.initialBalance) && value.initialBalance > 0 && Number.isFinite(value.balance) && Array.isArray(value.open) && Array.isArray(value.results) && value.lifetime && typeof value.lifetime === "object");
}

function statistics(data) {
  const totals = data.lifetime || {};
  const wins = Number(totals.wins) || 0; const losses = Number(totals.losses) || 0; const draws = Number(totals.draws) || 0; const total = Number(totals.total) || 0;
  const grossProfit = Number(totals.grossProfit) || 0; const grossLoss = Number(totals.grossLoss) || 0; const realized = money(totals.realized || 0);
  const results = data.results || [];
  let equity = Number(data.initialBalance); let peak = equity; let maxDrawdown = 0; let streak = 0; let bestStreak = 0; let worstStreak = 0;
  const equityCurve = [{ at: results[0]?.openedAt || data.updatedAt, value: money(equity) }];
  for (const trade of results) {
    equity = money(equity + Number(trade.profit || 0)); peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    streak = trade.result === "win" ? Math.max(1, streak + 1) : trade.result === "loss" ? Math.min(-1, streak - 1) : 0;
    bestStreak = Math.max(bestStreak, streak); worstStreak = Math.min(worstStreak, streak); equityCurve.push({ at: trade.settledAt || trade.closedAt, value: equity });
  }
  return { wins, losses, draws, total, realized, winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0, outcomeWinRate: total ? (wins / total) * 100 : 0, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0, expectancy: total ? money(realized / total) : 0, averageWin: wins ? money(grossProfit / wins) : 0, averageLoss: losses ? money(grossLoss / losses) : 0, payoff: losses && grossLoss > 0 ? (grossProfit / Math.max(1, wins)) / (grossLoss / losses) : null, maxDrawdown: Number(maxDrawdown.toFixed(2)), currentStreak: streak, bestStreak, worstStreak, equityCurve: equityCurve.slice(-400) };
}

class ExpirySimulator {
  constructor(dataDirectory, { onSettled = null, now = () => Date.now(), maxOpen = 200, retention = 3000 } = {}) {
    this.store = new JsonStore(dataDirectory, "expiry-simulator.json", initial, { migrate, validate: validState });
    this.onSettled = typeof onSettled === "function" ? onSettled : null;
    this.now = now;
    this.maxOpen = maxOpen;
    this.retention = retention;
  }

  place({ symbol, direction, stake, entryPrice, entryDatum = null, durationMs, interval = "1m", note = "", analysisSnapshot = null, idempotencyKey = null, now = this.now() }) {
    const data = this.store.value;
    const clean = cleanSymbol(symbol); const frame = cleanInterval(interval); const amount = money(finiteNumber(stake, "Valor", { min: 1 })); const duration = finiteNumber(durationMs, "Duração", { min: 1 });
    if (!ALLOWED_DURATIONS.has(duration)) throw new AppError("Duração inválida. Use uma opção disponível na interface.", { code: "INVALID_DURATION" });
    if (!['up', 'down'].includes(direction)) throw new AppError("Direção inválida.", { code: "INVALID_DIRECTION" });
    if (data.open.length >= this.maxOpen) throw new AppError(`Limite de ${this.maxOpen} operações simultâneas atingido.`, { status: 409, code: "OPEN_LIMIT" });
    if (amount > data.balance + 1e-8) throw new AppError(`Saldo simulado insuficiente. Disponível: US$ ${Number(data.balance).toFixed(2)}.`, { status: 409, code: "INSUFFICIENT_BALANCE" });
    if (idempotencyKey && data.idempotency[idempotencyKey]) return data.open.find((trade) => trade.id === data.idempotency[idempotencyKey]) || data.results.find((trade) => trade.id === data.idempotency[idempotencyKey]);
    const legacyPrice = Number(entryPrice);
    const datum = entryDatum ? validateMarketDatum(entryDatum, { symbol: clean, maxAgeMs: 2000, now }) : Number.isFinite(legacyPrice) && legacyPrice > 0 ? { symbol: clean, value: legacyPrice, exchangeTimestamp: now, receivedAt: now, source: "validated-caller", stale: false } : null;
    if (!datum || datum.stale) throw new AppError("Preço de entrada fresco indisponível.", { status: 503, code: "FRESH_PRICE_UNAVAILABLE" });
    const trade = { id: id(), symbol: clean, direction, stake: amount, entryPrice: datum.value, currentPrice: datum.value, entryPriceAt: datum.exchangeTimestamp, entryPriceSource: datum.source, openedAt: now, expiresAt: now + duration, durationMs: duration, interval: frame, payoutRate: data.payoutRate, note: String(note || "").slice(0, 300), analysisSnapshot, status: "open", settlementAttempts: 0 };
    data.balance = money(data.balance - amount); data.open.push(trade); if (idempotencyKey) data.idempotency[String(idempotencyKey).slice(0, 120)] = trade.id; data.updatedAt = now; this.#pruneIdempotency(); this.store.save(); return trade;
  }

  #pruneIdempotency() {
    const entries = Object.entries(this.store.value.idempotency || {});
    if (entries.length > 1000) this.store.value.idempotency = Object.fromEntries(entries.slice(-800));
  }

  updatePrices(datums = {}, now = this.now()) {
    let persistChanged = false;
    for (const trade of this.store.value.open) {
      const datum = validateMarketDatum(datums[trade.symbol], { symbol: trade.symbol, maxAgeMs: 5000, now });
      // The live mark is intentionally memory-only: writing every tick would wear the
      // disk and it is never authoritative for expiry settlement.
      if (datum && !datum.stale && datum.exchangeTimestamp >= trade.entryPriceAt) { trade.currentPrice = datum.value; trade.currentPriceAt = datum.exchangeTimestamp; }
      if (now >= trade.expiresAt && trade.status === "open") { trade.status = "pending_settlement"; persistChanged = true; }
    }
    if (persistChanged) { this.store.value.updatedAt = now; this.store.save(); }
  }

  due(now = this.now()) { return this.store.value.open.filter((trade) => now >= trade.expiresAt).map((trade) => structuredClone(trade)); }

  settleResolved(resolutions = {}, now = this.now(), { toleranceMs = 1500 } = {}) {
    const data = this.store.value; const remaining = []; const settled = [];
    for (const trade of data.open) {
      if (now < trade.expiresAt) { remaining.push(trade); continue; }
      const datum = validateMarketDatum(resolutions[trade.id], { symbol: trade.symbol, now });
      if (!datum || Math.abs(datum.exchangeTimestamp - trade.expiresAt) > toleranceMs) {
        trade.status = "pending_settlement"; trade.settlementAttempts = (trade.settlementAttempts || 0) + 1; trade.lastSettlementAttemptAt = now; remaining.push(trade); continue;
      }
      const epsilon = trade.entryPrice * 1e-10; const delta = datum.value - trade.entryPrice; const draw = Math.abs(delta) <= epsilon; const win = !draw && (trade.direction === "up" ? delta > 0 : delta < 0); const result = draw ? "draw" : win ? "win" : "loss";
      const profit = money(draw ? 0 : win ? trade.stake * trade.payoutRate : -trade.stake); const credit = money(draw ? trade.stake : win ? trade.stake + profit : 0);
      data.balance = money(data.balance + credit);
      const closed = { ...trade, status: "settled", result, exitPrice: datum.value, exitPriceAt: datum.exchangeTimestamp, exitPriceSource: datum.source, closedAt: trade.expiresAt, settledAt: now, profit, credit };
      data.results.push(closed); settled.push(closed); data.lifetime.total += 1; data.lifetime.realized = money(data.lifetime.realized + profit);
      if (result === "win") { data.lifetime.wins += 1; data.lifetime.grossProfit = money(data.lifetime.grossProfit + Math.max(0, profit)); }
      else if (result === "loss") { data.lifetime.losses += 1; data.lifetime.grossLoss = money(data.lifetime.grossLoss + Math.abs(Math.min(0, profit))); }
      else data.lifetime.draws += 1;
    }
    if (settled.length || remaining.some((trade) => trade.status === "pending_settlement")) {
      data.open = remaining; data.results = data.results.slice(-this.retention); data.updatedAt = now; this.store.save();
      if (settled.length) { try { this.onSettled?.(settled); } catch (error) { this.store.issues.push({ code: "SETTLED_CALLBACK_FAILED", message: error.message }); } }
    }
    return settled;
  }

  snapshot(datums = {}, now = this.now()) {
    const data = this.store.value; const stats = statistics(data); const locked = money(data.open.reduce((sum, trade) => sum + Number(trade.stake), 0)); const equity = money(data.balance + locked);
    return { schemaVersion: data.schemaVersion, initialBalance: data.initialBalance, balance: money(data.balance), equity, locked, payoutRate: data.payoutRate, ...stats, totalReturn: data.initialBalance ? ((equity / data.initialBalance) - 1) * 100 : 0, open: data.open.map((trade) => { const datum = validateMarketDatum(datums[trade.symbol], { symbol: trade.symbol, maxAgeMs: 5000, now }); return { ...trade, currentPrice: datum && !datum.stale ? datum.value : trade.currentPrice, priceStale: !datum || datum.stale, remainingMs: Math.max(0, trade.expiresAt - now), status: now >= trade.expiresAt ? "pending_settlement" : trade.status }; }).sort((a, b) => a.expiresAt - b.expiresAt), results: data.results.slice(-200).reverse(), updatedAt: data.updatedAt, persistence: this.store.diagnostics() };
  }

  settings({ payoutRate }) { if (payoutRate == null) return { payoutRate: this.store.value.payoutRate }; const rate = finiteNumber(payoutRate, "Retorno", { min: 0.5, max: 0.98 }); this.store.value.payoutRate = rate; this.store.value.updatedAt = this.now(); this.store.save(); return { payoutRate: rate }; }
  reset(balance = 10000) { const amount = finiteNumber(balance, "Saldo", { min: 100, max: 100000000 }); this.store.value = initial(amount); this.store.save(); return this.snapshot(); }
}

module.exports = { ExpirySimulator, statistics, ALLOWED_DURATIONS, migrate, validState, money };
