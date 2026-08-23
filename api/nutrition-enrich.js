'use strict';

const OPENROUTER_URL='https://openrouter.ai/api/v1/chat/completions';
const MACRO_KEYS=['kcal','protein','carbs','sugar','fat','saturatedFat','fiber','salt'];

// These fields are deliberately not estimated numerically by an LLM because
// food-to-food/region/method variability is too high for a generic fallback.
// This list is intentionally much smaller than V2.2: common vitamins, minerals,
// fatty acids and amino acids may be returned as clearly-marked AI estimates,
// but they are still excluded by the app from deficiency calculations.
const HARD_BLOCKED=new Set([
  'iodine','chromium','nickel','fluoride','sulfur','molybdenum','chloride','biotin_b7'
]);

const CAPS={
  thiamin_b1:50,riboflavin_b2:50,niacin_b3:200,pantothenic_acid_b5:50,vitamin_b6:50,
  folate_total_b9:5000,vitamin_b12:1000,vitamin_c:5000,vitamin_d:1000,alpha_tocopherol:1000,
  vitamin_k:5000,choline:3000,calcium:5000,phosphorus:5000,magnesium:2000,sodium:50000,
  potassium:10000,iron:200,zinc:100,copper:20,manganese:100,selenium:5000,vitamin_a_rae:10000,
  alpha_linolenic_acid:100,linoleic_acid:100,arachidonic_acid:100,omega3_total:100,omega6_total:100,
  epa:100,dpa:100,dha:100,leucine:30,isoleucine:30,valine:30,lysine:30,methionine:30,
  threonine:30,tryptophan:10,histidine:30,phenylalanine:30,cysteine:30,tyrosine:30
};

