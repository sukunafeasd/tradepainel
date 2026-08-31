"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");

const id = () => crypto.randomBytes(8).toString("hex");
const initialState = () => ({ initialBalance: 10000, cash: 10000, feeRate: 0.001, positions: {}, trades: [], updatedAt: Date.now() });

class PaperPortfolio {
  constructor(dataDirectory) {
    this.store = new JsonStore(dataDirectory, "paper-portfolio.json", initialState);
  }

  snapshot(prices = {}) {
    const data = this.store.value;
    const positions = Object.entries(data.positions).map(([symbol, position]) => {
      const last = Number(prices[symbol] ?? position.last ?? position.average);
      const marketValue = last * position.quantity;
      const unrealized = (last - position.average) * position.quantity;
      return { symbol, ...position, last, marketValue, unrealized, unrealizedPct: position.average ? ((last / position.average) - 1) * 100 : 0 };
    });
    const marketValue = positions.reduce((sum, position) => sum + position.marketValue, 0);
    const equity = data.cash + marketValue;
    const realized = data.trades.reduce((sum, trade) => sum + (trade.realizedPnl || 0), 0);
    const fees = data.trades.reduce((sum, trade) => sum + trade.fee, 0);
    return {
      initialBalance: data.initialBalance,
      cash: Number(data.cash.toFixed(2)),
      equity: Number(equity.toFixed(2)),
      totalReturn: data.initialBalance ? ((equity / data.initialBalance) - 1) * 100 : 0,
      realized: Number(realized.toFixed(2)), fees: Number(fees.toFixed(2)), positions,
      trades: data.trades.slice(-150).reverse(), updatedAt: data.updatedAt,
    };
  }

  order({ symbol, side, quantity, price, stop = null, target = null, note = "" }) {
    const data = this.store.value;
    const cleanSymbol = String(symbol || "").toUpperCase();
    const qty = Number(quantity);
    const px = Number(price);
    if (!/^[A-Z0-9]{5,20}$/.test(cleanSymbol)) throw new Error("Par inválido.");
    if (!["buy", "sell"].includes(side)) throw new Error("Lado inválido.");
    if (!(qty > 0) || !(px > 0)) throw new Error("Quantidade e preço precisam ser positivos.");
    const gross = qty * px;
    const fee = gross * data.feeRate;
    let realizedPnl = null;
    if (side === "buy") {
      if (gross + fee > data.cash + 1e-8) throw new Error("Saldo simulado insuficiente.");
      const current = data.positions[cleanSymbol] || { quantity: 0, average: 0, stop: null, target: null, note: "" };
      const nextQuantity = current.quantity + qty;
      current.average = ((current.average * current.quantity) + gross) / nextQuantity;
      current.quantity = nextQuantity;
      current.last = px;
      current.stop = Number(stop) > 0 ? Number(stop) : current.stop;
      current.target = Number(target) > 0 ? Number(target) : current.target;
      current.note = String(note || current.note || "").slice(0, 300);
      data.positions[cleanSymbol] = current;
      data.cash -= gross + fee;
    } else {
      const current = data.positions[cleanSymbol];
      if (!current || current.quantity + 1e-12 < qty) throw new Error("Posição simulada insuficiente.");
      realizedPnl = (px - current.average) * qty - fee;
      data.cash += gross - fee;
      current.quantity -= qty;
      current.last = px;
      if (current.quantity <= 1e-12) delete data.positions[cleanSymbol];
    }
    const trade = { id: id(), at: Date.now(), symbol: cleanSymbol, side, quantity: qty, price: px, gross, fee, realizedPnl, note: String(note || "").slice(0, 300) };
    data.trades.push(trade);
    data.trades = data.trades.slice(-2000);
    data.updatedAt = Date.now();
    this.store.save();
    return trade;
  }

