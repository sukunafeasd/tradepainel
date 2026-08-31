"use strict";

const fs = require("fs");
const path = require("path");
const { safeStorage } = require("electron");
const { readJson, writeJson } = require("../engine/storage.cjs");

function normalizeApiKey(value) {
  return String(value || "").trim().replace(/^['"]|['"]$/g, "");
}

function classifyGeminiKey(key) {
  if (/^AQ\.[A-Za-z0-9_-]{20,}$/.test(key)) return "auth";
  if (/^AIza[A-Za-z0-9_-]{20,}$/.test(key)) return "standard";
  if (/^[A-Za-z0-9._-]{20,}$/.test(key)) return "legacy";
  return null;
}

class CredentialStore {
  constructor(dataDirectory) {
    this.file = path.join(dataDirectory, "secure-settings.json");
  }

  status() {
    const settings = readJson(this.file, {});
    const provider = settings.provider || (settings.openaiKey ? "openai" : "gemini");
    return {
      configured: Boolean(settings.aiKey || settings.openaiKey),
      provider,
      model: settings.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5"),
      keyType: settings.keyType || null,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  }

  load() {
    const settings = readJson(this.file, {});
    const provider = settings.provider || (settings.openaiKey ? "openai" : "gemini");
    let apiKey = "";
    const encryptedKey = settings.aiKey || settings.openaiKey;
    if (encryptedKey) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error("A proteção segura do Windows não está disponível.");
      apiKey = safeStorage.decryptString(Buffer.from(encryptedKey, "base64"));
    }
    return { apiKey, provider, model: settings.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5") };
  }

  save({ apiKey, provider = "gemini", model }) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error("Não vou guardar a chave sem a proteção segura do Windows.");
    const key = normalizeApiKey(apiKey);
    const cleanProvider = provider === "openai" ? "openai" : "gemini";
    if (cleanProvider === "openai" && !/^sk-[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error("Essa não parece ser uma chave da OpenAI.");
    const geminiKeyType = cleanProvider === "gemini" ? classifyGeminiKey(key) : null;
    if (cleanProvider === "gemini" && !geminiKeyType) throw new Error("Essa não parece ser uma chave válida da API Gemini. Chaves Auth atuais começam com AQ. e também são aceitas.");
    const fallbackModel = cleanProvider === "gemini" ? "gemini-2.5-flash" : "gpt-5";
    const cleanModel = /^[A-Za-z0-9._-]{2,80}$/.test(model || "") ? model : fallbackModel;
    const encrypted = safeStorage.encryptString(key).toString("base64");
    writeJson(this.file, { aiKey: encrypted, provider: cleanProvider, model: cleanModel, keyType: geminiKeyType || "secret", updatedAt: Date.now() });
    return this.status();
  }

  remove() {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    return this.status();
  }
}

module.exports = { CredentialStore, classifyGeminiKey, normalizeApiKey };
