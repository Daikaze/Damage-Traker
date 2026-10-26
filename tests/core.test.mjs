import test from "node:test";
import assert from "node:assert/strict";
import {DAMAGE_TYPES, extractDamage, leaderboard, filteredDamage} from "../scripts/core.mjs";
import {appliedTypes,hpLoss,stateSignature} from "../scripts/applied.mjs";
import {portraitKey,bestPortrait} from "../scripts/portraits.mjs";
const roll=(total,type,critical=false)=>({constructor:{name:"DamageRoll"},total,formula:"2d6+3",options:{type,critical}});
test("all 13 official D&D types are supported",()=>assert.equal(DAMAGE_TYPES.length,13));
test("separate typed rolls in one message sum and split",()=>{
  const r=extractDamage([roll(13,"slashing"),roll(7,"fire")]);
  assert.equal(r.damage,20);assert.deepEqual(r.types,{slashing:13,fire:7});
});
test("critical dice total is read, never evaluated twice",()=>{
  const r=extractDamage([roll(31,"necrotic",true)]);
  assert.equal(r.damage,31);assert.equal(r.critical,true);
});
test("heals, attack rolls, and zero damage are ignored",()=>{
  assert.equal(extractDamage([roll(10,"healing")]),null);
  assert.equal(extractDamage([{constructor:{name:"D20Roll"},total:18,options:{type:"attack"}}]),null);
  assert.equal(extractDamage([roll(0,"fire")]),null);
});
test("valid flavored terms are split exactly",()=>{
  const r=extractDamage([{constructor:{name:"DamageRoll"},total:15,options:{},terms:[
    {total:9,options:{flavor:"fire"}},{operator:"+"},{total:6,options:{flavor:"cold"}}
  ]}]);
  assert.deepEqual(r.types,{fire:9,cold:6});
});
test("ambiguous split is marked unknown instead of guessed",()=>{
  const r=extractDamage([{constructor:{name:"DamageRoll"},total:15,options:{},terms:[
    {total:6,options:{flavor:"fire"}},{operator:"+"},{total:3,options:{flavor:"cold"}}
  ]}]);
  assert.deepEqual(r.types,{untyped:15});
});
test("untyped DamageRoll counts",()=>assert.deepEqual(extractDamage([roll(8,"")]).types,{untyped:8}));
test("highest hit, total and best round are independent",()=>{
  const rows=[
    {actorId:"A",actorName:"Rashira",damage:40,types:{fire:10,slashing:30},combatId:"c1",round:1},
    {actorId:"A",actorName:"Rashira",damage:20,types:{fire:20},combatId:"c1",round:1},
    {actorId:"A",actorName:"Rashira",damage:75,types:{fire:75},combatId:"c1",round:2},
    {actorId:"A",actorName:"Rashira",damage:10,types:{fire:10},combatId:"c2",round:1},
    {actorId:"B",actorName:"Sunless",damage:80,types:{fire:80},combatId:"c2",round:1},
    {actorId:"B",actorName:"Sunless",damage:30,types:{fire:30},combatId:"c2",round:1},
    {actorId:"A",actorName:"Rashira",damage:8,types:{fire:8},combatId:"",round:null}
  ];
  assert.deepEqual(leaderboard(rows,"hit").map(r=>[r.actorName,r.amount]),[["Sunless",110],["Rashira",75]]);
  assert.deepEqual(leaderboard(rows,"total").map(r=>[r.actorName,r.amount]),[["Rashira",153],["Sunless",110]]);
  assert.deepEqual(leaderboard(rows,"round").map(r=>[r.actorName,r.amount]),[["Sunless",110],["Rashira",75]]);
  assert.deepEqual(leaderboard(rows,"total","slashing").map(r=>[r.actorName,r.amount]),[["Rashira",30]]);
  assert.equal(filteredDamage(rows[0],"fire"),10);
});

