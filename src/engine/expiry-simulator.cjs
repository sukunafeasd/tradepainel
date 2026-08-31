"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");
const { AppError, cleanSymbol, cleanInterval, finiteNumber, validateMarketDatum } = require("./contracts.cjs");

const SCHEMA_VERSION = 3;
const ALLOWED_DURATIONS = new Set([30000, 60000, 120000, 300000, 900000]);
const DEFAULT_SETTLEMENT_POLICY = Object.freeze({ maxAttempts: 8, maxPendingMs: 2 * 60 * 1000, baseRetryMs: 2000, maxRetryMs: 30000 });
const id = () => crypto.randomBytes(8).toString("hex");
const money = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const normalizeIdempotencyKey = (value) => value == null || value === "" ? null : String(value).slice(0, 120);
const emptyLifetime = (balance) => ({ wins: 0, losses: 0, draws: 0, unresolved: 0, total: 0, realized: 0, grossProfit: 0, grossLoss: 0, equity: money(balance), peakEquity: money(balance), maxDrawdown: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0, equityCurve: [{ at: Date.now(), value: money(balance) }], historyComplete: true });
const initial = (balance = 10000) => ({ schemaVersion: SCHEMA_VERSION, initialBalance: money(balance), balance: money(balance), payoutRate: 0.82, open: [], results: [], lifetime: emptyLifetime(balance), idempotency: {}, updatedAt: Date.now() });

function rebuildLifetime(initialBalance, results, previous = null) {
  const rows = Array.isArray(results) ? results : [];
  const derived = rows.reduce((totals, trade) => {
    totals.total += 1;
    if (trade.result === "win") { totals.wins += 1; totals.grossProfit += Math.max(0, Number(trade.profit) || 0); }
    else if (trade.result === "loss") { totals.losses += 1; totals.grossLoss += Math.abs(Math.min(0, Number(trade.profit) || 0)); }
    else if (trade.result === "unresolved") totals.unresolved += 1;
    else totals.draws += 1;
    totals.realized += Number(trade.profit) || 0;
    return totals;
  }, { wins: 0, losses: 0, draws: 0, unresolved: 0, total: 0, realized: 0, grossProfit: 0, grossLoss: 0 });
  const totals = previous && Number.isFinite(Number(previous.total)) ? { ...derived, ...previous } : derived;
  for (const key of ["wins", "losses", "draws", "unresolved", "total", "realized", "grossProfit", "grossLoss"]) totals[key] = Number(totals[key]) || 0;
  const retainedProfit = rows.reduce((sum, trade) => sum + Number(trade.profit || 0), 0);
  let equity = money(Number(initialBalance) + totals.realized - retainedProfit);
  let peak = Math.max(equity, Number(previous?.peakEquity) || equity);
  let maxDrawdown = Number(previous?.maxDrawdown) || 0;
  let streak = 0; let bestStreak = 0; let worstStreak = 0;
  const equityCurve = [{ at: rows[0]?.openedAt || Date.now(), value: equity }];
  for (const trade of rows) {
    equity = money(equity + Number(trade.profit || 0)); peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak > 0 ? ((peak - equity) / peak) * 100 : 0);
    streak = trade.result === "win" ? Math.max(1, streak + 1) : trade.result === "loss" ? Math.min(-1, streak - 1) : 0;
    bestStreak = Math.max(bestStreak, streak); worstStreak = Math.min(worstStreak, streak); equityCurve.push({ at: trade.settledAt || trade.closedAt, value: equity });
  }
  return { ...totals, realized: money(totals.realized), grossProfit: money(totals.grossProfit), grossLoss: money(totals.grossLoss), equity: money(Number(initialBalance) + totals.realized), peakEquity: money(peak), maxDrawdown: Number(maxDrawdown.toFixed(2)), currentStreak: Number.isFinite(Number(previous?.currentStreak)) ? Number(previous.currentStreak) : streak, bestStreak: Math.max(Number(previous?.bestStreak) || 0, bestStreak), worstStreak: Math.min(Number(previous?.worstStreak) || 0, worstStreak), equityCurve: Array.isArray(previous?.equityCurve) && previous.equityCurve.length ? previous.equityCurve.slice(-400) : equityCurve.slice(-400), historyComplete: Boolean(previous?.historyComplete ?? (totals.total <= rows.length)) };
}

function migrate(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const migrated = { ...initial(Number(value.initialBalance) || 10000), ...value, schemaVersion: SCHEMA_VERSION };
  migrated.open = Array.isArray(value.open) ? value.open : [];
  migrated.results = Array.isArray(value.results) ? value.results : [];
  migrated.idempotency = value.idempotency && typeof value.idempotency === "object" && !Array.isArray(value.idempotency) ? value.idempotency : {};
  migrated.lifetime = rebuildLifetime(migrated.initialBalance, migrated.results, value.lifetime || null);
  return migrated;
}

