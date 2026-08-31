"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const skipDirectories = new Set([".git", "node_modules", "dist", "release", "coverage", ".codex-tmp"]);
const files = [];

function walk(directory) {
  for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
    if (item.isDirectory() && skipDirectories.has(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) walk(file);
    else files.push(file);
  }
}

function fail(message) { throw new Error(message); }
function relative(file) { return path.relative(root, file); }

walk(root);
const textFiles = files.filter((file) =>
  /\.(?:cjs|js|json|md|html|css|yml|yaml|toml|txt)$/i.test(file) || /^\.env(?:\.|$)/i.test(path.basename(file)),
);

// Os prefixos ficam fragmentados para o verificador não detectar o próprio código.
const secretSignatures = [
  ["OpenAI", ["s", "k", "-(?:proj-)?[A-Za-z0-9_-]{32,}"].join("")],
  ["Google Gemini Auth", ["A", "Q", "\\.[A-Za-z0-9_-]{24,}"].join("")],
  ["Google API", ["A", "I", "za[A-Za-z0-9_-]{28,}"].join("")],
  ["GitHub token", ["gh", "(?:p|o|u|s|r|t)_", "[A-Za-z0-9]{30,}"].join("")],
  ["GitHub fine-grained token", ["github", "_pat_", "[A-Za-z0-9_]{40,}"].join("")],
  ["AWS access key", ["AK", "IA", "[A-Z0-9]{16}"].join("")],
  ["Slack token", ["xo", "x[baprs]-", "[A-Za-z0-9-]{20,}"].join("")],
  ["Chave privada", ["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY-----"].join("")],
  ["URL com credencial", "(?:postgres(?:ql)?|mysql|mongodb(?:\\+srv)?):\\/\\/[^\\s:/]+:[^\\s@/]+@"],
].map(([label, source]) => ({ label, expression: new RegExp(source, "g") }));

for (const file of textFiles) {
  const value = fs.readFileSync(file, "utf8");
  for (const { label, expression } of secretSignatures) {
    if (expression.test(value)) fail(`Possível segredo (${label}) em ${relative(file)}`);
    expression.lastIndex = 0;
  }
}

for (const file of files.filter((candidate) => /\.(?:cjs|js)$/i.test(candidate))) {
  const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (result.status !== 0) fail(result.stderr || `Sintaxe inválida: ${relative(file)}`);
}

for (const file of files.filter((candidate) => /\.json$/i.test(candidate))) {
  try { JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`JSON inválido em ${relative(file)}: ${error.message}`); }
}

for (const file of files.filter((candidate) => /\.html$/i.test(candidate))) {
  const value = fs.readFileSync(file, "utf8");
  if (!/^\s*<!doctype html>/i.test(value)) fail(`HTML sem doctype em ${relative(file)}`);
  const ids = [...value.matchAll(/\sid=["']([^"']+)["']/gi)].map((match) => match[1]);
  const duplicate = ids.find((id, index) => ids.indexOf(id) !== index);
  if (duplicate) fail(`ID HTML duplicado "${duplicate}" em ${relative(file)}`);
}

for (const file of files.filter((candidate) => /\.css$/i.test(candidate))) {
  const value = fs.readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "");
  let depth = 0;
  for (const character of value) {
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth < 0) fail(`Chave CSS fechada sem abertura em ${relative(file)}`);
  }
  if (depth !== 0) fail(`Blocos CSS desequilibrados em ${relative(file)}`);
}

for (const file of files.filter((candidate) => /\.ya?ml$/i.test(candidate))) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  if (lines.some((line) => /^\t+/.test(line))) fail(`YAML contém indentação por tab em ${relative(file)}`);
}

console.log(`DiefTrade check: ${textFiles.length} arquivos, sintaxe/estrutura válidas e nenhum segredo conhecido detectado.`);
