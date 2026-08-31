"use strict";

const INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]);
const QUOTE = "USDT";

class AppError extends Error {
  constructor(message, { status = 400, code = "INVALID_INPUT", publicMessage = message, cause = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.publicMessage = publicMessage;
  }
}

function finiteNumber(value, name, { min = -Infinity, max = Infinity, allowNull = false } = {}) {
  if (allowNull && (value == null || value === "")) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new AppError(`${name} inválido.`, { code: "INVALID_NUMBER" });
  }
  return number;
}

function positiveNumber(value, name = "Valor") {
  return finiteNumber(value, name, { min: Number.MIN_VALUE });
}

function cleanSymbol(value, { requireUsdt = true } = {}) {
  const symbol = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(symbol) || (requireUsdt && !symbol.endsWith(QUOTE))) {
    throw new AppError("Par inválido. Use um par USDT disponível.", { code: "INVALID_SYMBOL" });
  }
  return symbol;
}

function cleanInterval(value) {
  const interval = String(value || "").trim();
  if (!INTERVALS.has(interval)) throw new AppError("Tempo gráfico inválido.", { code: "INVALID_INTERVAL" });
  return interval;
}

function cleanLimit(value, fallback = 180, max = 500) {
  if (value == null || value === "") return fallback;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1 || limit > max) throw new AppError(`Limite precisa ficar entre 1 e ${max}.`, { code: "INVALID_LIMIT" });
  return limit;
}

function plainObject(value, name = "Corpo JSON") {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new AppError(`${name} precisa ser um objeto.`, { code: "INVALID_BODY" });
  return value;
}

function validTimestamp(value, name = "Timestamp") {
  const timestamp = finiteNumber(value, name);
  if (timestamp < -8.64e15 || timestamp > 8.64e15 || Number.isNaN(new Date(timestamp).getTime())) {
    throw new AppError(`${name} fora do intervalo suportado.`, { code: "INVALID_TIMESTAMP" });
  }
  return timestamp;
}

function validateMarketDatum(datum, { maxAgeMs = Infinity, now = Date.now(), symbol = null } = {}) {
  if (!datum || typeof datum !== "object") return null;
  const value = Number(datum.value ?? datum.price);
  const exchangeTimestamp = Number(datum.exchangeTimestamp);
  const receivedAt = Number(datum.receivedAt);
  if (!(Number.isFinite(value) && value > 0 && Number.isFinite(exchangeTimestamp) && Number.isFinite(receivedAt))) return null;
  if (symbol && datum.symbol && cleanSymbol(datum.symbol) !== cleanSymbol(symbol)) return null;
  const ageMs = Math.max(0, now - receivedAt);
  const exchangeAgeMs = Math.max(0, now - exchangeTimestamp);
  const stale = Boolean(datum.stale) || ageMs > maxAgeMs || exchangeAgeMs > maxAgeMs;
  return { ...datum, value, exchangeTimestamp, receivedAt, ageMs, exchangeAgeMs, stale };
}

module.exports = {
  AppError,
  INTERVALS,
  cleanSymbol,
  cleanInterval,
  cleanLimit,
  finiteNumber,
  positiveNumber,
  plainObject,
  validTimestamp,
  validateMarketDatum,
};