function validState(value) {
  return Boolean(value && value.schemaVersion === SCHEMA_VERSION && Number.isFinite(value.initialBalance) && value.initialBalance > 0 && Number.isFinite(value.balance) && Array.isArray(value.open) && Array.isArray(value.results) && value.lifetime && typeof value.lifetime === "object");
}

function statistics(data) {
  const totals = data.lifetime || {};
  const wins = Number(totals.wins) || 0; const losses = Number(totals.losses) || 0; const draws = Number(totals.draws) || 0; const total = Number(totals.total) || 0;
  const grossProfit = Number(totals.grossProfit) || 0; const grossLoss = Number(totals.grossLoss) || 0; const realized = money(totals.realized || 0);
  const unresolved = Number(totals.unresolved) || 0;
  return { wins, losses, draws, unresolved, total, realized, winRate: wins + losses ? (wins / (wins + losses)) * 100 : 0, outcomeWinRate: total ? (wins / total) * 100 : 0, profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? null : 0, expectancy: total ? money(realized / total) : 0, averageWin: wins ? money(grossProfit / wins) : 0, averageLoss: losses ? money(grossLoss / losses) : 0, payoff: losses && grossLoss > 0 ? (grossProfit / Math.max(1, wins)) / (grossLoss / losses) : null, maxDrawdown: Number(Number(totals.maxDrawdown || 0).toFixed(2)), currentStreak: Number(totals.currentStreak) || 0, bestStreak: Number(totals.bestStreak) || 0, worstStreak: Number(totals.worstStreak) || 0, equityCurve: Array.isArray(totals.equityCurve) ? totals.equityCurve.slice(-400) : [], lifetimeHistoryComplete: Boolean(totals.historyComplete) };
}

class ExpirySimulator {
  constructor(dataDirectory, { onSettled = null, now = () => Date.now(), maxOpen = 200, retention = 3000, settlementPolicy = {} } = {}) {
    this.store = new JsonStore(dataDirectory, "expiry-simulator.json", initial, { migrate, validate: validState });
    this.onSettled = typeof onSettled === "function" ? onSettled : null;
    this.now = now;
    this.maxOpen = maxOpen;
    this.retention = retention;
    this.settlementPolicy = { ...DEFAULT_SETTLEMENT_POLICY, ...settlementPolicy };
  }

  place({ symbol, direction, stake, entryPrice, entryDatum = null, durationMs, interval = "1m", note = "", analysisSnapshot = null, idempotencyKey = null, now = this.now() }) {
    const data = this.store.value;
    const clean = cleanSymbol(symbol); const frame = cleanInterval(interval); const amount = money(finiteNumber(stake, "Valor", { min: 1 })); const duration = finiteNumber(durationMs, "Duração", { min: 1 });
    if (!ALLOWED_DURATIONS.has(duration)) throw new AppError("Duração inválida. Use uma opção disponível na interface.", { code: "INVALID_DURATION" });
    if (!['up', 'down'].includes(direction)) throw new AppError("Direção inválida.", { code: "INVALID_DIRECTION" });
    if (data.open.length >= this.maxOpen) throw new AppError(`Limite de ${this.maxOpen} operações simultâneas atingido.`, { status: 409, code: "OPEN_LIMIT" });
    if (amount > data.balance + 1e-8) throw new AppError(`Saldo simulado insuficiente. Disponível: US$ ${Number(data.balance).toFixed(2)}.`, { status: 409, code: "INSUFFICIENT_BALANCE" });
    const normalizedIdempotencyKey = normalizeIdempotencyKey(idempotencyKey);
    if (normalizedIdempotencyKey && data.idempotency[normalizedIdempotencyKey]) return data.open.find((trade) => trade.id === data.idempotency[normalizedIdempotencyKey]) || data.results.find((trade) => trade.id === data.idempotency[normalizedIdempotencyKey]);
    const legacyPrice = Number(entryPrice);
    const datum = entryDatum ? validateMarketDatum(entryDatum, { symbol: clean, maxAgeMs: 2000, now }) : Number.isFinite(legacyPrice) && legacyPrice > 0 ? { symbol: clean, value: legacyPrice, exchangeTimestamp: now, receivedAt: now, source: "validated-caller", stale: false } : null;
    if (!datum || datum.stale) throw new AppError("Preço de entrada fresco indisponível.", { status: 503, code: "FRESH_PRICE_UNAVAILABLE" });
    const trade = { id: id(), symbol: clean, direction, stake: amount, entryPrice: datum.value, currentPrice: datum.value, entryPriceAt: datum.exchangeTimestamp, entryPriceSource: datum.source, openedAt: now, expiresAt: now + duration, durationMs: duration, interval: frame, payoutRate: data.payoutRate, note: String(note || "").slice(0, 300), analysisSnapshot, status: "open", settlementAttempts: 0 };
    data.balance = money(data.balance - amount); data.open.push(trade); if (normalizedIdempotencyKey) data.idempotency[normalizedIdempotencyKey] = trade.id; data.updatedAt = now; this.#pruneIdempotency(); this.store.save(); return trade;
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

  due(now = this.now()) { return this.store.value.open.filter((trade) => now >= trade.expiresAt && (!Number.isFinite(Number(trade.nextSettlementAttemptAt)) || now >= Number(trade.nextSettlementAttemptAt))).map((trade) => structuredClone(trade)); }

  #recordLifetime(closed) {
    const totals = this.store.value.lifetime;
    const profit = Number(closed.profit) || 0;
    totals.total += 1; totals.realized = money(totals.realized + profit);
    if (closed.result === "win") { totals.wins += 1; totals.grossProfit = money(totals.grossProfit + Math.max(0, profit)); }
    else if (closed.result === "loss") { totals.losses += 1; totals.grossLoss = money(totals.grossLoss + Math.abs(Math.min(0, profit))); }
    else if (closed.result === "unresolved") totals.unresolved = (totals.unresolved || 0) + 1;
    else totals.draws += 1;
    totals.equity = money(this.store.value.initialBalance + totals.realized);
    totals.peakEquity = money(Math.max(Number(totals.peakEquity) || this.store.value.initialBalance, totals.equity));
    totals.maxDrawdown = Number(Math.max(Number(totals.maxDrawdown) || 0, totals.peakEquity > 0 ? ((totals.peakEquity - totals.equity) / totals.peakEquity) * 100 : 0).toFixed(2));
    totals.currentStreak = closed.result === "win" ? Math.max(1, Number(totals.currentStreak || 0) + 1) : closed.result === "loss" ? Math.min(-1, Number(totals.currentStreak || 0) - 1) : 0;
    totals.bestStreak = Math.max(Number(totals.bestStreak) || 0, totals.currentStreak);
    totals.worstStreak = Math.min(Number(totals.worstStreak) || 0, totals.currentStreak);
    totals.equityCurve = [...(Array.isArray(totals.equityCurve) ? totals.equityCurve : []), { at: closed.settledAt, value: totals.equity }].slice(-400);
  }

