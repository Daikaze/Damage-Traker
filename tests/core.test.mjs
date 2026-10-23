import test from "node:test";
import assert from "node:assert/strict";
import {DAMAGE_TYPES, extractDamage, leaderboard, filteredDamage} from "../scripts/core.mjs";
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
  assert.deepEqual(leaderboard(rows,"hit").map(r=>[r.actorName,r.amount]),[["Sunless",80],["Rashira",75]]);
  assert.deepEqual(leaderboard(rows,"total").map(r=>[r.actorName,r.amount]),[["Rashira",153],["Sunless",110]]);
  assert.deepEqual(leaderboard(rows,"round").map(r=>[r.actorName,r.amount]),[["Sunless",110],["Rashira",75]]);
  assert.deepEqual(leaderboard(rows,"total","slashing").map(r=>[r.actorName,r.amount]),[["Rashira",30]]);
  assert.equal(filteredDamage(rows[0],"fire"),10);
});
