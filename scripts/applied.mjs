/**
 * Capture damage only after it is applied to HP/temporary HP.
 * Supports V11 chat context actions, chat-card Apply buttons and
 * dnd5e.applyDamage system events; mere dice rolls never count.
 */
import {extractDamage,number} from "./core.mjs";

export function readHP(actor) {
  const hp=actor?.system?.attributes?.hp;
  if (!hp) return null;
  const value=Number(hp.value),temp=Number(hp.temp??0);
  return Number.isFinite(value)&&Number.isFinite(temp)?{hp:value,temp}:null;
}
export function hpLoss(before,after) {
  if (!before||!after) return 0;
  return number(Math.max(0,before.hp-after.hp)+Math.max(0,before.temp-after.temp));
}
export function appliedTypes(types,actual,multiplier=1) {
  const damage=number(actual);
  if (!damage) return {};
  const entries=Object.entries(types??{}).filter(([,v])=>number(v)>0);
  if(entries.length===1) return {[entries[0][0]]:damage};
  const total=number(entries.reduce((n,[,v])=>n+number(v),0));
  if(Number(multiplier)===1&&Math.abs(total-damage)<0.001)return Object.fromEntries(entries);
  return {untyped:damage};
}
export const stateSignature=(actor,after)=>
  actor&&after?String(actor.uuid??actor.id??"")+":"+after.hp+":"+after.temp:"";
