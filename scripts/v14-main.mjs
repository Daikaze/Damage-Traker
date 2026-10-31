import {ALL_TYPES,TYPE_NAMES,UNKNOWN,number,leaderboard} from "./core.mjs";
import {heroKey,addHero,heroRoster,recordsForHero,sessionHistory} from "./roster.mjs";
import {portraitKey,bestPortrait} from "./portraits.mjs";
import {installV14DamageCapture} from "./v14-applied.mjs";

const MOD="damage-traker", {ApplicationV2,HandlebarsApplicationMixin}=foundry.applications.api;
const get=(key)=>game.settings.get(MOD,key);
const rows=()=>Array.isArray(get("records"))?get("records"):[];
const roster=()=>Array.isArray(get("players"))?get("players"):[];
const escape=s=>Handlebars.escapeExpression(String(s??""));
const fmt=n=>number(n).toLocaleString("en-US",{maximumFractionDigits:2});
const worlds=()=>[...(game.actors?.contents??[])].filter(a=>a.type==="character").sort((a,b)=>a.name.localeCompare(b.name));
function portrait(id,name){
  const actor=id?game.actors?.get(id):null;
  const key=portraitKey(id,name),overrides=get("portraits")??{};
  const sceneToken=canvas?.tokens?.placeables?.find(t=>t.actor?.id===id);
  return bestPortrait({
    override:overrides[key],
    activeToken:sceneToken?.document?.texture?.src,
    prototypeToken:actor?.prototypeToken?.texture?.src,
    actorImage:actor?.img
  })??"";
}
function trustedAmount(v){const n=number(v);return n>0&&n<=999999?n:0;}
let activeApp=null;
class HallOfFame extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS={
    id:"damage-hall-v14",
    classes:["damage-hall-v14"],
    window:{title:"Damage Hall of Fame",icon:"fa-solid fa-trophy",frame:true,resizable:true,minimizable:true},
    position:{width:990,height:740}
  };
  static PARTS={main:{template:"modules/damage-traker/templates/v14-window.hbs"}};
  constructor(...args){
    super(...args);
    this.metric="hit";this.filter="all";this.selected="";this.view="board";
    this.showRoster=false;this.showTypes=false;this.editId=null;
    this._scrollTop=0;this.busy=false;
  }
  _canRender(options){if(!game.user)return false;return super._canRender(options);}
  async _prepareContext(options){
    const context=await super._prepareContext(options);
    const records=rows(),heroes=heroRoster(roster(),records);
    const hero=heroes.find(h=>h.key===this.selected)??null;
    if(this.selected&&!hero)this.selected="";
    const filtered=recordsForHero(records,hero);
    const ranks=leaderboard(filtered,this.metric,this.filter).map(r=>({
      ...r,amountText:fmt(r.amount),portrait:portrait(r.actorId,r.actorName)
    }));
    const types=ALL_TYPES.map(t=>({id:t,label:TYPE_NAMES[t],selected:this.filter===t,checked:(get("enabledTypes")??ALL_TYPES).includes(t)}));
    const history=hero?[...filtered].sort((a,b)=>(b.date??0)-(a.date??0)).slice(0,150).map(r=>({
      ...r,amountText:fmt(r.damage),typeText:Object.entries(r.types??{[UNKNOWN]:r.damage})
        .map(([type,amount])=>`${TYPE_NAMES[type]??type}: ${fmt(amount)}`).join(" · "),
      dateText:r.date?new Date(r.date).toLocaleDateString():"",
      sessionText:String(r.session??""),roundText:r.round?`Round ${r.round}`:"Outside combat"
    })):[];
    const sessions=hero?sessionHistory(records,hero).map(s=>({...s,totalText:fmt(s.total)})):[];
    const chosen=records.find(r=>r.id===this.editId)??null;
    const initial=chosen??{actorId:hero?.actorId??"",actorName:hero?.actorName??"",damage:"",note:"",session:get("currentSession")??"",type:UNKNOWN};
    const editingType=Object.keys(chosen?.types??{})[0]??UNKNOWN;
    return {
      ...context,rankRows:ranks,leader:ranks[0]??null,hasRecords:ranks.length>0,
      isGM:game.user.isGM,tracking: get("trackingEnabled")!==false,
      heroOptions:heroes.map(h=>({...h,selected:h.key===this.selected,portrait:portrait(h.actorId,h.actorName)})),
      selectedHero:hero,heroPortrait:hero?portrait(hero.actorId,hero.actorName):"",
      history,sessions,hasHistory:history.length>0,showHistory:this.view==="history",
      showEdit:this.view==="edit"&&game.user.isGM,showRoster:this.showRoster,showTypes:this.showTypes,
      currentSession:String(get("currentSession")??""),
      metrics:[{id:"hit",label:"Highest Hit",selected:this.metric==="hit"},
        {id:"total",label:"Total Damage",selected:this.metric==="total"},
        {id:"round",label:"Best Round",selected:this.metric==="round"}],
      types,allSelected:this.filter==="all",allTypeOptions:ALL_TYPES.map(t=>({id:t,label:TYPE_NAMES[t],selected:t===editingType})),
      rosterActors:worlds().map(a=>({id:a.id,name:a.name})),
      editing:!!chosen,edit:initial,
      totalEvents:records.length,heroCount:heroes.length,
      canViewHistory:!!hero,busy:this.busy
    };
  }
  _onRender(context,options){
    super._onRender(context,options);
    const root=this.element?.querySelector(".dt14");
    if(!root)return;
    const scroll=root.querySelector(".dt14-body");
    if(scroll){scroll.scrollTop=this._scrollTop;scroll.addEventListener("scroll",()=>{this._scrollTop=scroll.scrollTop;},{passive:true});}
    root.addEventListener("click",event=>{
      const button=event.target.closest("[data-hof-action]");
      if(!button||!root.contains(button)||button.disabled)return;
      void this._handle(button.dataset.hofAction,button,root).catch(e=>this._error(e));
    });
    root.addEventListener("change",event=>{
      const target=event.target;
      if(target.matches("[data-hof-metric]")){this.metric=target.value;void this._refresh();}
      else if(target.matches("[data-hof-type]")){this.filter=target.value;void this._refresh();}
      else if(target.matches("[data-hof-player]")){this.selected=target.value;this.view="board";void this._refresh();}
      else if(target.matches("[data-hof-tracking]")&&game.user.isGM){void this._write("trackingEnabled",target.checked);}
      else if(target.matches("[data-hof-enabled]")&&game.user.isGM){
        const set=new Set(get("enabledTypes")??ALL_TYPES);
        if(target.checked)set.add(target.dataset.hofEnabled);else set.delete(target.dataset.hofEnabled);
        void this._write("enabledTypes",ALL_TYPES.filter(t=>set.has(t)));
      }
    });
    root.querySelectorAll("form[data-hof-form]").forEach(form=>form.addEventListener("submit",event=>{
      event.preventDefault();if(!game.user.isGM||this.busy)return;
      const action=form.dataset.hofForm;
      void (action==="edit"?this._saveRecord(form):action==="roster"?this._addPlayer(form):
        action==="session"?this._write("currentSession",String(form.elements.session?.value??"").slice(0,80)):
        action==="portrait"?this._savePortrait(form):Promise.resolve()).catch(e=>this._error(e));
    }));
  }
  _error(e){console.error(MOD,e);ui.notifications.error("Damage Hall of Fame: "+String(e?.message??e));}
  _refresh(){return this.render({force:true});}
  async _write(key,value){if(!game.user.isGM||this.busy)return;this.busy=true;try{await game.settings.set(MOD,key,value);}finally{this.busy=false;await this._refresh();}}
  async _handle(action,button,root){
    if(action==="view-history"){if(this.selected){this.view="history";this._scrollTop=0;await this._refresh();}return;}
    if(action==="view-board"){this.view="board";this._scrollTop=0;await this._refresh();return;}
    if(action==="open-hero"){this.selected=button.dataset.key;this.view="history";this._scrollTop=0;await this._refresh();return;}
    if(!game.user.isGM||this.busy)return;
    if(action==="toggle-roster"){this.showRoster=!this.showRoster;await this._refresh();}
    if(action==="toggle-types"){this.showTypes=!this.showTypes;await this._refresh();}
    if(action==="new-record"){this.editId=null;this.view="edit";await this._refresh();}
    if(action==="edit-record"){this.editId=button.dataset.id;this.view="edit";await this._refresh();}
    if(action==="cancel-edit"){this.view=this.selected?"history":"board";this.editId=null;await this._refresh();}
    if(action==="delete-record"){
      const entry=rows().find(r=>r.id===button.dataset.id);
      if(!entry)return;
      const yes=await foundry.applications.api.DialogV2.confirm({
        window:{title:"Delete Damage Record"},
        content:`<p>Delete the applied-damage event for <strong>${escape(entry.actorName)}</strong>?</p>`,
        yes:{label:"Delete"},no:{label:"Cancel"},rejectClose:false
      });
      if(yes)await this._write("records",rows().filter(r=>r.id!==entry.id));
    }
    if(action==="remove-hero"){
      const key=button.dataset.key;
      const entry=roster().find(h=>heroKey(h.actorId,h.actorName)===key);
      if(!entry)return;
      const yes=await foundry.applications.api.DialogV2.confirm({
        window:{title:"Remove PC from roster"},content:`Remove <strong>${escape(entry.actorName)}</strong> from the roster? Damage history is preserved.`,
        yes:{label:"Remove"},no:{label:"Cancel"},rejectClose:false
      });
      if(yes)await this._write("players",roster().filter(r=>heroKey(r.actorId,r.actorName)!==key));
    }
    if(action==="save-record-session"){
      const id=button.dataset.id;
      const input=root.querySelector(`[data-record-session="${CSS.escape(id)}"]`);
      const value=String(input?.value??"").trim().slice(0,80);
      await this._write("records",rows().map(r=>r.id===id?{...r,session:value}:r));
    }
  }
  async _addPlayer(form){
    const id=String(form.elements.actor?.value??"");
    const actor=id?game.actors.get(id):null;
    const name=String(actor?.name??form.elements.name?.value??"").trim().slice(0,100);
    if(!name){ui.notifications.warn("Choose a character or enter a PC name.");return;}
    this.selected=heroKey(actor?.id??"",name);
    this.showRoster=false;
    await this._write("players",addHero(roster(),actor?.id??"",name));
  }
  async _savePortrait(form){
    if(!this.selected)return;
    const hero=heroRoster(roster(),rows()).find(h=>h.key===this.selected);
    if(!hero)return;
    const key=portraitKey(hero.actorId,hero.actorName);
    const value=String(form.elements.portrait?.value??"").trim();
    if(value.length>2048||/[<>\r\n]/.test(value)||/^(?:javascript|data|file):/i.test(value))throw Error("Invalid portrait path.");
    await this._write("portraits",{...(get("portraits")??{}),[key]:value});
  }
  async _saveRecord(form){
    const data=form.elements;
    const actor=game.actors.get(String(data.actor?.value??""));
    const name=String(actor?.name??data.name?.value??"").trim().slice(0,100);
    const damage=trustedAmount(data.damage?.value);
    if(!name||!damage){ui.notifications.warn("Enter a character and positive applied damage.");return;}
    const type=ALL_TYPES.includes(data.type?.value)?data.type.value:UNKNOWN;
    const existing=rows().find(r=>r.id===this.editId);
    const round=Number(data.round?.value);
    const validRound=Number.isSafeInteger(round)&&round>=1?round:null;
    const item={
      id:existing?.id??foundry.utils.randomID(),sourceKey:existing?.sourceKey??"",
      source:existing?.source??"manual-v14",
      actorId:actor?.id??"",actorName:name,damage,types:{[type]:damage},
      note:String(data.note?.value??"Manual applied damage").slice(0,120),
      session:String(data.session?.value??"").slice(0,80),
      combatId:validRound?String(data.combatId?.value??"").slice(0,100):"",
      round:validRound,date:existing?.date??Date.now(),
      formula:"",critical:false,manualOverride:true
    };
    this.selected=heroKey(item.actorId,item.actorName);
    this.view="history";this.editId=null;
    const next=rows().filter(r=>r.id!==item.id);next.push(item);
    await this._write("records",next);
  }
}
async function openHall(){
  if(!activeApp)activeApp=new HallOfFame();
  if(activeApp.rendered){activeApp.bringToFront();return activeApp;}
  try{await activeApp.render({force:true});return activeApp;}
  catch(e){console.error(MOD,e);ui.notifications.error("Could not open Damage Hall of Fame.");}
}
function register(key,options){game.settings.register(MOD,key,{scope:"world",config:false,...options});}
Hooks.once("init",()=>{
  register("records",{type:Array,default:[]});
  register("players",{type:Array,default:[]});
  register("portraits",{type:Object,default:{}});
  register("currentSession",{type:String,default:""});
  register("enabledTypes",{type:Array,default:ALL_TYPES});
  register("trackingEnabled",{type:Boolean,default:true,config:true,name:"Automatic Applied Damage Tracking",
    hint:"GM-side post-apply hooks only. No unverified rolls; no player socket for remote writes."});
  register("captureMode",{type:String,default:"applied",config:false}); // Legacy setting preserved.
  register("includeNPC",{type:Boolean,default:false,config:false}); // Tracking remains PC-only.
  game.settings.registerMenu(MOD,"openHall",{
    name:"Open Damage Hall of Fame",label:"Open Hall of Fame",
    icon:"fa-solid fa-trophy",type:HallOfFame,restricted:false
  });
});
Hooks.once("ready",()=>{
  if(game.system?.id!=="dnd5e"){ui.notifications.warn("Damage Hall of Fame requires D&D 5e.");return;}
  installV14DamageCapture();
  const mod=game.modules.get(MOD);
  if(mod)mod.api={open:openHall,records:()=>foundry.utils.deepClone(rows()),leaderboard:(metric,type)=>leaderboard(rows(),metric,type)};
});
Hooks.on("getSceneControlButtons",controls=>{
  if(!controls||typeof controls!=="object"||controls.damageHallOfFame)return;
  const name="damageHallOfFame";
  controls[name]={
    name,title:"Damage Hall of Fame",icon:"fa-solid fa-trophy",
    order:Math.max(0,...Object.values(controls).map(x=>Number(x?.order)||0))+1,
    visible:true,activeTool:"open",onChange:(_event,active)=>{if(active)void openHall();},
    tools:{open:{name:"open",title:"Open Hall of Fame",icon:"fa-solid fa-trophy",order:0,
      visible:true,onChange:(_event,active)=>{if(active)void openHall();}}}
  };
});
