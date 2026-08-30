"use strict";

const path = require("path");
const fs = require("fs");
const { app, safeStorage } = require("electron");
const { CredentialStore } = require("../src/security/credential-store.cjs");
const { MarketClient } = require("../src/engine/market-client.cjs");
const { analyze } = require("../src/engine/analysis.cjs");
const { AiReader } = require("../src/engine/ai-reader.cjs");

app.setPath("userData", path.join(app.getPath("appData"), "DiefTrade"));
const reportFile = process.env.DIEFTRADE_AI_DIAG || path.join(app.getPath("temp"), "dieftrade-ai-diagnostic.json");
const report = (value) => fs.writeFileSync(reportFile, JSON.stringify(value, null, 2), { mode: 0o600 });

app.whenReady().then(async () => {
  const credentials = new CredentialStore(path.join(app.getPath("userData"), "dieftrade-data"), safeStorage);
  const status = credentials.status();
  if (!status.configured) throw new Error("Nenhuma chave configurada no DiefTrade.");
  const candles = await new MarketClient().klines("BTCUSDT", "15m", 500);
  const reading = analyze(candles, { symbol: "BTCUSDT", interval: "15m" });
  const result = await new AiReader(credentials).read(reading);
  report({ ok: true, model: result.model, requestId: result.requestId, received: Boolean(result.content) });
}).catch((error) => {
  report({ ok: false, error: error.message });
  process.exitCode = 1;
}).finally(() => app.quit());
