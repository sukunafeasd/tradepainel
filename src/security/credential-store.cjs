"use strict";

const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");
const { readJson, writeJson } = require("../engine/storage.cjs");

class CredentialStore {
  constructor(dataDirectory) {
    this.file = path.join(dataDirectory, "secure-settings.json");
  }

  status() {
    const settings = readJson(this.file, {});
    return {
      configured: Boolean(settings.openaiKey),
      model: settings.model || "gpt-5",
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  load() {
    const settings = readJson(this.file, {});
    let apiKey = "";
    if (settings.openaiKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("A proteção segura do Windows não está disponível.");
      apiKey = safeStorage.decryptString(Buffer.from(settings.openaiKey, "base64"));
    }
    return { apiKey, model: settings.model || "gpt-5" };
  }

  save({ apiKey, model = "gpt-5" }) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Não vou guardar a chave sem a proteção segura do Windows.");
    const key = String(apiKey || "").trim();
    if (!/^sk-[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error("Formato de chave inválido.");
    const cleanModel = /^[A-Za-z0-9._-]{2,80}$/.test(model) ? model : "gpt-5";
    const encrypted = safeStorage.encryptString(key).toString("base64");
    writeJson(this.file, { openaiKey: encrypted, model: cleanModel, updatedAt: Date.now() });
    return this.status();
  }

  remove() {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    return this.status();
  }
}

module.exports = { CredentialStore };

