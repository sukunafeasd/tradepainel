"use strict";

class ExchangeClock {
  constructor({ now = () => Date.now(), monotonic = () => performance.now() } = {}) {
    this.wallNow = now;
    this.monotonicNow = monotonic;
    this.offsetMs = 0;
    this.syncedAtMono = null;
    this.syncedServerTime = null;
    this.rttMs = null;
  }

  now() {
    if (this.syncedAtMono == null) return this.wallNow() + this.offsetMs;
    return this.syncedServerTime + (this.monotonicNow() - this.syncedAtMono);
  }

  monotonic() { return this.monotonicNow(); }

  sync(serverTime, { requestStartedMono = this.monotonicNow(), responseReceivedMono = this.monotonicNow() } = {}) {
    const remote = Number(serverTime);
    if (!Number.isFinite(remote)) throw new Error("Horário remoto inválido.");
    const midpoint = requestStartedMono + (responseReceivedMono - requestStartedMono) / 2;
    this.rttMs = Math.max(0, responseReceivedMono - requestStartedMono);
    this.syncedServerTime = remote;
    this.syncedAtMono = midpoint;
    this.offsetMs = this.now() - this.wallNow();
    return this.status();
  }

  status() {
    return { synced: this.syncedAtMono != null, offsetMs: Math.round(this.offsetMs), rttMs: this.rttMs == null ? null : Math.round(this.rttMs), now: Math.round(this.now()) };
  }
}

module.exports = { ExchangeClock };
