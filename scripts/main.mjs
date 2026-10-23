import {DAMAGE_TYPES, ALL_TYPES, TYPE_NAMES, UNKNOWN, number, extractDamage, leaderboard} from "./core.mjs";

const MOD = "damage-traker";
const SOCKET = "module." + MOD;
let queue = Promise.resolve();
let windowApp;
const getRecords = () => game.settings.get(MOD, "records") ?? [];
const isTracking = () => game.settings.get(MOD, "trackingEnabled");
const activeTypes = () => game.settings.get(MOD, "enabledTypes") ?? ALL_TYPES;
const safe = value => Handlebars.escapeExpression(String(value ?? ""));
const activeGM = () => game.user.isGM && game.users.filter(u => u.active && u.isGM)
  .sort((a, b) => a.id.localeCompare(b.id))[0]?.id === game.user.id;
const validActor = a => a && (game.settings.get(MOD, "includeNPC") || a.type === "character");
const numeric = amount => Number(number(amount)).toLocaleString("en-US", {maximumFractionDigits: 2});
function enqueue(action) {
  queue = queue.then(action).catch(e => {
    console.error(MOD, e);
    ui.notifications.error("Damage Hall of Fame: " + e.message);
  });
  return queue;
}
const refresh = () => windowApp?.render(false);
async function updateRecords(newRecords) {
  if (!game.user.isGM) return;
  await game.settings.set(MOD, "records", newRecords);
}
async function storeEvents(entries) {
  if (!isTracking() || !activeGM() || !entries.length) return;
  const all = foundry.utils.deepClone(getRecords());
  let dirty = false;
  for (const row of entries) {
    const existing = all.findIndex(r => r.sourceKey && row.sourceKey && r.sourceKey === row.sourceKey);
    if (existing >= 0) {
      if (all[existing].manualOverride || JSON.stringify(all[existing].types) === JSON.stringify(row.types)) continue;
      all[existing] = {...row, id: all[existing].id};
    } else all.push(row);
    dirty = true;
  }
  if (dirty) await updateRecords(all);
}
function actorForMessage(message) {
  const speaker = message.speaker ?? {};
  return ChatMessage.getSpeakerActor?.(speaker) ??
    (speaker.token && speaker.scene
      ? game.scenes.get(speaker.scene)?.tokens.get(speaker.token)?.actor : null) ??
    game.actors.get(speaker.actor);
}
function combatDetails(actor) {
  const combat = game.combat;
  if (!combat?.started || !combat.id || combat.round < 1) return {combatId:"", round:null};
  const participating = combat.combatants.some(combatant =>
    combatant.actorId === actor?.id ||
    (actor?.token?.id && combatant.tokenId === actor.token.id));
  return participating ? {combatId:combat.id,round:combat.round} : {combatId:"",round:null};
}
function cleanNote(message, actor) {
  const itemId = message.flags?.dnd5e?.roll?.itemId ?? message.flags?.dnd5e?.itemId;
  const item = itemId ? actor.items?.get(itemId) : null;
  const html = String(item?.name || message.flavor || "Damage roll");
  return html.replace(/<[^>]+>/g, "").trim().slice(0, 120) || "Damage roll";
}
function messageDamageType(message) {
  return message.flags?.dnd5e?.roll?.type ??
    message.flags?.dnd5e?.roll?.rollType ??
    message.flags?.dnd5e?.type ?? "";
}
function filteredTypes(types) {
  return Object.fromEntries(Object.entries(types ?? {})
    .filter(([type, amount]) => activeTypes().includes(type) && number(amount) > 0)
    .map(([type, amount]) => [type, number(amount)]));
}
function totalOf(types) {
  return number(Object.values(types).reduce((acc, value) => acc + number(value), 0));
}
function captureChat(message) {
  if (!isTracking() || !activeGM() || game.settings.get(MOD, "captureMode") !== "rolls") return;
  if (!message?.id) return;
  const actor = actorForMessage(message);
  if (!validActor(actor)) return;
  const found = extractDamage(message.rolls ?? (message.roll ? [message.roll] : []), messageDamageType(message));
  if (!found) return;
  const types = filteredTypes(found.types);
  const damage = totalOf(types);
  if (!damage) return;
  const row = {
    id:"chat:" + message.id, sourceKey:"chat:" + message.id, source:"roll",
    actorId:actor.id, actorName:actor.name, damage, types, note:cleanNote(message, actor),
    critical:found.critical, formula:found.formula,
    date:message.timestamp ?? Date.now(), ...combatDetails(actor),
    manualOverride:false
  };
  enqueue(() => storeEvents([row]));
}
/** Optional Midi-QOL integration, counts one applied-damage event per target.
 * Applied type breakdown is used only if Midi exposes an exact post-resistance
 * per-type object. Otherwise mark applied total "Other / Unknown".
 */
