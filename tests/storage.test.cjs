"use strict";
const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");const os=require("node:os");const path=require("node:path");
const {JsonStore,readJson,writeJson}=require("../src/engine/storage.cjs");
const temp=()=>fs.mkdtempSync(path.join(os.tmpdir(),"dieftrade-storage-"));

test("JSON null ou corrompido não vira função e é diagnosticado",()=>{const dir=temp(),file=path.join(dir,"state.json");try{fs.writeFileSync(file,"null");const issues=[];const value=readJson(file,()=>({ok:true}),{validate:v=>v?.ok===true,onIssue:i=>issues.push(i)});assert.deepEqual(value,{ok:true});assert.equal(issues[0].code,"NULL_JSON");assert.ok(fs.readdirSync(dir).some(name=>name.includes("corrupt")));}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test("backup válido recupera arquivo principal inválido",()=>{const dir=temp(),file=path.join(dir,"state.json");try{fs.writeFileSync(file,"{");fs.writeFileSync(`${file}.bak`,JSON.stringify({version:2}));const store=new JsonStore(dir,"state.json",()=>({version:2}),{validate:v=>v?.version===2});assert.equal(store.value.version,2);assert.ok(store.diagnostics().issues.length);assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).version,2);}finally{fs.rmSync(dir,{recursive:true,force:true});}});

test("gravação atômica remove temporários órfãos e mantém backup",()=>{const dir=temp(),file=path.join(dir,"state.json");try{writeJson(file,{n:1});fs.writeFileSync(`${file}.old.tmp`,"resto");writeJson(file,{n:2});assert.equal(JSON.parse(fs.readFileSync(file,"utf8")).n,2);assert.equal(JSON.parse(fs.readFileSync(`${file}.bak`,"utf8")).n,1);assert.equal(fs.existsSync(`${file}.old.tmp`),false);}finally{fs.rmSync(dir,{recursive:true,force:true});}});
