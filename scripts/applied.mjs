/**
 * Damage Hall of Fame — verified HP damage capture for Foundry V11 D&D5e.
 * Never create a record from a roll alone. All records come from an actual
 * damage application or a target's confirmed HP / temp HP reduction.
 */
import {extractDamage,number} from "./core.mjs";

export function readHP(actor) {
  const hp=actor?.system?.attributes?.hp;
  if(!hp)return null;
  const value=Number(hp.value),temp=Number(hp.temp??0);
  return Number.isFinite(value)&&Number.isFinite(temp)?{hp:value,temp}:null;
}
export function hpLoss(before,after) {
  if(!before||!after)return 0;
  return number(Math.max(0,before.hp-after.hp)+Math.max(0,before.temp-after.temp));
}
export function appliedTypes(types,actual,multiplier=1) {
  const damage=number(actual);
  if(!damage)return {};
  const entries=Object.entries(types??{}).filter(([,v])=>number(v)>0);
  if(entries.length===1)return {[entries[0][0]]:damage};
  const total=number(entries.reduce((n,[,v])=>n+number(v),0));
  if(Number(multiplier)===1&&Math.abs(total-damage)<0.001)return Object.fromEntries(entries);
  return {untyped:damage};
}
export const stateSignature=(actor,hp)=>
  actor&&hp?String(actor.uuid??actor.id??"")+":"+hp.hp+":"+hp.temp:"";
