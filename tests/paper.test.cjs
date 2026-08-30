"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PaperPortfolio } = require("../src/engine/paper.cjs");

test("paper trading compra e vende sem tocar conta real", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dieftrade-paper-"));
  try {
    const p = new PaperPortfolio(dir);
    p.order({ symbol: "BTCUSDT", side: "buy", quantity: .01, price: 50000 });
    assert.equal(p.snapshot({ BTCUSDT: 51000 }).positions.length, 1);
    p.order({ symbol: "BTCUSDT", side: "sell", quantity: .01, price: 51000 });
    const snap = p.snapshot();
    assert.equal(snap.positions.length, 0);
    assert.equal(snap.trades.length, 2);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

