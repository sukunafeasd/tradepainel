"use strict";

const fs = require("fs");
const path = require("path");

const cloneFallback = (fallback) => typeof fallback === "function" ? fallback() : structuredClone(fallback);
const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

class StorageError extends Error {
  constructor(message, { code = "STORAGE_ERROR", file = null, cause = null, recovery = null } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "StorageError";
    this.code = code;
    this.file = file;
    this.recovery = recovery;
  }
}

function quarantine(file, suffix = "corrupt") {
  if (!fs.existsSync(file)) return null;
  const target = `${file}.${suffix}-${stamp()}`;
  fs.renameSync(file, target);
  return target;
}

function cleanTemporaryFiles(file) {
  const directory = path.dirname(file);
  if (!fs.existsSync(directory)) return [];
  const prefix = `${path.basename(file)}.`;
  const removed = [];
  for (const name of fs.readdirSync(directory)) {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) continue;
    const candidate = path.join(directory, name);
    try { fs.unlinkSync(candidate); removed.push(candidate); } catch {}
  }
  return removed;
}

function readJson(file, fallback, { validate = null, migrate = null, onIssue = null, recoverBackup = true } = {}) {
  const base = cloneFallback(fallback);
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) throw new StorageError("O arquivo está vazio.", { code: "EMPTY_JSON", file });
    let parsed = JSON.parse(raw);
    if (parsed == null) throw new StorageError("O arquivo contém null.", { code: "NULL_JSON", file });
    if (typeof migrate === "function") parsed = migrate(parsed);
    if (typeof validate === "function" && !validate(parsed)) throw new StorageError("O arquivo não corresponde ao schema esperado.", { code: "INVALID_SCHEMA", file });
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT" && (!recoverBackup || !fs.existsSync(`${file}.bak`))) return base;
    const issue = error instanceof StorageError ? error : new StorageError("Não foi possível ler os dados persistidos.", { code: error instanceof SyntaxError ? "INVALID_JSON" : error?.code || "READ_FAILED", file, cause: error });
    let recovery = null;
    if (recoverBackup) {
      const backup = `${file}.bak`;
      try {
        const restored = JSON.parse(fs.readFileSync(backup, "utf8"));
        const migrated = typeof migrate === "function" ? migrate(restored) : restored;
        if (migrated != null && (typeof validate !== "function" || validate(migrated))) {
          recovery = { source: backup, quarantined: quarantine(file) };
          writeJson(file, migrated, { backup: false });
          onIssue?.({ code: issue.code, message: issue.message, recovery });
          return migrated;
        }
      } catch {}
    }
    try { recovery = { quarantined: quarantine(file) }; } catch {}
    onIssue?.({ code: issue.code, message: issue.message, recovery });
    issue.recovery = recovery;
    return base;
  }
}

function writeJson(file, value, { backup = true } = {}) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  cleanTemporaryFiles(file);
  const temporary = `${file}.${process.pid}-${Date.now()}.tmp`;
  const payload = JSON.stringify(value, null, 2);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, "w", 0o600);
    fs.writeFileSync(descriptor, payload, { encoding: "utf8" });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    if (backup && fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.renameSync(temporary, file);
    try {
      const directoryDescriptor = fs.openSync(path.dirname(file), "r");
      fs.fsyncSync(directoryDescriptor);
      fs.closeSync(directoryDescriptor);
    } catch {}
  } catch (error) {
    if (descriptor != null) try { fs.closeSync(descriptor); } catch {}
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch {}
    throw new StorageError("Não foi possível salvar os dados com segurança.", { code: error?.code || "WRITE_FAILED", file, cause: error });
  }
}

