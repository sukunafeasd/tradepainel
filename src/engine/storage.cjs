"use strict";

const fs = require("fs");
const path = require("path");

function readJson(file, fallback) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed == null ? fallback : parsed;
  } catch {
    return typeof fallback === "function" ? fallback() : structuredClone(fallback);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

class JsonStore {
  constructor(directory, name, fallback) {
    this.file = path.join(directory, name);
    this.fallback = fallback;
    this.value = readJson(this.file, fallback);
  }
  save() { writeJson(this.file, this.value); }
  reset() { this.value = typeof this.fallback === "function" ? this.fallback() : structuredClone(this.fallback); this.save(); return this.value; }
}

module.exports = { readJson, writeJson, JsonStore };

