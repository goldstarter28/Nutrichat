'use strict';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const UNIT_KINDS = [
  'mass','natural_unit','dish','plate','bowl','serving',
  'slice_variable','piece_variable','volume','unknown'
];
const SIZES = ['small','medium','large','unspecified'];
const CONFIDENCES = ['none','low','medium','high'];

function getBody(req){
  if(!req.body) return {};
  if(typeof req.body === 'object') return req.body;
  try { return JSON.parse(req.body); } catch { return {}; }
}
function clean(v,max=500){ return String(v ?? '').trim().slice(0,max); }
function pos(v){ const n=Number(v); return Number.isFinite(n)&&n>0?n:null; }

function assistantText(data){
  const m=data?.choices?.[0]?.message;
  const c=m?.content;
  if(typeof c==='string') return c;
  if(Array.isArray(c)) return c.map(x=>typeof x==='string'?x:(x?.text||x?.content||'')).join('');
  if(c && typeof c==='object'){ try{return JSON.stringify(c)}catch{} }
  return '';
}
function parseJsonLoose(data){
  const direct=[data?.choices?.[0]?.message?.parsed,data?.parsed];
  for(const x of direct) if(x && typeof x==='object') return x;

  const raw=assistantText(data).trim();
  if(!raw) return null;

  const candidates=[raw];
  const unfenced=raw.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'').trim();
  if(unfenced!==raw) candidates.push(unfenced);
  const first=unfenced.indexOf('{'), last=unfenced.lastIndexOf('}');
  if(first>=0 && last>first) candidates.push(unfenced.slice(first,last+1));

  for(const s of candidates){
    try{
      const x=JSON.parse(s);
      if(x && typeof x==='object') return x;
    }catch{}
  }
  return null;
}
function normalizeIngredient(x={}){
  return {
    raw: clean(x.raw,300),
    name: clean(x.name,180),
    grams: pos(x.grams),
    quantity_text: clean(x.quantity_text,120),
    preparation: clean(x.preparation,100),
    ambiguity: x.ambiguity==='needs_detail'?'needs_detail':'none',
    ambiguity_reason: clean(x.ambiguity_reason,240),
    count: pos(x.count),
    size: SIZES.includes(x.size)?x.size:'unspecified',
    unit_kind: UNIT_KINDS.includes(x.unit_kind)?x.unit_kind:'unknown',
    estimated_piece_grams: pos(x.estimated_piece_grams),
    estimated_piece_min_g: pos(x.estimated_piece_min_g),
    estimated_piece_max_g: pos(x.estimated_piece_max_g),
    portion_confidence: CONFIDENCES.includes(x.portion_confidence)?x.portion_confidence:'none',
    portion_estimate_reason: clean(x.portion_estimate_reason,240)
  };
}

function systemPrompt(context){
  return [
    'Parse Italian food diary/search text into JSON only.',
    `Context=${context}.`,
    'Top-level keys exactly: mode, recipe_name, consumed_grams, final_recipe_weight_g, ingredients, errors.',
    'mode is "single" for one or more separate foods eaten/searched together, and "recipe" ONLY when ingredients compose one recipe/dish.',
    'A list such as "una banana due uova e un cetriolo" is mode="single" with 3 ingredients, NOT a recipe.',
    'Each ingredient keys: raw,name,grams,quantity_text,preparation,ambiguity,ambiguity_reason,count,size,unit_kind,estimated_piece_grams,estimated_piece_min_g,estimated_piece_max_g,portion_confidence,portion_estimate_reason.',
    'Unknown numeric=null, unknown text="".',
    'Never calculate nutrients.',
    'grams ONLY for explicit metric mass stated by user. Never put estimated piece mass in grams.',
    'Natural countable foods use unit_kind="natural_unit". Singular without count => count=1. Explicit count preserved.',
    'Natural unit without stated size => size="medium". piccolo/piccola=>small; grande=>large.',
    'Unqualified uovo/uova means ordinary whole chicken egg.',
    'For a natural unit you MAY estimate edible piece grams and min/max when useful. confidence high/medium/low/none according to real variability.',
    'Do not auto-weigh plate,dish,bowl,generic serving,pizza,steak,generic slice or highly variable pieces. Use the corresponding variable unit kind and null estimates.',
    'Dry vs cooked pasta/rice is material. Pasta shape usually is not. Generic meat is materially ambiguous.',
    'Preserve relevant preparation state.',
    'Missing weight is never an error in search. In quick/diary, natural units may omit explicit grams because app resolves portions later.',
    'For true recipes, ingredient quantities may be explicit grams or natural units; final_recipe_weight_g only if user explicitly states finished weight.',
    'consumed_grams only if user explicitly states consumed mass.',
    'Never infer brand, nutrient values, cooking loss, yield, or recipe ingredients.',
    'Return pure JSON with no markdown or commentary.'
  ].join(' ');
}