function getBody(req){if(!req.body)return{};if(typeof req.body==='object')return req.body;try{return JSON.parse(req.body)}catch{return{}}}
function clean(v,max=400){return String(v??'').trim().slice(0,max)}
function finiteOrNull(v){if(v===''||v==null)return null;const n=Number(v);return Number.isFinite(n)?n:null}
function assistantText(data){const c=data?.choices?.[0]?.message?.content;if(typeof c==='string')return c;if(Array.isArray(c))return c.map(x=>typeof x==='string'?x:(x?.text||x?.content||'')).join('');if(c&&typeof c==='object'){try{return JSON.stringify(c)}catch{}}return''}
function parseJsonLoose(data){
  for(const x of[data?.choices?.[0]?.message?.parsed,data?.parsed])if(x&&typeof x==='object')return x;
  const raw=assistantText(data).trim();if(!raw)return null;
  const unfenced=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
  const variants=[raw,unfenced];const a=unfenced.indexOf('{'),b=unfenced.lastIndexOf('}');if(a>=0&&b>a)variants.push(unfenced.slice(a,b+1));
  for(const s of variants){try{const x=JSON.parse(s);if(x&&typeof x==='object')return x}catch{}}
  return null;
}
function sanitizeLabel(label,known){
  const out={};
  for(const k of MACRO_KEYS){
    if(known[k]!==null){out[k]=null;continue;}
    const v=finiteOrNull(label?.[k]);let ok=v!==null&&v>=0;
    if(k==='kcal')ok=ok&&v<=1000;else ok=ok&&v<=100;
    out[k]=ok?v:null;
  }
  const carbs=known.carbs??out.carbs;if(out.sugar!==null&&carbs!==null&&out.sugar>carbs)out.sugar=null;
  const fat=known.fat??out.fat;if(out.saturatedFat!==null&&fat!==null&&out.saturatedFat>fat)out.saturatedFat=null;
  return out;
}
async function callOpenRouter(key,payload){
  return fetch(OPENROUTER_URL,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(process.env.OPENROUTER_SITE_URL?{'HTTP-Referer':process.env.OPENROUTER_SITE_URL}:{}),'X-Title':process.env.OPENROUTER_APP_NAME||'NutriChat'},body:JSON.stringify(payload)});
}
async function attempt(key,base,{jsonMode=true,maxTokens=3200,reasoning='none'}={}){
  const payload={...base,max_tokens:maxTokens};
  if(jsonMode){payload.response_format={type:'json_object'};payload.plugins=[{id:'response-healing'}];}
  if(reasoning)payload.reasoning={effort:reasoning,exclude:true};
  const response=await callOpenRouter(key,payload),data=await response.json().catch(()=>({}));
  return {response,data,parsed:response.ok?parseJsonLoose(data):null};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Metodo non consentito.'});}
  const key=process.env.OPENROUTER_API_KEY;if(!key)return res.status(503).json({error:'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'});
  const body=getBody(req),food=body.food||{},name=clean(food.name,180);if(!name)return res.status(400).json({error:'Nome alimento mancante.'});
  const basis=Number(food.servingGrams)>0?Number(food.servingGrams):100;
  const known={};for(const k of MACRO_KEYS)known[k]=finiteOrNull(food.label?.[k]);
  const incoming=(Array.isArray(body.requested)?body.requested:[]).slice(0,12);
  const requested=[],blocked=[];
  for(const x of incoming){
    const id=clean(x?.id,80),unit=clean(x?.unit,12),display=clean(x?.name,120);if(!id||!unit)continue;
    const item={id,unit,name:display};if(HARD_BLOCKED.has(id))blocked.push(item);else requested.push(item);
  }
  const existing=(Array.isArray(food.nutrients)?food.nutrients:[]).slice(0,160).map(n=>({id:clean(n.canonicalId||'',80),name:clean(n.name,100),amount:finiteOrNull(n.amount),unit:clean(n.unit,12),source:clean(n.source,100)})).filter(x=>x.amount!==null);
  const prompt={
    food:{name,brand:clean(food.brand,120),reference_basis_g:basis,known_label:known,known_nutrients:existing},
    requested_missing_nutrients:requested.map(x=>({id:x.id,name:x.name,required_unit:x.unit})),
    output_contract:{label:MACRO_KEYS,nutrients:'array of {id,status,value,confidence,note}; status estimated|not_available; confidence high|medium|low'}
  };
  const system=[
    'You are a conservative food-composition gap estimator used only after structured databases have missing fields.',
    'Return one JSON object only. Never use markdown.',
    'Never overwrite known values. Unknown is null, never numeric zero.',
    `All numeric values refer to exactly ${basis} g edible food and each requested nutrient MUST use the required_unit supplied by the caller.`,
    'For label return keys kcal,protein,carbs,sugar,fat,saturatedFat,fiber,salt; use null for known or undefensible values.',
    'For nutrients return exactly the requested ids when possible. status=estimated only with a defensible benchmark for the exact food/preparation; otherwise status=not_available and value=null.',
    'Do not guess IU conversions, percentages, fortification, geographic iodine/trace-mineral exposure, recipe formulation or brand composition.',
    'Do not derive amino acids by a fixed percentage of protein. An amino-acid estimate is allowed only when the exact/common food has a well-established composition benchmark.',
    'Do not derive EPA/DHA from total fat. Estimate fatty acids only when the exact food/species has a defensible typical composition.',
    'Precision must reflect uncertainty; do not manufacture excessive decimals.'
  ].join(' ');
  const base={model:process.env.OPENROUTER_MODEL||'openrouter/free',messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(prompt)}],temperature:0,stream:false};
  try{
    let a=await attempt(key,base,{jsonMode:true,maxTokens:3200,reasoning:'none'});
    if(!a.response.ok&&[400,404,422].includes(a.response.status))a=await attempt(key,base,{jsonMode:false,maxTokens:3600,reasoning:null});
    let finish=clean(a.data?.choices?.[0]?.finish_reason,80);
    if(a.response.ok&&!a.parsed&&(finish==='length'||!assistantText(a.data).trim()))a=await attempt(key,base,{jsonMode:true,maxTokens:5200,reasoning:'minimal'});
    if(a.response.ok&&!a.parsed)a=await attempt(key,base,{jsonMode:false,maxTokens:5200,reasoning:null});
    finish=clean(a.data?.choices?.[0]?.finish_reason,80);
    if(!a.response.ok)return res.status(502).json({error:a.data?.error?.message||`OpenRouter API ${a.response.status}`,model:a.data?.model||null});
    const parsed=a.parsed||parseJsonLoose(a.data);
    if(!parsed)return res.status(502).json({error:`Risposta AI non interpretabile come JSON strutturato. Modello: ${clean(a.data?.model,120)||'n/d'}${finish?` · fine: ${finish}`:''}.`,model:a.data?.model||null});

    const allowed=new Map(requested.map(x=>[x.id,x])),out=[];
    for(const n of Array.isArray(parsed.nutrients)?parsed.nutrients:[]){
      const spec=allowed.get(clean(n?.id,80));if(!spec)continue;
      const value=finiteOrNull(n.value),confidence=['high','medium','low'].includes(n.confidence)?n.confidence:'low',cap=CAPS[spec.id]??Infinity;
      const accepted=n.status==='estimated'&&['high','medium'].includes(confidence)&&value!==null&&value>0&&value<=cap;
      out.push({id:spec.id,status:accepted?'estimated':'not_available',value:accepted?value:null,confidence:accepted?confidence:'low',note:accepted?clean(n.note,280):(clean(n.note,280)||'N/D: il modello non ha una stima sufficientemente affidabile per questo alimento.')});
    }
    for(const x of requested)if(!out.some(n=>n.id===x.id))out.push({id:x.id,status:'not_available',value:null,confidence:'low',note:'N/D: nessuna stima numerica sufficientemente supportata.'});
    for(const x of blocked)out.push({id:x.id,status:'blocked_high_risk',value:null,confidence:'none',note:`Errore ${x.name||x.id}: nutriente ad alto rischio/variabilità; la stima numerica AI è disabilitata.`});
    return res.status(200).json({label:sanitizeLabel(parsed.label||{},known),nutrients:out,note:`AI fallback controllato via OpenRouter (${a.data?.model||process.env.OPENROUTER_MODEL||'openrouter/free'}). Le stime AI restano separate dai dati Master e non alimentano le carenze.`,model:a.data?.model||null,enricher_version:'2.3.0'});
  }catch(e){return res.status(502).json({error:`AI non disponibile: ${e?.message||'errore di rete'}`});}
};