  settleResolved(resolutions = {}, now = this.now(), { toleranceMs = 1500 } = {}) {
    const data = this.store.value; const remaining = []; const settled = []; let changed = false;
    for (const trade of data.open) {
      if (now < trade.expiresAt) { remaining.push(trade); continue; }
      const datum = validateMarketDatum(resolutions[trade.id], { symbol: trade.symbol, now });
      if (!datum || datum.exchangeTimestamp > trade.expiresAt || trade.expiresAt - datum.exchangeTimestamp > toleranceMs) {
        trade.status = "pending_settlement"; trade.settlementAttempts = (trade.settlementAttempts || 0) + 1; trade.lastSettlementAttemptAt = now; changed = true;
        const terminal = trade.settlementAttempts >= this.settlementPolicy.maxAttempts || now - trade.expiresAt >= this.settlementPolicy.maxPendingMs;
        if (terminal) {
          const closed = { ...trade, status: "unresolved", result: "unresolved", exitPrice: null, exitPriceAt: null, exitPriceSource: null, closedAt: trade.expiresAt, settledAt: now, profit: 0, credit: trade.stake, settlementReason: "Preço autoritativo anterior ao vencimento não foi encontrado; valor devolvido." };
          data.balance = money(data.balance + trade.stake); data.results.push(closed); settled.push(closed); this.#recordLifetime(closed); continue;
        }
        const retryMs = Math.min(this.settlementPolicy.maxRetryMs, this.settlementPolicy.baseRetryMs * (2 ** Math.max(0, trade.settlementAttempts - 1)));
        trade.nextSettlementAttemptAt = now + retryMs; remaining.push(trade); continue;
      }
      const epsilon = trade.entryPrice * 1e-10; const delta = datum.value - trade.entryPrice; const draw = Math.abs(delta) <= epsilon; const win = !draw && (trade.direction === "up" ? delta > 0 : delta < 0); const result = draw ? "draw" : win ? "win" : "loss";
      const profit = money(draw ? 0 : win ? trade.stake * trade.payoutRate : -trade.stake); const credit = money(draw ? trade.stake : win ? trade.stake + profit : 0);
      data.balance = money(data.balance + credit);
      const closed = { ...trade, status: "settled", result, exitPrice: datum.value, exitPriceAt: datum.exchangeTimestamp, exitPriceSource: datum.source, closedAt: trade.expiresAt, settledAt: now, profit, credit };
      data.results.push(closed); settled.push(closed); this.#recordLifetime(closed); changed = true;
    }
    if (changed) {
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

module.exports = { ExpirySimulator, statistics, ALLOWED_DURATIONS, DEFAULT_SETTLEMENT_POLICY, migrate, validState, money, normalizeIdempotencyKey };
