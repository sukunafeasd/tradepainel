"use strict";

const crypto = require("crypto");
const { JsonStore } = require("./storage.cjs");
const { AppError, cleanSymbol, cleanInterval, finiteNumber, validateMarketDatum } = require("./contracts.cjs");

const id = () => crypto.randomBytes(8).toString("hex");
const isRecord = (value) => Boolean(value && typeof value === "object" && !Array.isArray(value));
const symbolShape = (value) => typeof value === "string" && /^[A-Z0-9]{5,20}$/.test(value) && value.endsWith("USDT");
const intervals = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]);
const optionalFinite = (value, { positive = false } = {}) => value == null || (Number.isFinite(Number(value)) && (!positive || Number(value) > 0));
const validAlertRecord = (value) => {
  if (!isRecord(value) || !/^[a-f0-9]{16}$/.test(String(value.id || "")) || !symbolShape(value.symbol) || !["price_gte", "price_lte", "signal_buy", "signal_sell", "confidence_gte"].includes(value.kind) || typeof value.active !== "boolean" || !Number.isFinite(Number(value.createdAt)) || typeof value.note !== "string" || value.note.length > 300 || !["cross", "condition"].includes(value.mode)) return false;
  const price = ["price_gte", "price_lte"].includes(value.kind);
  if (price && (!(Number(value.value) > 0) || value.interval !== null)) return false;
  if (value.kind === "confidence_gte" && (!(Number(value.value) >= 0 && Number(value.value) <= 100) || !intervals.has(value.interval))) return false;
  if (["signal_buy", "signal_sell"].includes(value.kind) && !intervals.has(value.interval)) return false;
  return optionalFinite(value.triggeredAt) && optionalFinite(value.hitPrice, { positive: true }) && optionalFinite(value.lastObservedPrice, { positive: true }) && optionalFinite(value.lastObservedAt) && optionalFinite(value.lastBaselinePersistedAt);
};
const validJournalRecord = (value) => isRecord(value) && /^[a-f0-9]{16}$/.test(String(value.id || "")) && symbolShape(value.symbol) && intervals.has(value.interval) && Number.isFinite(Number(value.createdAt)) && ["buy", "sell", "observe"].includes(value.side) && typeof value.note === "string" && value.note.length <= 2000 && typeof value.setup === "string" && value.setup.length <= 120 && typeof value.result === "string" && value.result.length <= 40 && optionalFinite(value.entry, { positive: true }) && optionalFinite(value.stop, { positive: true }) && optionalFinite(value.target, { positive: true }) && value.screenshot === null;
const validAlertArray = (value) => Array.isArray(value) && value.every(validAlertRecord);
const validJournalArray = (value) => Array.isArray(value) && value.every(validJournalRecord);
const migrateAlerts = (value) => !Array.isArray(value) ? value : value.filter(isRecord).map((alert) => ({ ...alert, interval: ["price_gte", "price_lte"].includes(alert.kind) ? null : String(alert.interval || "15m"), mode: alert.mode === "condition" ? "condition" : "cross", active: Boolean(alert.active), note: String(alert.note || "").slice(0, 300), triggeredAt: optionalFinite(alert.triggeredAt) ? alert.triggeredAt ?? null : null, hitPrice: optionalFinite(alert.hitPrice, { positive: true }) ? alert.hitPrice ?? null : null, lastObservedPrice: optionalFinite(alert.lastObservedPrice, { positive: true }) ? alert.lastObservedPrice ?? null : null, lastObservedAt: optionalFinite(alert.lastObservedAt) ? alert.lastObservedAt ?? null : null, lastBaselinePersistedAt: optionalFinite(alert.lastBaselinePersistedAt) ? alert.lastBaselinePersistedAt ?? Number(alert.createdAt) : Number(alert.createdAt) })).filter(validAlertRecord);
const migrateJournal = (value) => !Array.isArray(value) ? value : value.filter(isRecord).map((entry) => ({ ...entry, interval: String(entry.interval || "15m"), side: ["buy", "sell", "observe"].includes(entry.side) ? entry.side : "observe", setup: String(entry.setup || "").slice(0, 120), note: String(entry.note || "").slice(0, 2000), result: String(entry.result || "aberto").slice(0, 40), entry: optionalFinite(entry.entry, { positive: true }) ? entry.entry ?? null : null, stop: optionalFinite(entry.stop, { positive: true }) ? entry.stop ?? null : null, target: optionalFinite(entry.target, { positive: true }) ? entry.target ?? null : null, screenshot: null })).filter(validJournalRecord);