async function openrouter(key,payload){
  return fetch(OPENROUTER_URL,{
    method:'POST',
    headers:{
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/json',
      ...(process.env.OPENROUTER_SITE_URL?{'HTTP-Referer':process.env.OPENROUTER_SITE_URL}:{}),
      'X-Title':process.env.OPENROUTER_APP_NAME||'NutriTrace'
    },
    body:JSON.stringify(payload)
  });
}

async function runAttempt(key,base,{jsonMode=true,reasoningOff=true,maxTokens=1400}={}){
  const payload={...base,max_tokens:maxTokens};
  if(reasoningOff){
    payload.reasoning={effort:'none',exclude:true};
  }
  if(jsonMode){
    payload.response_format={type:'json_object'};
    payload.plugins=[{id:'response-healing'}];
  }
  const response=await openrouter(key,payload);
  const data=await response.json().catch(()=>({}));
  return {response,data,parsed:response.ok?parseJsonLoose(data):null};
}

module.exports = async function handler(req,res){
  res.setHeader('Cache-Control','no-store, max-age=0');
  res.setHeader('Content-Type','application/json; charset=utf-8');

  if(req.method!=='POST'){
    res.setHeader('Allow','POST');
    return res.status(405).json({error:'Metodo non consentito.'});
  }

  const key=process.env.OPENROUTER_API_KEY;
  if(!key) return res.status(503).json({error:'AI non configurata: manca OPENROUTER_API_KEY su Vercel.'});

  const body=getBody(req);
  const text=clean(body.text,3000);
  const context=['search','quick','diary','recipe'].includes(body.context)?body.context:'diary';
  if(!text) return res.status(400).json({error:'Testo mancante.'});

  const base={
    model:process.env.OPENROUTER_MODEL||'openrouter/free',
    messages:[
      {role:'system',content:systemPrompt(context)},
      {role:'user',content:text}
    ],
    temperature:0,
    stream:false
  };

  try{
    let attempt=await runAttempt(key,base,{jsonMode:true,reasoningOff:true,maxTokens:1400});

    // If model/provider rejects optional parameters, retry with plain prompt.
    if(!attempt.response.ok && [400,404,422].includes(attempt.response.status)){
      attempt=await runAttempt(key,base,{jsonMode:false,reasoningOff:false,maxTokens:1600});
    }

    // If free model consumed completion budget in reasoning / returned no usable content, retry.
    const finish=clean(attempt.data?.choices?.[0]?.finish_reason,80);
    if(attempt.response.ok && !attempt.parsed && (finish==='length' || !assistantText(attempt.data).trim())){
      attempt=await runAttempt(key,base,{jsonMode:false,reasoningOff:true,maxTokens:2200});
    }

    if(!attempt.response.ok){
      return res.status(502).json({
        error:attempt.data?.error?.message||`OpenRouter API ${attempt.response.status}`
      });
    }

    const parsed=attempt.parsed||parseJsonLoose(attempt.data);
    if(!parsed){
      const model=clean(attempt.data?.model,120);
      const finishReason=clean(attempt.data?.choices?.[0]?.finish_reason,80);
      const raw=clean(assistantText(attempt.data),240);
      return res.status(502).json({
        error:
          `Risposta AI non interpretabile${model?`. Modello: ${model}`:''}${finishReason?`. Fine: ${finishReason}`:''}.`+
          (raw?` Output: ${raw}`:' Nessun contenuto testuale ricevuto.')
      });
    }

    const ingredients=(Array.isArray(parsed.ingredients)?parsed.ingredients:[])
      .slice(0,30)
      .map(normalizeIngredient)
      .filter(x=>x.name);

    if(!ingredients.length){
      return res.status(502).json({
        error:'L’AI non ha restituito alcun alimento interpretabile. Riprova specificando gli alimenti.'
      });
    }

    const errors=(Array.isArray(parsed.errors)?parsed.errors:[])
      .map(x=>clean(x,300))
      .filter(Boolean)
      .slice(0,20);

    for(const ing of ingredients){
      if(ing.ambiguity==='needs_detail' && ing.ambiguity_reason &&
         !errors.some(e=>e.toLowerCase().includes(ing.name.toLowerCase()))){
        errors.push(`${ing.name}: ${ing.ambiguity_reason}`);
      }
    }

    // Important: multiple separate foods remain "single"; only a real composed recipe is "recipe".
    const mode=parsed.mode==='recipe'?'recipe':'single';

    return res.status(200).json({
      mode,
      recipe_name:clean(parsed.recipe_name,180)||(mode==='recipe'?'Ricetta':'Voce libera'),
      consumed_grams:pos(parsed.consumed_grams),
      final_recipe_weight_g:pos(parsed.final_recipe_weight_g),
      ingredients,
      errors,
      model:attempt.data?.model||process.env.OPENROUTER_MODEL||'openrouter/free'
    });
  }catch(e){
    return res.status(502).json({error:`AI non disponibile: ${e?.message||'errore di rete'}`});
  }
};