test("records confirmed HP/tempHP loss rather than rolled totals",()=>{
  assert.equal(hpLoss({hp:35,temp:10},{hp:35,temp:6}),4);
  assert.equal(hpLoss({hp:35,temp:10},{hp:30,temp:0}),15);
  assert.equal(hpLoss({hp:35,temp:10},{hp:35,temp:10}),0);
  assert.equal(hpLoss({hp:35,temp:0},{hp:40,temp:0}),0);
});
test("retains one exact type; mixed reductions are unknown",()=>{
  assert.deepEqual(appliedTypes({fire:24},12,0.5),{fire:12});
  assert.deepEqual(appliedTypes({fire:10,cold:5},15,1),{fire:10,cold:5});
  assert.deepEqual(appliedTypes({fire:10,cold:5},7,0.5),{untyped:7});
  assert.deepEqual(appliedTypes({slashing:10},0),{});
});

test("portraits remain stable per actor and manual hero name",()=>{
  assert.equal(portraitKey("AbC_12","Rashira"),"id:AbC_12");
  assert.equal(portraitKey(""," Rashira "),"name:rashira");
  assert.equal(portraitKey(null,""),"");
});
test("GM chosen artwork overrides existing token and actor art",()=>{
  assert.equal(bestPortrait({
    override:"avatars/rashira.webp",activeToken:"tokens/rashira.png",
    prototypeToken:"tokens/prototype.png",actorImage:"portraits/actor.png"
  }),"avatars/rashira.webp");
});
test("artwork automatically falls back to placed token, prototype and actor",()=>{
  assert.equal(bestPortrait({activeToken:"tokens/active.png",placedToken:"tokens/placed.png",
    prototypeToken:"tokens/prototype.png",actorImage:"img/actor.png"}),"tokens/active.png");
  assert.equal(bestPortrait({prototypeToken:"tokens/prototype.png",actorImage:"img/actor.png"}),"tokens/prototype.png");
  assert.equal(bestPortrait({actorImage:"img/actor.png"}),"img/actor.png");
  assert.equal(bestPortrait({actorImage:"icons/svg/mystery-man.svg"}),"");
});

test("Highest Hit compares an entire combat round against individual out-of-combat hits",()=>{
  const events=[
    {actorId:"A",actorName:"A",damage:12,types:{fire:12},combatId:"c1",round:1},
    {actorId:"A",actorName:"A",damage:18,types:{fire:18},combatId:"c1",round:1},
    {actorId:"A",actorName:"A",damage:45,types:{fire:45},combatId:"",round:null},
    {actorId:"A",actorName:"A",damage:8,types:{fire:8},combatId:"c1",round:2},
    {actorId:"B",actorName:"B",damage:10,types:{cold:10},combatId:"c1",round:1},
    {actorId:"B",actorName:"B",damage:12,types:{cold:12},combatId:"c1",round:1},
    {actorId:"B",actorName:"B",damage:17,types:{cold:17},combatId:"",round:null}
  ];
  assert.deepEqual(leaderboard(events,"hit").map(r=>[r.actorName,r.amount]),[["A",45],["B",22]]);
  assert.equal(leaderboard(events,"hit")[1].detail,"Combat round 1 • 2 applied hits");
  assert.equal(leaderboard(events,"round")[0].amount,30);
  assert.equal(leaderboard(events,"total")[0].amount,83);
  assert.equal(stateSignature({uuid:"Actor.a"},{hp:10,temp:5}),"Actor.a:10:5");
});
test("Combat rounds never mix across combats or heroes",()=>{
  const events=[
    {actorId:"A",actorName:"A",damage:30,types:{fire:30},combatId:"c1",round:2},
    {actorId:"A",actorName:"A",damage:31,types:{fire:31},combatId:"c1",round:2},
    {actorId:"A",actorName:"A",damage:35,types:{fire:35},combatId:"c2",round:2},
    {actorId:"B",actorName:"B",damage:50,types:{fire:50},combatId:"c1",round:2}
  ];
  assert.deepEqual(leaderboard(events,"hit").map(r=>r.amount),[61,50]);
  assert.equal(leaderboard(events,"hit")[0].detail,"Combat round 2 • 2 applied hits");
});