  reset(balance = 10000) {
    const amount = Math.max(100, Math.min(Number(balance) || 10000, 100000000));
    this.store.value = { ...initialState(), initialBalance: amount, cash: amount };
    this.store.save();
    return this.snapshot();
  }
}

class AlertsStore {
  constructor(dataDirectory) {
    this.store = new JsonStore(dataDirectory, "alerts.json", []);
  }
  list() { return [...this.store.value].sort((a, b) => b.createdAt - a.createdAt); }
  add({ symbol, kind, value, note = "" }) {
    const kinds = ["price_gte", "price_lte", "signal_buy", "signal_sell", "confidence_gte"];
    if (!kinds.includes(kind)) throw new Error("Tipo de alerta inválido.");
    const numericValue = Number(value);
    if (["price_gte", "price_lte"].includes(kind) && !(numericValue > 0)) throw new Error("Preço-alvo inválido.");
    if (kind === "confidence_gte" && !(numericValue >= 30 && numericValue <= 100)) throw new Error("A confluência precisa ficar entre 30% e 100%.");
    const alert = { id: id(), symbol: String(symbol).toUpperCase(), kind, value: Number.isFinite(numericValue) ? numericValue : null, note: String(note).slice(0, 300), active: true, triggeredAt: null, hitPrice: null, createdAt: Date.now() };
    this.store.value.push(alert);
    this.store.save();
    return alert;
  }
  remove(alertId) { this.store.value = this.store.value.filter((alert) => alert.id !== alertId); this.store.save(); }
  check(prices) {
    const hits = [];
    for (const alert of this.store.value) {
      if (!alert.active || !Number.isFinite(prices[alert.symbol])) continue;
      const price = prices[alert.symbol];
      if (!["price_gte", "price_lte"].includes(alert.kind)) continue;
      const hit = alert.kind === "price_gte" ? price >= alert.value : price <= alert.value;
      if (hit) { alert.active = false; alert.triggeredAt = Date.now(); alert.hitPrice = price; hits.push(alert); }
    }
    if (hits.length) this.store.save();
    return hits;
  }
  checkAnalysis(analysis) {
    const hits = [];
    for (const alert of this.store.value) {
      if (!alert.active || alert.symbol !== analysis.symbol) continue;
      const hit = alert.kind === "signal_buy" ? analysis.signal === "COMPRA"
        : alert.kind === "signal_sell" ? analysis.signal === "VENDA"
          : alert.kind === "confidence_gte" ? Number(analysis.confidence) >= Number(alert.value) && analysis.signal !== "AGUARDE"
            : false;
      if (hit) {
        alert.active = false;
        alert.triggeredAt = Date.now();
        alert.hitPrice = analysis.price;
        alert.hitSignal = analysis.signal;
        alert.hitConfidence = analysis.confidence;
        hits.push(alert);
      }
    }
    if (hits.length) this.store.save();
    return hits;
  }
}

class JournalStore {
  constructor(dataDirectory) { this.store = new JsonStore(dataDirectory, "journal.json", []); }
  list() { return [...this.store.value].sort((a, b) => b.createdAt - a.createdAt); }
  add(entry) {
    const record = {
      id: id(), createdAt: Date.now(), symbol: String(entry.symbol || "").toUpperCase(), interval: String(entry.interval || "15m"),
      side: ["buy", "sell", "observe"].includes(entry.side) ? entry.side : "observe", setup: String(entry.setup || "").slice(0, 120),
      entry: Number(entry.entry) || null, stop: Number(entry.stop) || null, target: Number(entry.target) || null,
      result: String(entry.result || "aberto").slice(0, 40), note: String(entry.note || "").slice(0, 2000), screenshot: null,
    };
    this.store.value.push(record);
    this.store.value = this.store.value.slice(-5000);
    this.store.save();
    return record;
  }
  remove(entryId) { this.store.value = this.store.value.filter((entry) => entry.id !== entryId); this.store.save(); }
}

module.exports = { PaperPortfolio, AlertsStore, JournalStore };
