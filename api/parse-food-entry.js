'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const UNIT_KINDS = ['mass','natural_unit','dish','plate','bowl','serving','slice_variable','piece_variable','volume','unknown'];
const SIZES = ['small','medium','large','unspecified'];
const CONFIDENCES = ['none','low','medium','high'];

function getBody(req){
  if(!req.body) return {};
  if(typeof req.body === 'object') return req.body;
  try{return JSON.parse(req.body)}catch{return {}};
}
function clean(v,max=500){return String(v??'').trim().slice(0,max)}
function pos(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:null}
function norm(v){return clean(v,1000).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim()}

function explicitMass(text){
  const s=String(text||'').toLowerCase().replace(/,/g,'.');
  const matches=[...s.matchAll(/(?:^|[^a-z0-9])([0-9]+(?:\.[0-9]+)?)\s*(kg|kilogrammi?|chilogrammi?|g|gr|grammi?|grammo)\b/gi)];
  if(!matches.length)return null;
  const m=matches[0];
  const n=Number(m[1]);
  if(!(n>0))return null;
  const unit=String(m[2]).toLowerCase();
  return unit.startsWith('k')||unit.startsWith('chilo')?n*1000:n;
}

function assistantText(data){
  const c=data?.choices?.[0]?.message?.content;
  if(typeof c==='string')return c;
  if(Array.isArray(c))return c.map(x=>typeof x==='string'?x:(x?.text||x?.content||'')).join('');
  if(c&&typeof c==='object'){try{return JSON.stringify(c)}catch{}}
  return '';
}
function parseJsonLoose(data){
  for(const x of [data?.choices?.[0]?.message?.parsed,data?.parsed]) if(x&&typeof x==='object')return x;
  const raw=assistantText(data).trim(); if(!raw)return null;
  const candidates=[raw];
  const unfenced=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
  if(unfenced!==raw)candidates.push(unfenced);
  const first=unfenced.indexOf('{'),last=unfenced.lastIndexOf('}');
  if(first>=0&&last>first)candidates.push(unfenced.slice(first,last+1));
  for(const s of candidates){try{const x=JSON.parse(s);if(x&&typeof x==='object')return x}catch{}}
  return null;
}
function normalizePreparation(v){const s=clean(v,100);return ['none','null','n/a','na','unspecified','non specificato'].includes(norm(s))?'':s}
function normalizeIngredient(x={}){
  const raw=clean(x.raw,300);
  const qty=clean(x.quantity_text,120);
  // V2.2 safety invariant: AI never decides whether an article/count is grams.
  // Only an actual mass expression in the ingredient's own raw/quantity text can populate grams.
  const grams=explicitMass(`${raw} ${qty}`);
  return {
    raw,
    name:clean(x.name,180),
    lookup_name_en:clean(x.lookup_name_en,180),
    grams,
    quantity_text:qty,
    preparation:normalizePreparation(x.preparation),
    ambiguity:x.ambiguity==='needs_detail'?'needs_detail':'none',
    ambiguity_reason:clean(x.ambiguity_reason,240),
    count:pos(x.count),
    size:SIZES.includes(x.size)?x.size:'unspecified',
    unit_kind:UNIT_KINDS.includes(x.unit_kind)?x.unit_kind:'unknown',
    estimated_piece_grams:pos(x.estimated_piece_grams),
    estimated_piece_min_g:pos(x.estimated_piece_min_g),
    estimated_piece_max_g:pos(x.estimated_piece_max_g),
    portion_confidence:CONFIDENCES.includes(x.portion_confidence)?x.portion_confidence:'none',
    portion_estimate_reason:clean(x.portion_estimate_reason,240)
  };
}

function systemPrompt(context){
  return [
    'Parse Italian food diary/search text. Return JSON only, no markdown.',
    `Context=${context}.`,
    'Top keys: mode, recipe_name, consumed_grams, final_recipe_weight_g, ingredients, errors.',
    'mode is single for one food, multi for a list of separate foods, recipe ONLY when the foods are ingredients of one composed recipe/dish.',
    'Example: "una banana, due uova e un cetriolo" => mode=multi and 3 ingredients. It is NOT a recipe.',
    'Each ingredient keys: raw,name,lookup_name_en,grams,quantity_text,preparation,ambiguity,ambiguity_reason,count,size,unit_kind,estimated_piece_grams,estimated_piece_min_g,estimated_piece_max_g,portion_confidence,portion_estimate_reason.',
    'raw must preserve the ingredient-specific phrase including its quantity, e.g. "un mandarino di 50 g".',
    'name is a concise Italian food identity. lookup_name_en is the concise English equivalent for database/portion matching.',
    'Unknown numeric=null; unknown text="".',
    'NEVER calculate nutrients.',
    'grams is ONLY for an explicitly written metric mass (g/kg). Articles and counts are NEVER grams.',
    'Examples: "una banana" => count=1, grams=null. "banana" => count=1, grams=null. "2 banane" => count=2, grams=null. "banana 90 g" => count=1, grams=90.',
    'Natural countable foods use unit_kind=natural_unit. Singular/article without explicit count => count=1. Preserve explicit count.',
    'For natural units, omitted size => medium; piccolo/piccola=>small; grande=>large.',
    'Unqualified uovo/uova means ordinary whole chicken egg.',
    'For natural units you MAY estimate edible piece weight and min/max only when meaningful. This is portion weight, never nutrient data.',
    'Use confidence high only for relatively standardized units, medium for useful averages with normal biological variation, low for weak averages, none when not meaningful.',
    'Do not invent weights for plate,dish,bowl,generic serving,pizza,steak,generic slice or highly variable pieces.',
    'Dry vs cooked pasta/rice materially changes identity; pasta shape normally does not. Generic meat is materially ambiguous.',
    'Preserve relevant preparation state. Ask detail only when nutritionally material.',
    'Missing weight is never an error in search. In quick/diary natural units can be resolved later by the app.',
    'For a true recipe, final_recipe_weight_g and consumed_grams are only explicit masses stated by the user.',
    'Never infer brand, recipe formulation, cooking loss, yield or nutrient values.'
  ].join(' ');
}

