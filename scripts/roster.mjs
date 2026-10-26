/**
 * PC roster and session history. Pure helpers for Foundry V11 and node tests.
 * Heroes are stored separately from damage so a zero-damage PC still exists.
 */
import {filteredDamage, number, TYPE_NAMES} from "./core.mjs";

export function heroKey(actorId="", actorName="") {
  const id=String(actorId??"").trim();
  if(id)return "id:"+id;
  const name=String(actorName??"").trim().toLocaleLowerCase();
  return name?"name:"+name:"";
}
export function addHero(roster=[],actorId="",actorName="") {
  const id=String(actorId??"").trim(), name=String(actorName??"").trim().slice(0,100);
  if(!name)return roster;
  const key=heroKey(id,name);
  if((roster??[]).some(h=>heroKey(h.actorId,h.actorName)===key))return roster;
  return [...roster,{actorId:id,actorName:name}];
}
export function heroRoster(roster=[],records=[]) {
  const heroes=new Map();
  for(const entry of [...(roster??[]),...(records??[])]) {
    const actorId=String(entry?.actorId??"").trim();
    const actorName=String(entry?.actorName??"").trim();
    if(!actorName)continue;
    const key=heroKey(actorId,actorName);
    // If an actor with a matching name is linked, prefer the actor ID for
    // old manual name-only records and preserve the original roster order.
    const named=heroKey("",actorName);
    if(actorId&&heroes.has(named)){
      const old=heroes.get(named);
      heroes.delete(named);
      heroes.set(key,{...old,actorId,actorName,key});
    } else if(!heroes.has(key)) {
      if(!actorId&&[...heroes.values()].some(h=>h.actorName.toLowerCase()===actorName.toLowerCase()))continue;
      heroes.set(key,{key,actorId,actorName});
    }
  }
  return [...heroes.values()].sort((a,b)=>a.actorName.localeCompare(b.actorName));
}
export function recordsForHero(records=[],hero) {
  if(!hero)return [...records];
  const id=String(hero.actorId??"");
  const name=String(hero.actorName??"").trim().toLocaleLowerCase();
  return (records??[]).filter(r=>
    (id&&String(r.actorId??"")===id)||
    (!r.actorId&&String(r.actorName??"").trim().toLocaleLowerCase()===name)||
    (!id&&String(r.actorName??"").trim().toLocaleLowerCase()===name));
}
export function sessionHistory(records=[],hero=null) {
  const entries=recordsForHero(records,hero);
  const map=new Map();
  for(const r of entries) {
    const session=String(r.session??"").trim()||"Unassigned session";
    let group=map.get(session);
    if(!group){
      group={session,total:0,count:0,types:{},lastDate:0};
      map.set(session,group);
    }
    group.total=number(group.total+filteredDamage(r));
    group.count++;
    const stamp=Number(r.date)||0;
    group.lastDate=Math.max(group.lastDate,stamp);
    for(const [type,amount] of Object.entries(r.types??{untyped:r.damage})) {
      if(!number(amount))continue;
      group.types[type]=number((group.types[type]??0)+number(amount));
    }
  }
  return [...map.values()].sort((a,b)=>b.lastDate-a.lastDate||a.session.localeCompare(b.session))
    .map(group=>({...group,typeDetails:Object.entries(group.types).map(([type,amount])=>
      (TYPE_NAMES[type]??type)+": "+amount).join(" · ")}));
}
