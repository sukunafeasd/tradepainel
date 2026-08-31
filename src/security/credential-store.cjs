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
  constructor(dataDirectory, secureStorage = safeStorage, { now = () => Date.now() } = {}) {
    this.file = path.join(dataDirectory, "secure-settings.json");
    this.secureStorage = secureStorage;
    this.now = now;
  }

  status() {
    const settings = readJson(this.file, {});
    const provider = settings.provider || (settings.openaiKey ? "openai" : "gemini");
    let decryptable = false;
    let error = null;
    const encryptedKey = settings.aiKey || settings.openaiKey;
    if (encryptedKey && this.secureStorage.isEncryptionAvailable()) {
      try { decryptable = Boolean(this.secureStorage.decryptString(Buffer.from(encryptedKey, "base64"))); }
      catch { error = "A credencial protegida está corrompida ou pertence a outro perfil do Windows."; }
    }
    return {
      configured: Boolean(encryptedKey) && decryptable,
      stored: Boolean(encryptedKey),
      operational: Boolean(encryptedKey) && decryptable,
      provider,
      model: settings.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5"),
      keyType: settings.keyType || null,
      encryptionAvailable: this.secureStorage.isEncryptionAvailable(),
      error,
    };
  }

  load() {
    const settings = readJson(this.file, {});
    const provider = settings.provider || (settings.openaiKey ? "openai" : "gemini");
    let apiKey = "";
    const encryptedKey = settings.aiKey || settings.openaiKey;
    if (encryptedKey) {
      if (!this.secureStorage.isEncryptionAvailable()) throw new Error("A proteção segura do Windows não está disponível.");
      try { apiKey = this.secureStorage.decryptString(Buffer.from(encryptedKey, "base64")); }
      catch (error) { throw new Error("A chave protegida não pôde ser descriptografada. Remova-a e salve uma nova.", { cause: error }); }
    }
    return { apiKey, provider, model: settings.model || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-5") };
  }

  save({ apiKey, provider = "gemini", model }) {
    if (!this.secureStorage.isEncryptionAvailable()) throw new Error("Não vou guardar a chave sem a proteção segura do Windows.");
    const key = normalizeApiKey(apiKey);
    const cleanProvider = provider === "openai" ? "openai" : "gemini";
    if (cleanProvider === "openai" && !/^sk-[A-Za-z0-9_\-]{20,}$/.test(key)) throw new Error("Essa não parece ser uma chave da OpenAI.");
    const geminiKeyType = cleanProvider === "gemini" ? classifyGeminiKey(key) : null;
    if (cleanProvider === "gemini" && !geminiKeyType) throw new Error("Essa não parece ser uma chave válida da API Gemini. Chaves Auth atuais começam com AQ. e também são aceitas.");
    const fallbackModel = cleanProvider === "gemini" ? "gemini-2.5-flash" : "gpt-5";
    const cleanModel = String(model || fallbackModel).trim();
    if (!/^[A-Za-z0-9._-]{2,80}$/.test(cleanModel)) throw new Error("Nome de modelo inválido.");
    if (cleanProvider === "gemini" && !/^gemini-/i.test(cleanModel)) throw new Error("Escolha um modelo Gemini para a chave Gemini.");
    if (cleanProvider === "openai" && !/^(gpt-|o\d|chatgpt-)/i.test(cleanModel)) throw new Error("Escolha um modelo OpenAI para a chave OpenAI.");
    const encrypted = this.secureStorage.encryptString(key).toString("base64");
    writeJson(this.file, { aiKey: encrypted, provider: cleanProvider, model: cleanModel, keyType: geminiKeyType || "secret", updatedAt: this.now() });
    return this.status();
  }

  remove() {
    if (fs.existsSync(this.file)) fs.unlinkSync(this.file);
    return this.status();
  }
}

module.exports = { CredentialStore, classifyGeminiKey, normalizeApiKey };
