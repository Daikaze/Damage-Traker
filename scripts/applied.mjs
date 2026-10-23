/**
 * Foundry V11 D&D5e: record a damage event ONLY after the built-in chat menu's
 * Apply Damage action has actually updated a target's HP/temp HP.
 * Never use createChatMessage as proof that damage was applied.
 */
import {extractDamage, number} from "./core.mjs";

export function readHP(actor) {
  const hp = actor?.system?.attributes?.hp;
  if (!hp) return null;
  const value = Number(hp.value), temp = Number(hp.temp ?? 0);
  return Number.isFinite(value) && Number.isFinite(temp) ? {hp:value,temp} : null;
}
export function hpLoss(before, after) {
  if (!before || !after) return 0;
  return number(Math.max(0,before.hp-after.hp) + Math.max(0,before.temp-after.temp));
}
/** Preserve exact damage types; refuse to fabricate a mixed-type distribution. */
export function appliedTypes(types, actual, multiplier=1) {
  const damage = number(actual);
  if (!damage) return {};
  const entries = Object.entries(types ?? {}).filter(([,v])=>number(v)>0);
  if (entries.length===1) return {[entries[0][0]]:damage};
  const total = number(entries.reduce((n,[,v])=>n+number(v),0));
  if (Number(multiplier)===1 && Math.abs(total-damage)<0.001) return Object.fromEntries(entries);
  return {untyped:damage};
}
function getMessageId(li) {
  return li?.data?.("messageId") ?? li?.[0]?.dataset?.messageId ?? null;
}
export function installAppliedCapture({actorForMessage,validActor,messageDamageType,
  filterTypes,totalOf,cleanNote,combatDetails,isTracking,mode,send}) {
  const labels = [
    ["DND5E.ChatContextDamage",1],
    ["DND5E.ChatContextDoubleDamage",2],
    ["DND5E.ChatContextHalfDamage",0.5]
  ];
  Hooks.on("getChatLogEntryContext", (_html,options) => {
    if (!Array.isArray(options)) return;
    for (const [key,multiplier] of labels) {
      const label = game.i18n.localize(key);
      const action=options.find(x=>x.name===label);
      if (!action || typeof action.callback!=="function" || action._damageTrakerWrapped) continue;
      const original=action.callback;
      action._damageTrakerWrapped=true;
      action.callback=async li=>{
        // No tracking changes how Foundry applies the actual damage.
        if (!isTracking() || !["rolls","applied"].includes(mode())) return original(li);
        const message=game.messages.get(getMessageId(li));
        const source=message && actorForMessage(message);
        if (!validActor(source)) return original(li);
        const roll=extractDamage(message.rolls ?? (message.roll?[message.roll]:[]),messageDamageType(message));
        if (!roll) return original(li);
        const targets=[...(canvas.tokens?.controlled ?? [])]
          .map(token=>({token,actor:token?.actor,before:readHP(token?.actor)}))
          .filter(target=>target.actor && target.before);
        if (!targets.length) return original(li);
        // Await the actual core-system application, then inspect the changed actor documents.
        const result=await original(li);
        const applicationId=foundry.utils.randomID();
        const rows=targets.map(({token,actor,before})=>{
          const after=readHP(actor);
          const actual=hpLoss(before,after);
          if (!actual) return null;
          const types=filterTypes(appliedTypes(roll.types,actual,multiplier));
          const damage=totalOf(types);
          if (!damage) return null;
          const targetId=token.document?.uuid ?? token.id ?? actor.uuid;
          const sourceKey="applied:"+message.id+":"+applicationId+":"+targetId;
          return {
            id:sourceKey,sourceKey,source:"applied",
            actorId:source.id,actorName:source.name,
            damage,types,formula:roll.formula,critical:roll.critical,
            note:cleanNote(message,source)+" → "+(token.name??actor.name),
            date:Date.now(),...combatDetails(source),manualOverride:false
          };
        }).filter(Boolean);
        if (rows.length) send(rows);
        return result;
      };
    }
  });
}
