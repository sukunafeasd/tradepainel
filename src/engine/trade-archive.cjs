"use strict";

const fs = require("fs");
const path = require("path");
const { StorageError } = require("./storage.cjs");

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

class TradeArchive {
  constructor(directory, name = "expiry-results.ndjson", { validate = null, key = (row) => row?.id } = {}) {
    this.file = path.join(directory, name);
    this.validate = typeof validate === "function" ? validate : () => true;
    this.key = key;
    this.issues = [];
    this.rows = [];
    this.keys = new Set();
    this.#load();
  }

  #load() {
    let raw;
    try { raw = fs.readFileSync(this.file, "utf8"); }
    catch (error) { if (error?.code === "ENOENT") return; this.issues.push({ code: error?.code || "ARCHIVE_READ_FAILED", message: "Não foi possível ler o histórico completo." }); return; }
    let needsRepair = false;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        const key = String(this.key(row) || "");
        if (!key || !this.validate(row)) { needsRepair = true; continue; }
        if (this.keys.has(key)) { needsRepair = true; continue; }
        this.keys.add(key); this.rows.push(row);
      } catch { needsRepair = true; }
    }
    if (needsRepair) this.#repair(raw);
  }

  #repair(raw) {
    try {
      const quarantined = `${this.file}.corrupt-${stamp()}`;
      fs.renameSync(this.file, quarantined);
      this.#rewrite();
      this.issues.push({ code: "ARCHIVE_REPAIRED", message: "Linhas inválidas ou duplicadas do histórico foram isoladas.", recovery: { quarantined } });
    } catch (error) {
      this.issues.push({ code: error?.code || "ARCHIVE_REPAIR_FAILED", message: "O histórico contém linhas inválidas e não pôde ser reparado automaticamente." });
    }
  }

  #rewrite() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}-${Date.now()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "w", 0o600);
      const payload = this.rows.length ? `${this.rows.map((row) => JSON.stringify(row)).join("\n")}\n` : "";
      fs.writeFileSync(descriptor, payload, "utf8"); fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = null;
      fs.renameSync(temporary, this.file);
    } catch (error) {
      if (descriptor != null) try { fs.closeSync(descriptor); } catch {}
      try { fs.unlinkSync(temporary); } catch {}
      throw new StorageError("Não foi possível reparar o histórico completo.", { code: error?.code || "ARCHIVE_REWRITE_FAILED", file: this.file, cause: error });
    }
  }

  append(records) {
    const accepted = [];
    const acceptedKeys = new Set();
    for (const row of Array.isArray(records) ? records : [records]) {
      const key = String(this.key(row) || "");
      if (!key || !this.validate(row)) throw new StorageError("Uma operação inválida não pôde ser arquivada.", { code: "INVALID_ARCHIVE_RECORD", file: this.file });
      // A single settlement batch may itself contain a duplicate. Checking both
      // the durable index and this in-flight batch keeps the NDJSON idempotent.
      if (!this.keys.has(key) && !acceptedKeys.has(key)) {
        acceptedKeys.add(key);
        accepted.push(row);
      }
    }
    if (!accepted.length) return 0;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    let descriptor;
    try {
      descriptor = fs.openSync(this.file, "a", 0o600);
      fs.writeFileSync(descriptor, `${accepted.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
      fs.fsyncSync(descriptor); fs.closeSync(descriptor); descriptor = null;
    } catch (error) {
      if (descriptor != null) try { fs.closeSync(descriptor); } catch {}
      throw new StorageError("Não foi possível preservar o histórico completo.", { code: error?.code || "ARCHIVE_APPEND_FAILED", file: this.file, cause: error });
    }
    for (const row of accepted) { const key = String(this.key(row)); this.keys.add(key); this.rows.push(structuredClone(row)); }
    return accepted.length;
  }

  all() { return this.rows.map((row) => structuredClone(row)); }
  has(recordOrKey) { return this.keys.has(String(typeof recordOrKey === "object" ? this.key(recordOrKey) : recordOrKey)); }
  get size() { return this.rows.length; }

  clear() {
    this.rows = []; this.keys.clear();
    try { fs.unlinkSync(this.file); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }

  diagnostics() { return { file: this.file, records: this.size, issues: this.issues.slice() }; }
}

module.exports = { TradeArchive };
