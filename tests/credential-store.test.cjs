"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { classifyGeminiKey, normalizeApiKey } = require("../src/security/credential-store.cjs");

test("reconhece chaves Auth atuais do Gemini com prefixo AQ.", () => {
  assert.equal(classifyGeminiKey("AQ." + "a".repeat(32)), "auth");
  assert.equal(classifyGeminiKey("AIza" + "b".repeat(32)), "standard");
  assert.equal(normalizeApiKey('  "AQ.' + "c".repeat(32) + '"  '), "AQ." + "c".repeat(32));
});