async function openrouter(key,payload){
  return fetch(OPENROUTER_URL,{method:'POST',headers:{
    Authorization:`Bearer ${key}`,'Content-Type':'application/json',
    ...(process.env.OPENROUTER_SITE_URL?{'HTTP-Referer':process.env.OPENROUTER_SITE_URL}:{}),
    'X-Title':process.env.OPENROUTER_APP_NAME||'NutriChat'
  },body:JSON.stringify(payload)});
}
async function attempt(key,base,{jsonMode=true,reasoning='none',maxTokens=1800}={}){
  const payload={...base,max_tokens:maxTokens};
  if(reasoning)payload.reasoning={effort:reasoning,exclude:true};
  if(jsonMode){payload.response_format={type:'json_object'};payload.plugins=[{id:'response-healing'}];}
  const response=await openrouter(key,payload);
  const data=await response.json().catch(()=>({}));
  return {response,data,parsed:response.ok?parseJsonLoose(data):null};
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Metodo non consentito.'});}
  const key=process.env.OPENROUTER_API_KEY;
  if(!key)return res.status(503).json({error:'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'});
  const body=getBody(req),text=clean(body.text,3000);
  const context=['search','quick','diary','recipe'].includes(body.context)?body.context:'diary';
  if(!text)return res.status(400).json({error:'Testo mancante.'});

  const base={model:process.env.OPENROUTER_MODEL||'openrouter/free',messages:[{role:'system',content:systemPrompt(context)},{role:'user',content:text}],temperature:0,stream:false};
  try{
    let a=await attempt(key,base,{jsonMode:true,reasoning:'none',maxTokens:1800});
    // Optional parameters may be rejected by some free providers.
    if(!a.response.ok&&[400,404,422].includes(a.response.status))a=await attempt(key,base,{jsonMode:false,reasoning:null,maxTokens:2200});
    // A free reasoning model can consume the first output budget before emitting content.
    const finish=clean(a.data?.choices?.[0]?.finish_reason,80);
    if(a.response.ok&&!a.parsed&&(finish==='length'||!assistantText(a.data).trim()))a=await attempt(key,base,{jsonMode:true,reasoning:'minimal',maxTokens:4200});
    if(!a.response.ok)return res.status(502).json({error:a.data?.error?.message||`OpenRouter API ${a.response.status}`});
    const parsed=a.parsed||parseJsonLoose(a.data);
    if(!parsed){
      const model=clean(a.data?.model,120),reason=clean(a.data?.choices?.[0]?.finish_reason,80),raw=clean(assistantText(a.data),220);
      return res.status(502).json({error:`Risposta AI non interpretabile${model?`. Modello: ${model}`:''}${reason?`. Fine: ${reason}`:''}.${raw?` Output: ${raw}`:' Nessun contenuto testuale ricevuto.'}`});
    }
    const ingredients=(Array.isArray(parsed.ingredients)?parsed.ingredients:[]).slice(0,30).map(normalizeIngredient).filter(x=>x.name||x.lookup_name_en);
    if(!ingredients.length)return res.status(502).json({error:'L’AI non ha restituito alcun alimento interpretabile. Riprova specificando gli alimenti.'});
    const errors=(Array.isArray(parsed.errors)?parsed.errors:[]).map(x=>clean(x,300)).filter(Boolean).slice(0,20);
    for(const ing of ingredients)if(ing.ambiguity==='needs_detail'&&ing.ambiguity_reason&&!errors.some(e=>norm(e).includes(norm(ing.name))))errors.push(`${ing.name}: ${ing.ambiguity_reason}`);
    let mode=['single','multi','recipe'].includes(parsed.mode)?parsed.mode:(ingredients.length>1?'multi':'single');
    if(mode==='single'&&ingredients.length>1)mode='multi';
    return res.status(200).json({
      mode,
      recipe_name:clean(parsed.recipe_name,180)||(mode==='recipe'?'Ricetta':mode==='multi'?'Lista di alimenti':'Voce libera'),
      consumed_grams:pos(parsed.consumed_grams),
      final_recipe_weight_g:pos(parsed.final_recipe_weight_g),
      ingredients,errors,
      model:a.data?.model||process.env.OPENROUTER_MODEL||'openrouter/free',
      parser_version:'2.2.0'
    });
  }catch(e){return res.status(502).json({error:`AI non disponibile: ${e?.message||'errore di rete'}`});}
};
