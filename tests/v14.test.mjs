import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";

const registrations=new Map(),hooks=new Map();
let writeCount=0;
const settings=new Map([
  ["records",[]],["players",[]],["portraits",{}],["currentSession","Session 26"],
  ["enabledTypes",["untyped","fire"]],["trackingEnabled",true]
]);
const gm={id:"gm",isGM:true,active:true};
const pc={id:"pc",uuid:"Actor.pc",name:"Rashira",type:"character",hasPlayerOwner:true,img:"rashira.webp"};
const goblin={id:"goblin",uuid:"Actor.goblin",name:"Goblin",type:"npc",hasPlayerOwner:false};
const actorMap=new Map([["pc",pc],["goblin",goblin]]);
const messageMap=new Map([["hit-1",{actor:pc}],["hit-2",{actor:pc}]]);
class MockApplicationV2 {
  constructor(){this.element=null;this.rendered=false;}
  _canRender(){}
  async _prepareContext(){return {};}
  _onRender(){}
  _onClose(){}
  async render(){this.rendered=true;return this;}
  bringToFront(){}
}
globalThis.Hooks={
  on:(name,fn)=>hooks.set(name,fn),
  once:(name,fn)=>hooks.set(name,fn)
};
globalThis.foundry={
  applications:{api:{
    ApplicationV2:MockApplicationV2,
    HandlebarsApplicationMixin:Base=>Base,
    DialogV2:{confirm:async()=>true}
  }},
  utils:{randomID:()=>Math.random().toString(36).slice(2),deepClone:obj=>structuredClone(obj)}
};
globalThis.canvas={tokens:{placeables:[]}};
globalThis.Handlebars={escapeExpression:s=>String(s)};
globalThis.ui={notifications:{info(){},warn(){},error(){}}};
globalThis.game={
  system:{id:"dnd5e",version:"6.0.6"},
  user:gm,users:{contents:[gm]},
  combat:null,
  actors:{contents:[pc,goblin],get:id=>actorMap.get(id)},
  messages:{get:id=>messageMap.get(id)},
  modules:new Map([["damage-traker",{}]]),
  settings:{
    get:(_mod,key)=>settings.get(key),
    register:(_mod,key,options)=>registrations.set(key,options),
    registerMenu(){},
    async set(_mod,key,value){settings.set(key,value);writeCount++;}
  }
};
await import("../scripts/v14-main.mjs");

async function flush(){
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
}
test("native V14 version and independent branch distribution",()=>{
  const module=JSON.parse(readFileSync(new URL("../module.json",import.meta.url)));
  assert.equal(module.version,"14.1.0");
  assert.equal(module.id,"damage-traker");
  assert.equal(module.compatibility.verified,"14");
  assert.equal(module.relationships.systems[0].compatibility.verified,"6.0.6");
  assert.equal(module.manifest,"https://raw.githubusercontent.com/Daikaze/Damage-Traker/foundry-v14/module.json");
  assert.deepEqual(module.esmodules,["scripts/v14-main.mjs"]);
  assert.ok(readFileSync(new URL("../scripts/v14-main.mjs",import.meta.url),"utf8").includes("HandlebarsApplicationMixin(ApplicationV2)"));
  assert.ok(readFileSync(new URL("../styles/v14.css",import.meta.url),"utf8").includes("@container damage-hall"));
});
test("registration preserves legacy storage keys and separates V14 scene tools",()=>{
  hooks.get("init")();
  for(const key of ["records","players","portraits","currentSession","enabledTypes","trackingEnabled","captureMode"]){
    assert.ok(registrations.has(key),key);
  }
  const controls={tokens:{order:1}};
  hooks.get("getSceneControlButtons")(controls);
  assert.ok(controls.damageHallOfFame);
  assert.equal(controls.damageHallOfFame.tools.open.name,"open");
  assert.equal(controls.tokens.order,1);
});
test("only confirmed PC applied damage is stored; not a mere dice roll",async()=>{
  hooks.get("ready")();
  assert.equal(typeof hooks.get("dnd5e.applyDamage"),"function");
  assert.equal(hooks.has("createChatMessage"),false);
  const apply=hooks.get("dnd5e.applyDamage");
  apply(goblin,23,{messageId:"hit-1"});
  await flush();
  assert.equal(settings.get("records").length,1);
  const r=settings.get("records")[0];
  assert.equal(r.actorId,"pc");assert.equal(r.damage,23);
  assert.equal(r.session,"Session 26");
  assert.deepEqual(Object.keys(r.types),["untyped"]);
  // Same message/target/amount should not produce a second record.
  apply(goblin,23,{messageId:"hit-1"});
  await flush();
  assert.equal(settings.get("records").length,1);
  apply(goblin,-8,{messageId:"hit-2"});
  await flush();
  assert.equal(settings.get("records").length,1);
  apply(pc,55,{messageId:"hit-2"});
  await flush();
  assert.equal(settings.get("records").length,1);
  apply(goblin,40,{});
  await flush();
  assert.equal(settings.get("records").length,1);
});
test("second hook and combat round capture keep player history usable",async()=>{
  const damaged=hooks.get("midi-qol.damaged");
  const combat={id:"battle",round:3,started:true,combatants:{contents:[{actorId:"pc"}]}};
  game.combat=combat;
  damaged({actor:goblin},{workflow:{actor:pc,itemCardId:"hit-2"},damageItem:{hpDamage:11,tempDamage:5}});
  await flush();
  const records=settings.get("records");
  assert.equal(records.length,2);
  assert.equal(records.at(-1).damage,16);
  assert.equal(records.at(-1).round,3);
  assert.equal(records.at(-1).combatId,"battle");
  const {leaderboard}=await import("../scripts/core.mjs");
  const ranked=leaderboard(records,"hit","all");
  assert.equal(ranked[0].actorName,"Rashira");
});
test("only primary GM writes; auto setting disables new record capture",async()=>{
  const previous=writeCount;
  settings.set("trackingEnabled",false);
  hooks.get("dnd5e.applyDamage")(goblin,99,{messageId:"hit-2"});
  await flush();
  assert.equal(writeCount,previous);
  settings.set("trackingEnabled",true);
  game.user={id:"player",isGM:false};
  hooks.get("dnd5e.applyDamage")(goblin,99,{messageId:"hit-2"});
  await flush();
  assert.equal(writeCount,previous);
  game.user=gm;
});
