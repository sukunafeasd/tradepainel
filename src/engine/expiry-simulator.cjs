"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");

const id = () => crypto.randomBytes(8).toString("hex");
const initial = () => ({ initialBalance: 10000, balance: 10000, payoutRate: 0.82, open: [], results: [], updatedAt: Date.now() });

class ExpirySimulator {
  constructor(dataDirectory) { this.store = new JsonStore(dataDirectory, "expiry-simulator.json", initial); }

  place({ symbol, direction, stake, entryPrice, durationMs, interval = "1m", note = "" }) {
    const data = this.store.value;
    const cleanSymbol = String(symbol || "").toUpperCase();
    const amount = Number(stake);
    const price = Number(entryPrice);
    const duration = Math.max(5000, Math.min(Number(durationMs) || 60000, 86400000));
    if (!/^[A-Z0-9]{5,20}$/.test(cleanSymbol)) throw new Error("Par inválido.");
    if (!["up", "down"].includes(direction)) throw new Error("Direção inválida.");
    if (!(amount >= 1)) throw new Error("O valor mínimo simulado é US$ 1.");
    if (!(price > 0)) throw new Error("Preço de entrada indisponível.");
    if (amount > data.balance + 1e-8) throw new Error(`Saldo simulado insuficiente. Disponível: US$ ${data.balance.toFixed(2)}.`);
    const openedAt = Date.now();
    const trade = { id: id(), symbol: cleanSymbol, direction, stake: amount, entryPrice: price, currentPrice: price, openedAt, expiresAt: openedAt + duration, durationMs: duration, interval: String(interval), payoutRate: data.payoutRate, note: String(note || "").slice(0, 300), status: "open" };
    data.balance -= amount;
    data.open.push(trade);
    data.updatedAt = openedAt;
    this.store.save();
    return trade;
  }

  settle(prices = {}, now = Date.now()) {
    const data = this.store.value;
    const remaining = [];
    const settled = [];
    for (const trade of data.open) {
      const price = Number(prices[trade.symbol]);
      if (Number.isFinite(price) && price > 0) trade.currentPrice = price;
      if (now < trade.expiresAt || !(trade.currentPrice > 0)) { remaining.push(trade); continue; }
      const epsilon = trade.entryPrice * 1e-10;
      const delta = trade.currentPrice - trade.entryPrice;
      const draw = Math.abs(delta) <= epsilon;
      const win = !draw && (trade.direction === "up" ? delta > 0 : delta < 0);
      const result = draw ? "draw" : win ? "win" : "loss";
      const profit = draw ? 0 : win ? trade.stake * trade.payoutRate : -trade.stake;
      const credit = draw ? trade.stake : win ? trade.stake + profit : 0;
      data.balance += credit;
      const closed = { ...trade, status: "settled", result, exitPrice: trade.currentPrice, closedAt: now, profit, credit };
      data.results.push(closed); settled.push(closed);
    }
    if (settled.length) {
      data.open = remaining;
      data.results = data.results.slice(-3000);
      data.updatedAt = now;
      this.store.save();
    }
    return settled;
  }

  snapshot(prices = {}, now = Date.now()) {
    this.settle(prices, now);
    const data = this.store.value;
    data.open.forEach((trade) => { const p = Number(prices[trade.symbol]); if (p > 0) trade.currentPrice = p; });
    const wins = data.results.filter((x) => x.result === "win").length;
    const losses = data.results.filter((x) => x.result === "loss").length;
    const draws = data.results.filter((x) => x.result === "draw").length;
    const realized = data.results.reduce((sum, x) => sum + Number(x.profit || 0), 0);
    const locked = data.open.reduce((sum, x) => sum + x.stake, 0);
    const equity = data.balance + locked;
    return { initialBalance: data.initialBalance, balance: Number(data.balance.toFixed(2)), equity: Number(equity.toFixed(2)), locked: Number(locked.toFixed(2)), payoutRate: data.payoutRate, realized: Number(realized.toFixed(2)), totalReturn: data.initialBalance ? ((equity / data.initialBalance) - 1) * 100 : 0, wins, losses, draws, winRate: wins + losses ? wins / (wins + losses) * 100 : 0, open: data.open.map((x) => ({ ...x, remainingMs: Math.max(0, x.expiresAt - now) })).sort((a,b)=>a.expiresAt-b.expiresAt), results: data.results.slice(-200).reverse(), updatedAt: data.updatedAt };
  }

  reset(balance = 10000) {
    const amount = Math.max(100, Math.min(Number(balance) || 10000, 100000000));
    this.store.value = { ...initial(), initialBalance: amount, balance: amount };
    this.store.save();
    return this.snapshot();
  }
}

module.exports = { ExpirySimulator };