function messageIdOf(li) {
  return li?.data?.("messageId")??
    li?.closest?.("[data-message-id]")?.data?.("messageId")??
    li?.[0]?.dataset?.messageId??null;
}
function isApplyAction(value) {
  const s=String(value??"").toLowerCase().replace(/[\s_-]+/g,"");
  return s.includes("applydamage")||s.includes("damageapply")||
    s.includes("applyhalfdamage")||s.includes("applydoubledamage")||
    s.includes("halfdamage")||s.includes("doubledamage");
}
function changesHP(changed) {
  const hp=changed?.system?.attributes?.hp;
  return hp&&(Object.prototype.hasOwnProperty.call(hp,"value")||
    Object.prototype.hasOwnProperty.call(hp,"temp"));
}
export function installAppliedCapture({actorForMessage,validActor,messageDamageType,
  filterTypes,totalOf,cleanNote,combatDetails,isTracking,mode,send}) {
  const enabled=()=>isTracking()&&["applied","rolls"].includes(mode());
  const preUpdates=new WeakMap();
  const observed=new Map();
  let intent=null;
  const recent=()=>intent&&Date.now()-intent.at<45000?intent:null;
  function messageIntent(message) {
    const source=message&&actorForMessage(message);
    if(!validActor(source))return null;
    const roll=extractDamage(message.rolls??(message.roll?[message.roll]:[]),
      messageDamageType(message));
    return roll?{source,roll,message,at:Date.now()}:null;
  }
  function setIntent(message) {
    const next=messageIntent(message);
    if(next)intent=next;
    return next;
  }
  function actorRef(value) {
    if(!value)return null;
    if(typeof value==="string")return game.actors.get(value);
    if(value?.actor?.id)return value.actor;
    return value?.id&&value?.type?value:null;
  }
  function attribution(options) {
    const message=options?.message?.rolls?options.message:
      game.messages.get(options?.messageId??options?.chatMessageId??"");
    const source=actorRef(options?.sourceActor)??actorRef(options?.attacker)??
      actorRef(options?.source)??actorRef(options?.sourceActorId);
    if(validActor(source)){
      const roll=message&&messageIntent(message);
      return {source,roll:roll?.roll??null,message,at:Date.now()};
    }
    if(message){
      const found=messageIntent(message);
      if(found)return found;
    }
    if(recent())return recent();
    // Without source metadata/chat attribution, a running combat can identify
    // the PC whose initiative turn is active. Never guess outside combat.
    const combat=game.combat;
    const current=combat?.started&&combat?.round>=1?combat.combatant?.actor:null;
    return validActor(current)?{source:current,roll:null,message:null,at:Date.now()}:null;
  }
  function record(target,actual,info,after) {
    if(!enabled()||!info||!validActor(info.source)||!actual)return false;
    const signature=stateSignature(target,after);
    if(!signature)return false;
    const prior=observed.get(signature);
    if(prior&&Date.now()-prior<5000)return false;
    let types=info.roll?appliedTypes(info.roll.types,actual):{untyped:actual};
    types=filterTypes(types);
    const damage=totalOf(types);
    if(!damage)return false;
    observed.set(signature,Date.now());
    if(observed.size>250) for(const [key,time] of observed)
      if(Date.now()-time>5000)observed.delete(key);
    const key="applied:"+(info.message?.id??"system")+":"+
      foundry.utils.randomID()+":"+(target.uuid??target.id);
    send([{
      id:key,sourceKey:key,source:"applied",
      actorId:info.source.id,actorName:info.source.name,
      damage,types,formula:info.roll?.formula??"",
      critical:info.roll?.critical??false,
      note:(info.message?cleanNote(info.message,info.source):"Applied damage")+
        " → "+(target.token?.name??target.name??"Target"),
      date:Date.now(),...combatDetails(info.source),manualOverride:false
    }]);
    return true;
  }
  // Pair pre/post updates to measure the *actual* lost HP and temporary HP.
  Hooks.on("preUpdateActor",(actor,delta,_options,userId)=>{
    if(!enabled()||userId!==game.user.id||!changesHP(delta))return;
    preUpdates.set(actor,{before:readHP(actor),at:Date.now()});
  });
  Hooks.on("updateActor",(actor,delta,_options,userId)=>{
    if(!enabled()||userId!==game.user.id||!changesHP(delta))return;
    const snap=preUpdates.get(actor);
    if(!snap||Date.now()-snap.at>5000)return;
    const after=readHP(actor),actual=hpLoss(snap.before,after);
    if(actual&&recent())record(actor,actual,recent(),after);
  });
  // Native D&D5e after-application hook; can catch system API applications
  // and damage buttons independent of Foundry chat context-menu plumbing.
  Hooks.on("dnd5e.applyDamage",(actor,amount,options)=>{
    if(!enabled()||!actor)return;
    const after=readHP(actor);
    if(!after)return;
    const snap=preUpdates.get(actor);
    const measured=snap&&Date.now()-snap.at<5000?hpLoss(snap.before,after):0;
    const actual=measured||number(amount);
    if(actual)record(actor,actual,attribution(options),after);
  });
  // Capture intent before a chat-card click handler may stop propagation.
  // No record is created until HP actually decreases.
  Hooks.on("renderChatMessage",(message,html)=>{
    const element=html?.[0]??html;
    if(!element?.addEventListener||element._damageTrakerObserved)return;
    element._damageTrakerObserved=true;
    element.addEventListener("click",event=>{
      if(!enabled())return;
      const button=event.target?.closest?.("button,[data-action]");
      if(!button||!element.contains(button))return;
      const action=button.dataset?.action??"";
      const label=button.getAttribute("title")??
        button.getAttribute("aria-label")??button.textContent??"";
      if(isApplyAction(action)||isApplyAction(label)||
        /(?:apply|deal)\s+(?:half\s+|double\s+)?damage/i.test(label))setIntent(message);
    },true);
  });
  // Older V11 builds use a chat context menu. Keep the old verified HP
  // snapshot fallback for them, while deduplicating with the hooks above.
  Hooks.on("getChatLogEntryContext",(_html,options)=>{
    if(!Array.isArray(options))return;
    const names=new Map([
      [game.i18n.localize("DND5E.ChatContextDamage"),1],
      [game.i18n.localize("DND5E.ChatContextHalfDamage"),0.5],
      [game.i18n.localize("DND5E.ChatContextDoubleDamage"),2]
    ]);
    for(const action of options){
      if(typeof action.callback!=="function"||action._damageTrakerWrapped)continue;
      const name=String(action.name??"");
      const mult=names.get(name)??(isApplyAction(name)?1:null);
      if(mult===null)continue;
      const original=action.callback;
      action._damageTrakerWrapped=true;
      action.callback=async li=>{
        if(!enabled())return original(li);
        const message=game.messages.get(messageIdOf(li));
        const info=setIntent(message);
        if(!info)return original(li);
        const targets=[...(canvas.tokens?.controlled??[])]
          .map(t=>({actor:t.actor,before:readHP(t.actor)}))
          .filter(t=>t.actor&&t.before);
        const result=await original(li);
        for(const {actor,before} of targets) {
          const after=readHP(actor),actual=hpLoss(before,after);
          if(!actual)continue;
          const roll=info.roll?{...info.roll,types:appliedTypes(
            info.roll.types,info.roll.damage*mult,mult)}:null;
          record(actor,actual,{...info,roll},after);
        }
        return result;
      };
    }
  });
}
