"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const skip = new Set([".git", "node_modules", "dist", "release"]);
const files = [];
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(skip.has(item.name))continue;const file=path.join(dir,item.name);if(item.isDirectory())walk(file);else files.push(file);}}
walk(root);
const textFiles=files.filter(f=>/\.(?:cjs|js|json|md|html|css|yml|yaml)$/i.test(f));
const secret=/sk-(?:proj-)?[A-Za-z0-9_-]{32,}/g;
for(const file of textFiles){const value=fs.readFileSync(file,"utf8");if(secret.test(value))throw new Error(`Possível chave secreta em ${path.relative(root,file)}`);secret.lastIndex=0;}
for(const file of files.filter(f=>/\.(?:cjs|js)$/i.test(f))){const out=spawnSync(process.execPath,["--check",file],{encoding:"utf8"});if(out.status!==0)throw new Error(out.stderr||`Sintaxe inválida: ${file}`);}
console.log(`DiefTrade check: ${textFiles.length} arquivos verificados, nenhum segredo detectado.`);