class AlertsStore {
  constructor(dataDirectory, { maxAlerts = 1000, now = () => Date.now() } = {}) {
    this.store = new JsonStore(dataDirectory, "alerts.json", [], { validate: validAlertArray, migrate: migrateAlerts });
    this.maxAlerts = maxAlerts;
    this.now = now;
  }
  list({ limit = this.maxAlerts } = {}) { return [...this.store.value].sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))).slice(0, limit); }
  add({ symbol, interval = "15m", kind, value, note = "", currentDatum = null, mode = "cross" }) {
    const kinds = ["price_gte", "price_lte", "signal_buy", "signal_sell", "confidence_gte"];
    if (!kinds.includes(kind)) throw new AppError("Tipo de alerta inválido.", { code: "INVALID_ALERT_KIND" });
    const clean = cleanSymbol(symbol); const frame = ["price_gte", "price_lte"].includes(kind) ? null : cleanInterval(interval); const numericValue = value == null || value === "" ? null : finiteNumber(value, "Valor do alerta");
    if (["price_gte", "price_lte"].includes(kind) && !(numericValue > 0)) throw new AppError("Preço-alvo inválido.", { code: "INVALID_ALERT_VALUE" });
    if (kind === "confidence_gte" && !(numericValue >= 0 && numericValue <= 100)) throw new AppError("A confiança precisa ficar entre 0% e 100%.", { code: "INVALID_ALERT_VALUE" });
    if (this.store.value.length >= this.maxAlerts) throw new AppError(`Limite de ${this.maxAlerts} alertas atingido. Exclua ou arquive alertas antigos.`, { status: 409, code: "ALERT_LIMIT" });
    const now = this.now(); const datum = validateMarketDatum(currentDatum, { symbol: clean, maxAgeMs: 5000, now });
    const alert = { id: id(), symbol: clean, interval: frame, kind, value: numericValue, note: String(note).slice(0, 300), mode: mode === "condition" ? "condition" : "cross", active: true, triggeredAt: null, hitPrice: null, createdAt: now, lastObservedPrice: datum && !datum.stale ? datum.value : null, lastObservedAt: datum && !datum.stale ? datum.exchangeTimestamp : null, lastBaselinePersistedAt: now };
    this.store.value.push(alert); this.store.save(); return alert;
  }
  remove(alertId) { const before = this.store.value.length; this.store.value = this.store.value.filter((alert) => alert.id !== alertId); const removed = before !== this.store.value.length; if (removed) this.store.save(); return removed; }
  checkPrice(datum) {
    const valid = validateMarketDatum(datum, { symbol: datum?.symbol, maxAgeMs: 5000, now: this.now() });
    if (!valid || valid.stale) return [];
    const hits = []; let baselineChanged = false; const now = this.now();
    for (const alert of this.store.value) {
      if (!alert.active || alert.symbol !== valid.symbol || !["price_gte", "price_lte"].includes(alert.kind)) continue;
      const previous = alert.lastObservedPrice == null ? null : Number(alert.lastObservedPrice);
      const condition = alert.kind === "price_gte" ? valid.value >= alert.value : valid.value <= alert.value;
      const crossed = alert.kind === "price_gte" ? Number.isFinite(previous) && previous < alert.value && valid.value >= alert.value : Number.isFinite(previous) && previous > alert.value && valid.value <= alert.value;
      alert.lastObservedPrice = valid.value; alert.lastObservedAt = valid.exchangeTimestamp;
      if (!Number.isFinite(previous) || now - Number(alert.lastBaselinePersistedAt || 0) >= 15000) { alert.lastBaselinePersistedAt = now; baselineChanged = true; }
      if ((alert.mode === "condition" && condition) || (alert.mode !== "condition" && crossed)) { alert.active = false; alert.triggeredAt = now; alert.hitPrice = valid.value; alert.hitPriceAt = valid.exchangeTimestamp; hits.push(structuredClone(alert)); }
    }
    if (hits.length || baselineChanged) this.store.save();
    return hits;
  }
  check(datums) { return Object.values(datums || {}).flatMap((datum) => this.checkPrice(datum)); }
  checkAnalysis(analysis) {
    if (!analysis || analysis.signal === "INDISPONÍVEL" || Number(analysis.dataQuality?.score || 0) < 60) return [];
    const hits = [];
    for (const alert of this.store.value) {
      if (!alert.active || alert.symbol !== analysis.symbol || alert.interval !== analysis.interval) continue;
      const hit = alert.kind === "signal_buy" ? analysis.signal === "COMPRA" : alert.kind === "signal_sell" ? analysis.signal === "VENDA" : alert.kind === "confidence_gte" ? Number(analysis.confidence) >= Number(alert.value) && analysis.signal !== "AGUARDE" : false;
      if (hit) { alert.active = false; alert.triggeredAt = this.now(); alert.hitPrice = analysis.price; alert.hitSignal = analysis.signal; alert.hitConfidence = analysis.confidence; alert.analysisId = analysis.id; hits.push(structuredClone(alert)); }
    }
    if (hits.length) this.store.save(); return hits;
  }
  analysisTargets(limit = 25) {
    const unique = new Map();
    for (const alert of this.store.value) {
      if (!alert.active || !["signal_buy", "signal_sell", "confidence_gte"].includes(alert.kind)) continue;
      unique.set(`${alert.symbol}|${alert.interval}`, { symbol: alert.symbol, interval: alert.interval });
      if (unique.size >= limit) break;
    }
    return [...unique.values()];
  }
}

