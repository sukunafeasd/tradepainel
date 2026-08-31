"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");
const { AppError, cleanSymbol, cleanInterval, finiteNumber, validateMarketDatum } = require("./contracts.cjs");

const id = () => crypto.randomBytes(8).toString("hex");
const arraySchema = (value) => Array.isArray(value);

class AlertsStore {
  constructor(dataDirectory, { maxAlerts = 1000, now = () => Date.now() } = {}) {
    this.store = new JsonStore(dataDirectory, "alerts.json", [], { validate: arraySchema });
    this.maxAlerts = maxAlerts;
    this.now = now;
  }
  list({ limit = this.maxAlerts } = {}) { return [...this.store.value].sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))).slice(0, limit); }
  add({ symbol, kind, value, note = "", currentDatum = null, mode = "cross" }) {
    const kinds = ["price_gte", "price_lte", "signal_buy", "signal_sell", "confidence_gte"];
    if (!kinds.includes(kind)) throw new AppError("Tipo de alerta inválido.", { code: "INVALID_ALERT_KIND" });
    const clean = cleanSymbol(symbol); const numericValue = value == null || value === "" ? null : finiteNumber(value, "Valor do alerta");
    if (["price_gte", "price_lte"].includes(kind) && !(numericValue > 0)) throw new AppError("Preço-alvo inválido.", { code: "INVALID_ALERT_VALUE" });
    if (kind === "confidence_gte" && !(numericValue >= 0 && numericValue <= 100)) throw new AppError("A confiança precisa ficar entre 0% e 100%.", { code: "INVALID_ALERT_VALUE" });
    if (this.store.value.length >= this.maxAlerts) throw new AppError(`Limite de ${this.maxAlerts} alertas atingido. Exclua ou arquive alertas antigos.`, { status: 409, code: "ALERT_LIMIT" });
    const datum = validateMarketDatum(currentDatum, { symbol: clean, maxAgeMs: 5000, now: this.now() });
    const alert = { id: id(), symbol: clean, kind, value: numericValue, note: String(note).slice(0, 300), mode: mode === "condition" ? "condition" : "cross", active: true, triggeredAt: null, hitPrice: null, createdAt: this.now(), lastObservedPrice: datum && !datum.stale ? datum.value : null, lastObservedAt: datum && !datum.stale ? datum.exchangeTimestamp : null };
    this.store.value.push(alert); this.store.save(); return alert;
  }
  remove(alertId) { const before = this.store.value.length; this.store.value = this.store.value.filter((alert) => alert.id !== alertId); const removed = before !== this.store.value.length; if (removed) this.store.save(); return removed; }
  checkPrice(datum) {
    const valid = validateMarketDatum(datum, { symbol: datum?.symbol, maxAgeMs: 5000, now: this.now() });
    if (!valid || valid.stale) return [];
    const hits = [];
    for (const alert of this.store.value) {
      if (!alert.active || alert.symbol !== valid.symbol || !["price_gte", "price_lte"].includes(alert.kind)) continue;
      const previous = Number(alert.lastObservedPrice);
      const condition = alert.kind === "price_gte" ? valid.value >= alert.value : valid.value <= alert.value;
      const crossed = alert.kind === "price_gte" ? Number.isFinite(previous) && previous < alert.value && valid.value >= alert.value : Number.isFinite(previous) && previous > alert.value && valid.value <= alert.value;
      alert.lastObservedPrice = valid.value; alert.lastObservedAt = valid.exchangeTimestamp;
      if ((alert.mode === "condition" && condition) || (alert.mode !== "condition" && crossed)) { alert.active = false; alert.triggeredAt = this.now(); alert.hitPrice = valid.value; alert.hitPriceAt = valid.exchangeTimestamp; hits.push(structuredClone(alert)); }
    }
    // Observations stay in memory; only durable state transitions hit the disk.
    if (hits.length) this.store.save();
    return hits;
  }
  check(datums) { return Object.values(datums || {}).flatMap((datum) => this.checkPrice(datum)); }
  checkAnalysis(analysis) {
    if (!analysis || analysis.signal === "INDISPONÍVEL" || Number(analysis.dataQuality?.score || 0) < 60) return [];
    const hits = [];
    for (const alert of this.store.value) {
      if (!alert.active || alert.symbol !== analysis.symbol) continue;
      const hit = alert.kind === "signal_buy" ? analysis.signal === "COMPRA" : alert.kind === "signal_sell" ? analysis.signal === "VENDA" : alert.kind === "confidence_gte" ? Number(analysis.confidence) >= Number(alert.value) && analysis.signal !== "AGUARDE" : false;
      if (hit) { alert.active = false; alert.triggeredAt = this.now(); alert.hitPrice = analysis.price; alert.hitSignal = analysis.signal; alert.hitConfidence = analysis.confidence; alert.analysisId = analysis.id; hits.push(structuredClone(alert)); }
    }
    if (hits.length) this.store.save(); return hits;
  }
}

class JournalStore {
  constructor(dataDirectory, { maxEntries = 5000, now = () => Date.now() } = {}) { this.store = new JsonStore(dataDirectory, "journal.json", [], { validate: arraySchema }); this.maxEntries = maxEntries; this.now = now; }
  list({ offset = 0, limit = 100, query = "" } = {}) { const search = String(query).trim().toLowerCase(); return [...this.store.value].filter((entry) => !search || JSON.stringify(entry).toLowerCase().includes(search)).sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))).slice(offset, offset + limit); }
  add(entry) {
    if (this.store.value.length >= this.maxEntries) throw new AppError(`Limite de ${this.maxEntries} anotações atingido. Exporte o diário antes de continuar.`, { status: 409, code: "JOURNAL_LIMIT" });
    const record = { id: id(), createdAt: this.now(), symbol: cleanSymbol(entry.symbol), interval: cleanInterval(entry.interval || "15m"), side: ["buy", "sell", "observe"].includes(entry.side) ? entry.side : "observe", setup: String(entry.setup || "").slice(0, 120), entry: entry.entry == null || entry.entry === "" ? null : finiteNumber(entry.entry, "Entrada", { min: Number.MIN_VALUE }), stop: entry.stop == null || entry.stop === "" ? null : finiteNumber(entry.stop, "Stop", { min: Number.MIN_VALUE }), target: entry.target == null || entry.target === "" ? null : finiteNumber(entry.target, "Alvo", { min: Number.MIN_VALUE }), result: String(entry.result || "aberto").slice(0, 40), note: String(entry.note || "").slice(0, 2000), screenshot: null };
    this.store.value.push(record); this.store.save(); return record;
  }
  remove(entryId) { const before = this.store.value.length; this.store.value = this.store.value.filter((entry) => entry.id !== entryId); const removed = before !== this.store.value.length; if (removed) this.store.save(); return removed; }
}

module.exports = { AlertsStore, JournalStore };