function touchesHP(delta) {
  // Foundry may send nested or flat dot-notation changes.
  const hp=delta?.system?.attributes?.hp;
  return Boolean(hp&&(Object.prototype.hasOwnProperty.call(hp,"value")||
      Object.prototype.hasOwnProperty.call(hp,"temp"))||
    delta&&Object.keys(delta).some(k=>k==="system.attributes.hp.value"||
      k==="system.attributes.hp.temp"));
}
function chatId(li) {
  return li?.data?.("messageId")??
    li?.closest?.("[data-message-id]")?.data?.("messageId")??
    li?.[0]?.dataset?.messageId??null;
}
function isApplyAction(text) {
  const value=String(text??"").toLowerCase().replace(/[\s_-]+/g,"");
  return value.includes("applydamage")||value.includes("damageapply")||
    value.includes("applyhalfdamage")||value.includes("applydoubledamage")||
    value.includes("halfdamage")||value.includes("doubledamage");
}
export function installAppliedCapture({
  actorForMessage,validActor,messageDamageType,filterTypes,totalOf,
  cleanNote,combatDetails,isTracking,mode,send,
  // The primary GM captures EVERY user's actor updates. Other users capture
  // only updates they initiate so they can forward source data via the socket.
  isPrimaryGM=()=>game.user.isGM
}) {
  const enabled=()=>isTracking()&&["rolls","applied"].includes(mode());
  const snapshots=new Map();
  const appliedPending=new Map();
  const seen=new Map();
  let clickIntent=null;
  const now=()=>Date.now();
  const keyOf=actor=>String(actor?.uuid??actor?.id??"");
  const primary=()=>Boolean(isPrimaryGM());
  const canCapture=userId=>primary()||
    (!game.user.isGM&&(!userId||userId===game.user.id));
  function getMessage(id) {
    return id?game.messages.get(id)??null:null;
  }
  function sourceForMessage(message) {
    const source=message&&actorForMessage(message);
    if(!validActor(source))return null;
    const rolls=message.rolls??(message.roll?[message.roll]:[]);
    const roll=extractDamage(rolls,messageDamageType(message));
    if(!roll)return null;
    return {source,roll,message,at:now()};
  }
  function click(message) {
    const match=sourceForMessage(message);
    if(match)clickIntent=match;
    return match;
  }
  function currentClick() {
    return clickIntent&&now()-clickIntent.at<20000?clickIntent:null;
  }
  function findRecentMessage(userId,target) {
    // A GM generally has all chat messages, including those rolled by players.
    // This fallback is important when other users applied damage or a module
    // bypassed the standard context menu.
    const messages=game.messages?.contents??[];
    const newest=[...messages].slice(-35).reverse();
    const matches=[];
    for(const message of newest) {
      const stamp=Number(message.timestamp??message._source?.timestamp??0);
      if(!stamp||now()-stamp>20000||stamp>now()+2000)continue;
      const details=sourceForMessage(message);
      if(!details||details.source.id===target?.id)continue;
      const author=message.user?.id??message.userId??"";
      const actor=combatActor();
      let score=0;
      if(userId&&author===userId)score+=4;
      if(actor?.id===details.source.id)score+=6;
      if(currentClick()?.message?.id===message.id)score+=8;
      if(game.user?.targets?.some?.(t=>t.actor?.id===target?.id))score+=1;
      matches.push({...details,score});
    }
    matches.sort((a,b)=>b.score-a.score||b.message.timestamp-a.message.timestamp);
    // If multiple different sources are equally likely outside of combat,
    // don't attribute another PC's damage using a guess.
    if(matches.length>1&&matches[0].score===matches[1].score&&
        matches[0].source.id!==matches[1].source.id)return null;
    return matches[0]??null;
  }
  function combatActor() {
    const combat=game.combat;
    return combat?.started&&Number(combat.round)>=1?
      combat.combatant?.actor??null:null;
  }
  function actorRef(value) {
    if(!value)return null;
    if(typeof value==="string")return game.actors.get(value)??null;
    if(value.actor?.id)return value.actor;
    if(value.id&&value.type)return value;
    return null;
  }
  function contextFrom(options,target,userId,verifiedApplication=false) {
    const message=options?.message?.rolls?options.message:
      getMessage(options?.messageId??options?.chatMessageId??options?.message?.id);
    const supplied=actorRef(options?.sourceActor)??actorRef(options?.attacker)??
      actorRef(options?.source)??actorRef(options?.sourceActorId);
    const fromMessage=sourceForMessage(message);
    if(validActor(supplied)&&supplied.id!==target?.id)
      return {source:supplied,roll:fromMessage?.roll??null,message,at:now()};
    if(fromMessage&&fromMessage.source.id!==target?.id)return fromMessage;
    const clicked=currentClick();
    if(clicked&&clicked.source.id!==target?.id)return clicked;
    const recent=findRecentMessage(userId,target);
    if(recent)return recent;
    // Only verified D&D5e damage application may fall back to initiative
    // actor when no damage chat message was available.
    const turn=verifiedApplication?combatActor():null;
    if(validActor(turn)&&turn.id!==target?.id)
      return {source:turn,roll:null,message:null,at:now()};
    return null;
  }
  function remember(snapshotKey) {
    const old=seen.get(snapshotKey);
    if(old&&now()-old<15000)return false;
    seen.set(snapshotKey,now());
    if(seen.size>500)for(const [key,time] of seen)
      if(now()-time>20000)seen.delete(key);
    return true;
  }
  function record(target,actual,details,after) {
    if(!enabled()||!details||!validActor(details.source)||!number(actual))return false;
    const types=filterTypes(details.roll?
      appliedTypes(details.roll.types,actual):{untyped:number(actual)});
    const damage=totalOf(types);
    if(!damage)return false;
    const signature=stateSignature(target,after);
    if(!signature)return false;
    const combat=combatDetails(details.source);
    // Deterministic key prevents a simultaneous player socket + GM-side
    // update from adding the same applied HP state twice to world settings.
    const sourceKey="applied:"+signature+":"+details.source.id+":"+
      (details.message?.id??"system")+":"+(combat.combatId??"")+":"+
      (combat.round??"");
    if(!remember(sourceKey))return false;
    send([{
      id:sourceKey,sourceKey,source:"applied",
      actorId:details.source.id,actorName:details.source.name,
      damage,types,formula:details.roll?.formula??"",
      critical:Boolean(details.roll?.critical),
      note:(details.message?cleanNote(details.message,details.source):"Applied damage")+
        " → "+String(target.token?.name??target.name??"Target"),
      date:now(),...combat,manualOverride:false
    }]);
    return true;
  }
  function snapshot(target) {
    const key=keyOf(target);
    if(!key)return null;
    const info={before:readHP(target),at:now()};
    snapshots.set(key,info);
    return info;
  }
  function consume(target,after) {
    const key=keyOf(target);
    const snap=snapshots.get(key);
    if(!snap||now()-snap.at>15000)return 0;
    return hpLoss(snap.before,after);
  }
  // These hooks fire on all clients for Actor updates. Recording on the
  // primary GM, regardless of originating userId, fixes remote-player damage.
  Hooks.on("preUpdateActor",(actor,delta,_opts,_userId)=>{
    if(!enabled()||!touchesHP(delta))return;
    snapshot(actor);
  });
  Hooks.on("updateActor",(actor,delta,_opts,userId)=>{
    if(!enabled()||!touchesHP(delta)||!canCapture(userId))return;
    const after=readHP(actor),actual=consume(actor,after);
    if(!actual)return; // A roll or zero HP change is not a hit.
    const pending=appliedPending.get(keyOf(actor));
    const verified=Boolean(pending&&now()-pending.at<15000);
    const details=verified?pending.details:
      contextFrom(null,actor,userId,false);
    if(details)record(actor,actual,details,after);
    if(verified)appliedPending.delete(keyOf(actor));
  });
  // D&D5e 2.x/3.x damage application path: store source at the start, and
  // count after document update; never use the raw rolled value as damage.
  Hooks.on("dnd5e.preApplyDamage",(actor,_amount,_updates,options)=>{
    if(!enabled()||!actor)return;
    const details=contextFrom(options,actor,game.user.id,true);
    appliedPending.set(keyOf(actor),{at:now(),details});
    snapshot(actor);
  });
  Hooks.on("dnd5e.applyDamage",(actor,amount,options)=>{
    if(!enabled()||!actor||(!primary()&&game.user.isGM))return;
    const after=readHP(actor);
    if(!after)return;
    const pending=appliedPending.get(keyOf(actor));
    const details=pending?.details??contextFrom(options,actor,game.user.id,true);
    const measured=consume(actor,after);
    // This hook only runs after the system applied damage. If Foundry did
    // not expose a pre-update snapshot, amount is the system-applied value.
    const actual=measured||number(amount);
    if(actual&&details)record(actor,actual,details,after);
    appliedPending.delete(keyOf(actor));
  });
  // A fallback for versions/integrations emitting damageActor on HP loss.
  // Document-update and apply-damage paths are deduplicated via sourceKey.
  Hooks.on("dnd5e.damageActor",(actor,changes,_delta,userId)=>{
    if(!enabled()||!actor||!canCapture(userId))return;
    const after=readHP(actor);
    if(!after)return;
    const measured=consume(actor,after);
    const confirmed=Math.max(0,-Number(changes?.total??0));
    const actual=measured||number(confirmed);
    const pending=appliedPending.get(keyOf(actor));
    const details=pending?.details??contextFrom(null,actor,userId,Boolean(pending));
    if(actual&&details)record(actor,actual,details,after);
  });
  // Chat card "Apply Damage" button: capture provenance, NOT dice totals.
  Hooks.on("renderChatMessage",(message,html)=>{
    const element=html?.[0]??html;
    if(!element?.addEventListener||element._damageTrakerObserved)return;
    element._damageTrakerObserved=true;
    element.addEventListener("click",event=>{
      if(!enabled())return;
      const el=event.target?.closest?.("button,[data-action],a");
      if(!el||!element.contains(el))return;
      const action=el.dataset?.action??"";
      const label=el.getAttribute("title")??
        el.getAttribute("aria-label")??el.textContent??"";
      if(isApplyAction(action)||isApplyAction(label)||
        /(?:apply|deal)\s+(?:half\s+|double\s+)?damage/i.test(label))click(message);
    },true);
  });
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
      const multiplier=names.get(name)??(isApplyAction(name)?1:null);
      if(multiplier===null)continue;
      const original=action.callback;
      action._damageTrakerWrapped=true;
      action.callback=async li=>{
        if(!enabled())return original(li);
        const message=getMessage(chatId(li)),details=click(message);
        if(!details)return original(li);
        const targets=[...(canvas.tokens?.controlled??[])]
          .map(token=>({actor:token.actor,before:readHP(token.actor)}))
          .filter(t=>t.actor&&t.before);
        const result=await original(li);
        for(const {actor,before} of targets){
          const after=readHP(actor),actual=hpLoss(before,after);
          if(!actual)continue;
          const typed=details.roll?{...details,roll:{...details.roll,
            types:appliedTypes(details.roll.types,details.roll.damage*multiplier,multiplier)}}:details;
          record(actor,actual,typed,after);
        }
        return result;
      };
    }
  });
}