class JournalStore {
  constructor(dataDirectory, { maxEntries = 5000, now = () => Date.now() } = {}) { this.store = new JsonStore(dataDirectory, "journal.json", [], { validate: validJournalArray, migrate: migrateJournal }); this.maxEntries = maxEntries; this.now = now; }
  list({ offset = 0, limit = 100, query = "" } = {}) { const search = String(query).trim().toLowerCase(); return [...this.store.value].filter((entry) => !search || JSON.stringify(entry).toLowerCase().includes(search)).sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))).slice(offset, offset + limit); }
  page({ offset = 0, limit = 100, query = "" } = {}) { const search = String(query).trim().toLowerCase(); const rows = [...this.store.value].filter((entry) => !search || `${entry.symbol} ${entry.interval} ${entry.setup} ${entry.note} ${entry.result}`.toLowerCase().includes(search)).sort((a, b) => b.createdAt - a.createdAt || String(b.id).localeCompare(String(a.id))); const safeOffset = Math.max(0, Number(offset) || 0); const items = rows.slice(safeOffset, safeOffset + limit); return { items, total: rows.length, offset: safeOffset, limit, hasMore: safeOffset + items.length < rows.length, query: String(query || "") }; }
  add(entry) {
    if (this.store.value.length >= this.maxEntries) throw new AppError(`Limite de ${this.maxEntries} anotações atingido. Exporte o diário antes de continuar.`, { status: 409, code: "JOURNAL_LIMIT" });
    const record = { id: id(), createdAt: this.now(), symbol: cleanSymbol(entry.symbol), interval: cleanInterval(entry.interval || "15m"), side: ["buy", "sell", "observe"].includes(entry.side) ? entry.side : "observe", setup: String(entry.setup || "").slice(0, 120), entry: entry.entry == null || entry.entry === "" ? null : finiteNumber(entry.entry, "Entrada", { min: Number.MIN_VALUE }), stop: entry.stop == null || entry.stop === "" ? null : finiteNumber(entry.stop, "Stop", { min: Number.MIN_VALUE }), target: entry.target == null || entry.target === "" ? null : finiteNumber(entry.target, "Alvo", { min: Number.MIN_VALUE }), result: String(entry.result || "aberto").slice(0, 40), note: String(entry.note || "").slice(0, 2000), screenshot: null };
    this.store.value.push(record); this.store.save(); return record;
  }
  remove(entryId) { const before = this.store.value.length; this.store.value = this.store.value.filter((entry) => entry.id !== entryId); const removed = before !== this.store.value.length; if (removed) this.store.save(); return removed; }
}

module.exports = { AlertsStore, JournalStore, validAlertArray, validJournalArray, migrateAlerts, migrateJournal };
