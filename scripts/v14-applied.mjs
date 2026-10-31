/**
 * Damage Hall of Fame — Foundry V14 / dnd5e 6.0.6.
 * Capture only post-applied damage. No roll-complete or HP-guess triggers.
 * This tracker intentionally uses the GM's local hooks (not a trustless
 * player socket) to protect records against forged applied-damage payloads.
 */
import {DAMAGE_TYPES, UNKNOWN, number} from "./core.mjs";

const MOD="damage-traker";
const WINDOW=8000;
const seen=new Map();
let pending=Promise.resolve();
const active=()=>game.settings.get(MOD,"trackingEnabled")!==false;
const enabledTypes=()=>game.settings.get(MOD,"enabledTypes")??[...DAMAGE_TYPES,UNKNOWN];
const firstGM=()=>[...(game.users?.contents??[])].filter(u=>u.isGM&&u.active)
  .sort((a,b)=>String(a.id).localeCompare(String(b.id)))[0];
const primaryGM=()=>game.user?.isGM&&firstGM()?.id===game.user.id;
const actorOf=value=>value?.actor??((value?.type==="character"||value?.type==="npc")?value:null)
  ??((value?.parent?.type==="character"||value?.parent?.type==="npc")?value.parent:null);
const fromMessage=id=>{
  const msg=id?game.messages?.get(String(id)):null;
  return msg?.actor??game.actors?.get(msg?.speaker?.actor);
};
const sourceOf=(options={})=>{
  const messageId=String(options.messageId??options.chatMessage?.id??options.message?.id??"");
  const fromMsg=fromMessage(messageId);
  const item=options.activity?.item??options.item;
  const actor=fromMsg??actorOf(options.activity?.actor)??actorOf(item?.parent);
  return {actor:actorOf(actor),messageId};
};
function combatOf(actor){
  const combat=game.combat;
  if(!combat?.started||!combat.id||!Number.isInteger(combat.round)||combat.round<1) return {combatId:"",round:null};
  const inside=[...(combat.combatants?.contents??[])].some(c=>c.actorId===actor.id);
  return inside?{combatId:combat.id,round:combat.round}:{combatId:"",round:null};
}
function appliedType(options,amount){
  // Only accept an EXACT post-application split, never estimated roll types.
  const parts=options?.appliedDamageDetail??options?.damageItem?.appliedDamageDetail;
  if(!Array.isArray(parts)||!parts.length)return {[UNKNOWN]:amount};
  const sums={};
  for(const part of parts){
    const type=DAMAGE_TYPES.includes(part?.type)?part.type:UNKNOWN;
    const value=number(part?.damage);
    if(value)sums[type]=number((sums[type]??0)+value);
  }
  const sum=Object.values(sums).reduce((a,b)=>a+b,0);
  return Math.abs(sum-amount)<0.01?sums:{[UNKNOWN]:amount};
}
function duplicate(actorId,targetId,messageId,amount,source){
  const now=Date.now();
  for(const [key,data] of seen)if(now-data.at>WINDOW)seen.delete(key);
  // Without chat attribution there is no reliable way to identify independent
  // identical hits. Count them separately instead of suppressing real attacks.
  if(!messageId)return false;
  const key=[messageId,actorId,targetId,amount].join("|");
  const existing=seen.get(key);
  seen.set(key,{at:now,source});
  return Boolean(existing&&now-existing.at<WINDOW);
}
async function record(actor,target,amount,{messageId="",source="",note="",types=null}={}){
  if(!primaryGM()||!active()||game.system?.id!=="dnd5e")return;
  if(actor?.type!=="character"||actor.hasPlayerOwner===false||!actor.id)return;
  if(!target?.id||actor.id===target.id)return;
  const damage=number(amount);
  if(!damage||damage>999999)return;
  const applied=types??{[UNKNOWN]:damage};
  const accepted=Object.fromEntries(Object.entries(applied).filter(([t,v])=>enabledTypes().includes(t)&&number(v)>0));
  const acceptedDamage=number(Object.values(accepted).reduce((sum,v)=>sum+number(v),0));
  if(!acceptedDamage)return;
  const targetId=String(target.uuid??target.id);
  if(duplicate(actor.id,targetId,messageId,damage,source))return;
  const eventId=foundry.utils.randomID();
  const row={
    id:eventId,sourceKey:messageId?`v14:${messageId}:${actor.id}:${targetId}:${damage}`: "",
    source:"applied-v14",actorId:actor.id,actorName:actor.name,
    damage:acceptedDamage,types:accepted,
    note:String(note||"Applied damage").slice(0,120),
    formula:"",critical:false,date:Date.now(),
    session:String(game.settings.get(MOD,"currentSession")??"").slice(0,80),
    ...combatOf(actor),manualOverride:false
  };
  pending=pending.then(async()=>{
    if(!primaryGM()||!active())return;
    const old=game.settings.get(MOD,"records")??[];
    const rows=Array.isArray(old)?[...old]:[];
    // Protect against a delayed duplicate from another hook.
    if(row.sourceKey&&rows.some(r=>r.sourceKey===row.sourceKey))return;
    rows.push(row);
    await game.settings.set(MOD,"records",rows);
  }).catch(err=>console.error("damage-traker | Post-applied damage recording failed",err));
  return pending;
}
export function installV14DamageCapture(){
  Hooks.on("dnd5e.applyDamage",(target,amount,options={})=>{
    const {actor,messageId}=sourceOf(options);
    const targetActor=actorOf(target);
    void record(actor,targetActor,Number(amount),{
      messageId,source:"dnd5e",note:String(options.activity?.item?.name??options.item?.name??"Applied damage"),
      types:appliedType(options,number(amount))
    });
  });
  // This hook is emitted after Midi-QOL applies HP/temporary-HP damage.
  Hooks.on("midi-qol.damaged",(targetToken,details={})=>{
    const d=details.damageItem??{};
    const hp=Number(d.hpDamage),temp=Number(d.tempDamage);
    if(!Number.isFinite(hp)&&!Number.isFinite(temp))return;
    const amount=number(Math.max(0,Number.isFinite(hp)?hp:0)+Math.max(0,Number.isFinite(temp)?temp:0));
    const workflow=details.workflow??{};
    const actor=actorOf(workflow.actor??details.item?.parent);
    const target=actorOf(targetToken?.actor??targetToken?.document?.actor);
    void record(actor,target,amount,{
      messageId:String(workflow.itemCardId??workflow.chatMessage?.id??""),
      source:"midi-qol",note:String(workflow.item?.name??"Midi-QOL applied damage"),
      types:appliedType({appliedDamageDetail:d.appliedDamageDetail},amount)
    });
  });
}