function midiEvents(workflow) {
  const actor = workflow?.actor ?? workflow?.item?.parent;
  if (!validActor(actor) || !Array.isArray(workflow.damageList)) return [];
  const key = String(workflow.itemCardId ?? workflow.uuid ?? workflow.id ?? "");
  if (!key) return [];
  const rows = [];
  const combat = combatDetails(actor);
  for (const [i, target] of workflow.damageList.entries()) {
    const amount = number(target?.appliedDamage);
    if (!amount) continue;
    const details = target?.appliedDamageDetail;
    let types = {[UNKNOWN]:amount};
    // Some Midi versions include post-mitigation per-type damage. Check totals
    // before accepting the split so damage is never estimated.
    if (Array.isArray(details) && details.length) {
      const proposed = {};
      for (const part of details) {
        const type = DAMAGE_TYPES.includes(part?.type) ? part.type : UNKNOWN;
        proposed[type] = number((proposed[type] ?? 0) + number(part?.damage));
      }
      if (Math.abs(totalOf(proposed) - amount) < 0.01) types = proposed;
    }
    types = filteredTypes(types);
    const damage = totalOf(types);
    if (!damage) continue;
    const targetId = String(target.tokenId ?? target.actorId ?? i);
    const sourceKey = "midi:" + key + ":" + targetId;
    rows.push({
      id:sourceKey,sourceKey,source:"midi",actorId:actor.id,actorName:actor.name,
      damage, types, note:String(workflow.item?.name || "Applied damage") +
        " → " + String(target.token?.name ?? target.actor?.name ?? "Target"),
      formula:String(workflow.damageRoll?.formula ?? ""),critical:Boolean(workflow.isCritical),
      date:Date.now(), ...combat, manualOverride:false
    });
  }
  return rows;
}
function captureMidi(workflow) {
  if (!isTracking() || game.settings.get(MOD, "captureMode") !== "midi") return;
  const rows = midiEvents(workflow);
  if (!rows.length) return;
  if (activeGM()) enqueue(() => storeEvents(rows));
  else if (!game.user.isGM) game.socket.emit(SOCKET, {
    userId:game.user.id, actorId:rows[0].actorId, type:"midi", rows
  });
}
function socketHandler(message) {
  if (!activeGM() || !isTracking() || game.settings.get(MOD, "captureMode") !== "midi") return;
  if (message?.type !== "midi" || !Array.isArray(message.rows) || message.rows.length > 100) return;
  const user = game.users.get(message.userId);
  const actor = game.actors.get(message.actorId);
  if (!user?.active || !actor || !validActor(actor) || !actor.testUserPermission(user,"OWNER")) return;
  const rows = message.rows.filter(r =>
    r.actorId === actor.id && typeof r.sourceKey === "string" &&
    /^midi:[^:]+:.+$/.test(r.sourceKey) && r.sourceKey.length < 250 &&
    number(r.damage) > 0 && number(r.damage) < 1000000 &&
    r.types && typeof r.types === "object"
  ).map(r => {
    const types = filteredTypes(r.types);
    const damage = totalOf(types);
    return {
      id:r.sourceKey,sourceKey:r.sourceKey,source:"midi",
      actorId:actor.id,actorName:actor.name,damage,types,
      note:String(r.note ?? "Applied damage").slice(0,120),
      formula:String(r.formula ?? "").slice(0,300),critical:Boolean(r.critical),
      date:Date.now(),combatId:String(r.combatId ?? "").slice(0,80),
      round:Number.isInteger(r.round) && r.round >= 1 ? r.round : null,
      manualOverride:false
    };
  }).filter(r => r.damage > 0);
  if (rows.length) enqueue(() => storeEvents(rows));
}
class Dashboard extends Application {
  constructor(options={}) {
    super(options);
    this.metric = "hit";
    this.damageFilter = "all";
    this.showTypes = false;
  }
  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions,{
      id:"damage-hall-of-fame", title:"Damage Hall of Fame",
      template:"modules/damage-traker/templates/window.hbs",
      width:790,height:680,minWidth:530,minHeight:440,
      resizable:true,classes:["damage-hall-app"]
    });
  }
  getData() {
    const types = ALL_TYPES.map(key => ({
      key, name:TYPE_NAMES[key], checked:activeTypes().includes(key),
      selected:this.damageFilter === key
    }));
    const leaders = leaderboard(getRecords(),this.metric,this.damageFilter).map(r => ({
      ...r, amountText:numeric(r.amount),
      initial:r.actorName[0]?.toUpperCase() ?? "?", crowned:r.rank === 1,
      dataKey:r.actorId || r.actorName
    }));
    return {
      leaders,first:leaders[0],count:getRecords().length,
      isGM:game.user.isGM,tracking:isTracking(),
      hasRecords:leaders.length > 0,showTypes:this.showTypes,
      types,allSelected:this.damageFilter === "all",
      filterLabel:this.damageFilter === "all" ? "All damage types" : TYPE_NAMES[this.damageFilter],
      metricName:this.metric === "hit" ? "Highest Single Hit" :
        this.metric === "total" ? "Total Damage" : "Best Round",
      hit:this.metric === "hit",total:this.metric === "total",round:this.metric === "round",
      captureMode:game.settings.get(MOD,"captureMode") === "midi" ? "Midi-QOL applied" : "Damage rolls",
      enabledCount:activeTypes().length
    };
  }
  activateListeners(html) {
    super.activateListeners(html);
    html.find("[data-metric]").on("click", event => {
      this.metric = event.currentTarget.dataset.metric;
      this.render(false);
    });
    html.find("[data-filter]").on("change", event => {
      this.damageFilter = event.currentTarget.value;
      this.render(false);
    });
    html.find("[data-toggle-types]").on("click",()=>{
      this.showTypes = !this.showTypes;
      this.render(false);
    });
    html.find("[data-tracking]").on("change", event => {
      if (!game.user.isGM) return;
      const enabled=Boolean(event.currentTarget.checked);
      enqueue(()=>game.settings.set(MOD,"trackingEnabled",enabled));
    });
    html.find("[data-enabled-type]").on("change",event => {
      if (!game.user.isGM) return;
      const type = event.currentTarget.dataset.enabledType;
      const enabled = Boolean(event.currentTarget.checked);
      enqueue(async () => {
        const next = new Set(activeTypes());
        if (enabled) next.add(type); else next.delete(type);
        await game.settings.set(MOD,"enabledTypes",ALL_TYPES.filter(t => next.has(t)));
      });
    });
    html.find("[data-add]").on("click",()=>this.editDialog());
    html.find("[data-manage]").on("click",()=>this.historyDialog());
    html.find("[data-records]").on("click",event=>this.historyDialog(event.currentTarget.dataset.records));
  }
  editDialog(existing = null) {
    if (!game.user.isGM) return;
    const options=game.actors.filter(validActor).sort((a,b)=>a.name.localeCompare(b.name))
      .map(a=>'<option value="'+safe(a.id)+'" '+
      (existing?.actorId===a.id?"selected":"")+">"+safe(a.name)+"</option>").join("");
    const existingType=Object.keys(existing?.types ?? {})[0] ?? UNKNOWN;
    const typeOptions=ALL_TYPES.map(t=>'<option value="'+t+'" '+
      (existingType === t?"selected":"")+">"+TYPE_NAMES[t]+"</option>").join("");
    const combat=game.combat;
    const combatId=existing?.combatId ?? (combat?.started ? combat.id : "");
    const round=existing?.round ?? (combat?.started ? combat.round : "");
    const content='<form class="dt-form">'+
      '<label>Actor<select name="actor"><option value="">Manual name</option>'+options+'</select></label>'+
      '<label>Manual name<input name="name" value="'+safe(existing?.actorName)+'"></label>'+
      '<label>Damage<input name="damage" type="number" step="0.01" min="0.01" value="'+safe(existing?.damage)+'"></label>'+
      '<label>Damage type<select name="type">'+typeOptions+'</select></label>'+
      '<label>Attack / notes<input name="note" maxlength="120" value="'+safe(existing?.note)+'"></label>'+
      '<div class="dt-form-two"><label>Combat ID<input name="combat" value="'+safe(combatId)+'"></label>'+
      '<label>Round<input name="round" type="number" min="1" step="1" value="'+safe(round)+'"></label></div>'+
      '<p class="notes">Manual edits replace an event with one selected damage type. Mixed-type automatic records should normally be left unchanged.</p></form>';
    new Dialog({
      title:existing?"Edit damage record":"Add damage record",content,
      buttons:{
        save:{label:"Save",icon:'<i class="fas fa-save"></i>',callback:html=>{
          const value=n=>String(html.find('[name="'+n+'"]').val()??"").trim();
          const actor=game.actors.get(value("actor"));
          const name=actor?.name||value("name");
          const damage=number(value("damage"));
          if (!name || !damage) return ui.notifications.warn("Choose an actor/name and enter positive damage.");
          const type=value("type");
          const parsedRound=Number(value("round"));
          const round=value("round") && Number.isInteger(parsedRound) && parsedRound>=1?parsedRound:null;
          const row={
            id:existing?.id ?? foundry.utils.randomID(),
            sourceKey:existing?.sourceKey ?? "",source:existing?.source ?? "manual",
            actorId:actor?.id ?? "",actorName:name,damage,types:{[type]:damage},
            note:value("note")||"Manual record",critical:existing?.critical??false,
            formula:existing?.formula??"",date:existing?.date??Date.now(),
            combatId:round?value("combat"):"",round,manualOverride:true
          };
          enqueue(async()=>{
            const all=foundry.utils.deepClone(getRecords());
            const index=all.findIndex(r=>r.id===row.id);
            if(index<0)all.push(row); else all[index]=row;
            await updateRecords(all);
          });
        }},
        cancel:{label:"Cancel"}
      },default:"save"
    },{width:500}).render(true);
  }
  historyDialog(actorId="") {
    if (!game.user.isGM) return;
    const all=getRecords().filter(row=>!actorId || row.actorId===actorId ||
      (!row.actorId && row.actorName===actorId)).sort((a,b)=>b.date-a.date);
    const rows=all.slice(0,200).map(r=>
      '<div class="dt-history-entry"><span><b>'+safe(r.actorName)+'</b><small>'+
      safe(r.note)+' • '+safe(Object.entries(r.types??{}).map(([t,v])=>TYPE_NAMES[t]+": "+v).join(", "))+
      (r.round?" • Round "+r.round:"")+'</small></span><b>'+numeric(r.damage)+'</b>'+
      '<button data-edit="'+safe(r.id)+'" title="Edit"><i class="fas fa-edit"></i></button>'+
      '<button data-remove="'+safe(r.id)+'" title="Delete"><i class="fas fa-trash"></i></button></div>'
    ).join("");
    const dialog=new Dialog({
      title:"Record Manager ("+all.length+")",
      content:'<div class="dt-history">'+(rows||'<p>No damage events yet.</p>')+
        (all.length>200?'<p>Only the 200 latest entries are shown.</p>':"")+'</div>',
      buttons:{close:{label:"Close"}},
      render:html=>{
        html.find("[data-edit]").on("click",event=>{
          const row=getRecords().find(r=>r.id===event.currentTarget.dataset.edit);
          dialog.close(); if(row)this.editDialog(row);
        });
        html.find("[data-remove]").on("click",async event=>{
          const id=event.currentTarget.dataset.remove;
          if(!await Dialog.confirm({title:"Delete record?",content:"Delete this damage event?"}))return;
          await enqueue(()=>updateRecords(getRecords().filter(r=>r.id!==id)));
          dialog.close();this.historyDialog(actorId);
        });
      }
    },{width:630});
    dialog.render(true);
  }
}
function openWindow() {
  if(!windowApp)windowApp=new Dashboard();
  windowApp.render(true,{focus:true});
}
Hooks.once("init",()=>{
  game.settings.register(MOD,"records",{
    scope:"world",config:false,type:Array,default:[],onChange:refresh
  });
  game.settings.register(MOD,"trackingEnabled",{
    name:"Automatic tracking",hint:"Can also be toggled inside the Hall of Fame window.",
    scope:"world",config:true,type:Boolean,default:true,onChange:refresh
  });
  game.settings.register(MOD,"enabledTypes",{
    scope:"world",config:false,type:Array,default:ALL_TYPES,onChange:refresh
  });
  game.settings.register(MOD,"captureMode",{
    name:"Capture Mode",
    hint:"Roll mode records actual rolled totals, including critical dice; a damage roll is not proof of a hit. Midi-QOL applied mode (optional) records damage applied to each target. Never run both at once.",
    scope:"world",config:true,type:String,default:"rolls",
    choices:{rolls:"D&D5e evaluated damage rolls",midi:"Midi-QOL applied damage"},
    onChange:refresh
  });
  game.settings.register(MOD,"includeNPC",{
    name:"Track NPC damage",scope:"world",config:true,type:Boolean,default:false
  });
});
Hooks.once("ready",()=>{
  if(game.system.id!=="dnd5e")ui.notifications.warn("Damage Hall of Fame: D&D5e is required.");
  game.socket.on(SOCKET,socketHandler);
  Hooks.on("createChatMessage",captureChat);
  Hooks.on("updateChatMessage",(message,change)=>{
    if(Object.prototype.hasOwnProperty.call(change,"rolls") ||
       Object.prototype.hasOwnProperty.call(change,"roll"))captureChat(message);
  });
  Hooks.on("midi-qol.RollComplete",captureMidi);
  if(game.user.isGM && game.settings.get(MOD,"captureMode")==="midi" &&
     !game.modules.get("midi-qol")?.active) {
    ui.notifications.warn("Damage Hall of Fame: activate Midi-QOL or switch to roll mode.");
  }
  game.modules.get(MOD).api={
    open:openWindow,
    records:()=>foundry.utils.deepClone(getRecords()),
    leaderboard:(metric,type)=>leaderboard(getRecords(),metric,type)
  };
});
Hooks.on("renderChatLog",(_app,html)=>{
  if(html.find(".dt-open").length)return;
  const button=$('<button type="button" class="dt-open" title="Damage Hall of Fame"><i class="fas fa-trophy"></i> Hall of Fame</button>');
  button.on("click",openWindow);
  const header=html.find(".directory-header .header-actions").first();
  if(header.length)header.append(button);
  else html.find(".directory-header").first().append(button);
});

// Foundry V11: add one DIRECT-CLICK icon to the main Scene Controls column.
// Use renderSceneControls rather than a new SceneControl (which would require
// selecting its tool in a second click and would change the active canvas layer).
Hooks.on("renderSceneControls", (_app, html) => {
  const mainControls = html.find("ol.main-controls").first();
  if (!mainControls.length || mainControls.find(".dt-damage-hall-control").length) return;

  const control = $('<li class="scene-control dt-damage-hall-control" ' +
    'title="Open Damage Hall of Fame" data-tooltip="Damage Hall of Fame" ' +
    'aria-label="Open Damage Hall of Fame" role="button" tabindex="0">' +
    '<i class="fas fa-trophy"></i></li>');

  const open = event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    openWindow();
  };

  // Click directly opens the dashboard without activating a different tool.
  control.on("click", open);
  control.on("keydown", event => {
    if (event.key === "Enter" || event.key === " ") open(event);
  });
  mainControls.append(control);
});
