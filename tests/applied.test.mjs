import test from "node:test";
import assert from "node:assert/strict";
import {installAppliedCapture} from "../scripts/applied.mjs";

function rig({combat=false,withMessage=true}={}) {
  const hooks=new Map();
  globalThis.Hooks={
    on(name,fn){const l=hooks.get(name)??[];l.push(fn);hooks.set(name,l);}
  };
  const callbacks=(name,...args)=>{
    for(const fn of hooks.get(name)??[])fn(...args);
  };
  const attacker={
    id:"hero-a",name:"Rashira",type:"character",
    system:{attributes:{hp:{value:100,temp:0}}}
  };
  const target={
    id:"enemy-b",uuid:"Actor.enemy-b",name:"Enemy",type:"npc",
    system:{attributes:{hp:{value:100,temp:5}}}
  };
  const message=withMessage?{
    id:"msg-1",timestamp:Date.now(),userId:"player-1",
    rolls:[{constructor:{name:"DamageRoll"},total:25,formula:"3d8",
      options:{type:"fire",rollType:"damage"}}]
  }:null;
  globalThis.game={
    user:{id:"gm",isGM:true},
    messages:{contents:message?[message]:[],get:id=>id===message?.id?message:null},
    actors:{get:id=>id===attacker.id?attacker:id===target.id?target:null},
    i18n:{localize:k=>k},
    combat:combat?{
      started:true,round:3,combatant:{actor:attacker}
    }:null
  };
  globalThis.canvas={tokens:{controlled:[]}};
  const recorded=[];
  installAppliedCapture({
    actorForMessage:m=>m?.id===message?.id?attacker:null,
    validActor:a=>a?.type==="character",
    messageDamageType:()=>"damage",
    filterTypes:types=>types,
    totalOf:types=>Object.values(types).reduce((a,b)=>a+b,0),
    cleanNote:()=>"Scythe",combatDetails:()=>
      combat?{combatId:"combat-1",round:3}:{combatId:"",round:null},
    isTracking:()=>true,mode:()=>"applied",
    isPrimaryGM:()=>true,send:rows=>recorded.push(...rows)
  });
  const reduce=(hp,temp=target.system.attributes.hp.temp,user="player-1")=>{
    const delta={system:{attributes:{hp:{value:hp,temp}}}};
    callbacks("preUpdateActor",target,delta,{},user);
    target.system.attributes.hp.value=hp;
    target.system.attributes.hp.temp=temp;
    callbacks("updateActor",target,delta,{},user);
  };
  return {callbacks,recorded,attacker,target,message,reduce};
}

test("primary GM records another player's applied HP change",()=>{
  const r=rig();
  r.reduce(82,0);
  assert.equal(r.recorded.length,1);
  assert.equal(r.recorded[0].damage,23);
  assert.equal(r.recorded[0].actorId,"hero-a");
  assert.equal(r.recorded[0].types.fire,23);
  assert.equal(r.recorded[0].source,"applied");
});
test("same HP application reported through multiple hooks is recorded once",()=>{
  const r=rig({combat:true});
  r.callbacks("dnd5e.preApplyDamage",r.target,17,{},null);
  r.reduce(85,0,"player-1");
  r.callbacks("dnd5e.applyDamage",r.target,20,null);
  r.callbacks("dnd5e.damageActor",r.target,{total:-20},{}, "player-1");
  assert.equal(r.recorded.length,1);
  assert.equal(r.recorded[0].damage,20);
  assert.equal(r.recorded[0].combatId,"combat-1");
  assert.equal(r.recorded[0].round,3);
});
test("initiative turn attributes verified system damage without chat message",()=>{
  const r=rig({combat:true,withMessage:false});
  r.callbacks("dnd5e.preApplyDamage",r.target,20,{},{});
  r.reduce(80,0,"gm");
  r.callbacks("dnd5e.applyDamage",r.target,20,{});
  assert.equal(r.recorded.length,1);
  assert.equal(r.recorded[0].actorId,"hero-a");
  assert.deepEqual(r.recorded[0].types,{untyped:25});
});
test("unattributed manual HP changes outside combat do not invent hits",()=>{
  const r=rig({combat:false,withMessage:false});
  r.reduce(70,0,"gm");
  assert.equal(r.recorded.length,0);
});
test("roll message alone produces no records",()=>{
  const r=rig();
  r.callbacks("renderChatMessage",r.message,{
    0:{addEventListener(){},_damageTrakerObserved:false}
  });
  assert.equal(r.recorded.length,0);
});
test("healing and unchanged HP do not create records",()=>{
  const r=rig();
  r.reduce(100,5);
  r.reduce(110,5);
  assert.equal(r.recorded.length,0);
});