async function cleanTemporaryFilesAsync(file) {
  const directory = path.dirname(file);
  let names;
  try { names = await fs.promises.readdir(directory); } catch (error) { if (error?.code === "ENOENT") return []; throw error; }
  const prefix = `${path.basename(file)}.`;
  const removed = [];
  await Promise.all(names.map(async (name) => {
    if (!name.startsWith(prefix) || !name.endsWith(".tmp")) return;
    const candidate = path.join(directory, name);
    try { await fs.promises.unlink(candidate); removed.push(candidate); } catch {}
  }));
  return removed;
}

/**
 * Async counterpart of writeJson(). It keeps the same temp + fsync + backup +
 * atomic rename protocol while moving filesystem waits off the event loop.
 * JSON serialization is intentionally completed by the caller before a queued
 * write so later mutations cannot leak into an older revision.
 */
async function writeJsonPayload(file, payload, { backup = true } = {}) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  await cleanTemporaryFilesAsync(file);
  const temporary = `${file}.${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.tmp`;
  let handle;
  try {
    handle = await fs.promises.open(temporary, "w", 0o600);
    await handle.writeFile(payload, { encoding: "utf8" });
    await handle.sync();
    await handle.close();
    handle = null;
    if (backup) {
      try { await fs.promises.copyFile(file, `${file}.bak`); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    }
    await fs.promises.rename(temporary, file);
    let directoryHandle;
    try { directoryHandle = await fs.promises.open(path.dirname(file), "r"); await directoryHandle.sync(); }
    catch {}
    finally { if (directoryHandle) try { await directoryHandle.close(); } catch {} }
  } catch (error) {
    if (handle) try { await handle.close(); } catch {}
    try { await fs.promises.unlink(temporary); } catch {}
    throw new StorageError("Não foi possível salvar os dados com segurança.", { code: error?.code || "WRITE_FAILED", file, cause: error });
  }
}

async function writeJsonAsync(file, value, options = {}) {
  const payload = JSON.stringify(value, null, 2);
  return writeJsonPayload(file, payload, options);
}

class JsonStore {
  constructor(directory, name, fallback, options = {}) {
    this.file = path.join(directory, name);
    this.fallback = fallback;
    this.options = options;
    this.issues = [];
    this.pendingWrites = 0;
    this.lastWriteError = null;
    this.writeQueue = Promise.resolve();
    this.value = readJson(this.file, fallback, { ...options, onIssue: (issue) => { this.issues.push(issue); options.onIssue?.(issue); } });
  }
  save() { writeJson(this.file, this.value, this.options); }
  saveQueued() {
    // Capture an immutable payload now. This guarantees FIFO revisions even if
    // the public value object is mutated again before the I/O job starts.
    const payload = JSON.stringify(this.value, null, 2);
    this.pendingWrites += 1;
    const operation = this.writeQueue.then(() => writeJsonPayload(this.file, payload, this.options)).then(() => { this.lastWriteError = null; });
    this.writeQueue = operation.catch((error) => {
      this.lastWriteError = error;
      const issue = { code: error?.code || "ASYNC_WRITE_FAILED", message: error?.message || "Falha ao salvar dados em segundo plano.", recovery: null };
      this.issues.push(issue);
      this.options.onIssue?.(issue);
    }).finally(() => { this.pendingWrites = Math.max(0, this.pendingWrites - 1); });
    // The public queue absorbs the rejection and exposes it through flush() and
    // diagnostics, avoiding an unhandled rejection when a background caller
    // intentionally does not await each individual disk write.
    return this.writeQueue;
  }
  async flush() { await this.writeQueue; if (this.lastWriteError) throw this.lastWriteError; }
  reset() { this.value = cloneFallback(this.fallback); this.save(); return this.value; }
  diagnostics() { return { file: this.file, issues: this.issues.slice(), pendingWrites: this.pendingWrites, lastWriteError: this.lastWriteError ? { code: this.lastWriteError.code || "WRITE_FAILED", message: this.lastWriteError.message } : null }; }
}

module.exports = { readJson, writeJson, writeJsonAsync, writeJsonPayload, JsonStore, StorageError, cleanTemporaryFiles, cleanTemporaryFilesAsync };
