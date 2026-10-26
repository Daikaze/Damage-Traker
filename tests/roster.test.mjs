import test from "node:test";
import assert from "node:assert/strict";
import {heroKey,addHero,heroRoster,recordsForHero,sessionHistory} from "../scripts/roster.mjs";

test("a PC with no damage is retained in the roster and selectable",()=>{
  let players=addHero([],"actor-1","Rashira");
  assert.equal(players.length,1);
  assert.deepEqual(heroRoster(players,[]),[
    {key:"id:actor-1",actorId:"actor-1",actorName:"Rashira"}]);
  assert.strictEqual(addHero(players,"actor-1","Rashira"),players);
  assert.equal(recordsForHero([],heroRoster(players,[])[0]).length,0);
});
test("manual PCs without Actors are persisted and deduplicated",()=>{
  const one=addHero([],"","Aurelis");
  const twice=addHero(one,"","Aurelis");
  assert.equal(twice.length,1);
  assert.equal(heroKey("","  AuReLiS  "),"name:aurelis");
  assert.equal(heroRoster(one,[])[0].actorName,"Aurelis");
});
test("historical damage records populate selection even if PC was never registered",()=>{
  const legacy=[{actorId:"X",actorName:"Sunless",damage:4,types:{cold:4}}];
  const roster=heroRoster([],legacy);
  assert.equal(roster.length,1);
  assert.equal(roster[0].key,"id:X");
  assert.equal(recordsForHero(legacy,roster[0]).length,1);
});
test("registered manual PC links to a matching actor without losing old name-only records",()=>{
  const old=[{actorId:"",actorName:"Rashira",damage:12,types:{slashing:12}}];
  const recent=[{actorId:"A",actorName:"Rashira",damage:14,types:{fire:14}}];
  const players=heroRoster([{actorId:"",actorName:"Rashira"}], [...old,...recent]);
  assert.equal(players.length,1);
  assert.equal(players[0].key,"id:A");
  assert.equal(recordsForHero([...old,...recent],players[0]).length,2);
});
test("session history groups the same session and damage types accurately",()=>{
  const records=[
    {actorId:"X",actorName:"Sunless",damage:25,types:{fire:15,slashing:10},session:"Session 3",date:100},
    {actorId:"X",actorName:"Sunless",damage:10,types:{fire:10},session:"Session 3",date:200},
    {actorId:"X",actorName:"Sunless",damage:8,types:{cold:8},session:"Session 2",date:50},
    {actorId:"Y",actorName:"Other",damage:99,types:{cold:99},session:"Session 3",date:300},
    {actorId:"X",actorName:"Sunless",damage:3,types:{untyped:3},date:400}
  ];
  const groups=sessionHistory(records,{actorId:"X",actorName:"Sunless"});
  assert.deepEqual(groups.map(g=>[g.session,g.total,g.count]),[
    ["Unassigned session",3,1],["Session 3",35,2],["Session 2",8,1]]);
  assert.deepEqual(groups[1].types,{fire:25,slashing:10});
  assert.match(groups[1].typeDetails,/Fire: 25/);
});
test("one PC's history never leaks another PC's records",()=>{
  const records=[
    {actorId:"A",actorName:"Alex",damage:5,types:{fire:5},session:"Session 1"},
    {actorId:"B",actorName:"Alex",damage:50,types:{fire:50},session:"Session 1"}
  ];
  assert.equal(recordsForHero(records,{actorId:"A",actorName:"Alex"}).length,1);
});
