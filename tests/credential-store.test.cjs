"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { CredentialStore } = require("../src/security/credential-store.cjs");

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-credential-"));
const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`),
  decryptString: (value) => {
    const text = value.toString();
    if (!text.startsWith("protected:")) throw new Error("corrompido");
    return text.slice(10);
  },
};

test("credencial é protegida, validada por provedor e nunca gravada em claro", () => {
  const dir = temporary();
  try {
    const store = new CredentialStore(dir, secureStorage, { now: () => 123 });
    const key = `AQ.${"a".repeat(30)}`;
    const status = store.save({ apiKey: key, provider: "gemini", model: "gemini-2.5-flash" });
    assert.equal(status.configured, true);
    assert.equal(store.load().apiKey, key);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, "secure-settings.json"), "utf8"), new RegExp(key.replace(".", "\\.")));
    assert.throws(() => store.save({ apiKey: key, provider: "gemini", model: "gpt-5" }), /modelo Gemini/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("credencial corrompida não é anunciada como operacional", () => {
  const dir = temporary();
  try {
    fs.writeFileSync(path.join(dir, "secure-settings.json"), JSON.stringify({ aiKey: Buffer.from("broken").toString("base64"), provider: "gemini" }));
    const store = new CredentialStore(dir, secureStorage);
    assert.equal(store.status().configured, false);
    assert.match(store.status().error, /corrompida/i);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
