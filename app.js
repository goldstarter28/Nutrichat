const { useEffect, useMemo, useState } = React;
const SOURCE_META = {
    MASTER: { name: 'NutriTrace Master Food DB', version: 'v1', mode: 'bundled', official: true, scientific: true },
    CIQUAL: { name: 'ANSES-CIQUAL', version: '2025', mode: 'local', official: true, scientific: true },
    FRIDA: { name: 'FRIDA / DTU Food Institute', version: '5.5 (2025)', mode: 'local', official: true, scientific: true },
    COFID: { name: 'UK CoFID', version: '2021', mode: 'local', official: true, scientific: true }
};
const clean = s => String(s ?? '').trim();
const norm = s => clean(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[µμ]/g, 'u').replace(/[^a-z0-9]+/g, ' ').trim();
function num(v) {
    if (v === null || v === undefined || v === '')
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? v : null;
    let s = String(v).trim().replace(',', '.');
    if (!s || /^(tr|trace|n|nd|na|-)$/i.test(s))
        return null;
    s = s.replace(/^</, '').replace(/[^0-9.+-]/g, '');
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
}
// Espansioni volutamente semplici: aiutano la ricerca in italiano nei dataset EN/FR/DK.
// Dopo il primo utilizzo l'alias italiano viene salvato nell'archivio personale, quindi non serve più tradurre.
const IT_SYNONYMS = {
    pasta:['pasta','spaghetti','macaroni','noodle','noodles','pates'], petto:['breast'], coscia:['thigh'],
    integrale:['whole wheat','wholewheat','whole grain','wholegrain','wholemeal','complet','complete','complets','completes'],
    riso:['rice','riz','ris'], pollo:['chicken','poulet','kylling'], tacchino:['turkey','dinde','kalkun'],
    salmone:['salmon','saumon','laks'], tonno:['tuna','thon','tun'], merluzzo:['cod','cabillaud','torsk'],
    mela:['apple','pomme','aeble'], mele:['apples'], pera:['pear','poire','paere'], pere:['pears'], banana:['banana','banane','bananas'],
    arancia:['orange'], arance:['oranges'], mandarino:['mandarin','tangerine','clementine'], mandarini:['mandarins','tangerines','clementines'],
    pesca:['peach'], pesche:['peaches'], nettarina:['nectarine'], nettarine:['nectarines'], albicocca:['apricot'], albicocche:['apricots'],
    prugna:['plum'], prugne:['plums'], kiwi:['kiwi','kiwifruit'], mango:['mango'], limone:['lemon'], limoni:['lemons'], lime:['lime'],
    pompelmo:['grapefruit'], pompelmi:['grapefruits'], melone:['melon','cantaloupe'], meloni:['melons','cantaloupes'],
    fragola:['strawberry','fraise','jordbaer'], fragole:['strawberries'], mirtillo:['blueberry'], mirtilli:['blueberry','blueberries','myrtille'],
    uovo:['egg','oeuf','aeg'], uova:['eggs','oeufs','aeg'], latte:['milk','lait','maelk'], yogurt:['yogurt','yoghurt','yaourt'],
    formaggio:['cheese','fromage','ost'], pane:['bread','pain','brod'], avena:['oat','oats','avoine','havre'], farro:['farro','spelt','épeautre'],
    lenticchie:['lentil','lentils','lentille','linser'], ceci:['chickpea','chickpeas','pois chiche','kikært'], fagioli:['bean','beans','haricot','bonner'],
    patata:['potato','pomme de terre','kartoffel'], patate:['potatoes','pommes de terre','kartofler'],
    pomodoro:['tomato','tomate'], pomodori:['tomatoes','tomates'], cetriolo:['cucumber','concombre'], cetrioli:['cucumbers','concombres'],
    carota:['carrot','carotte','gulerod'], carote:['carrots'], zucchina:['zucchini','courgette','squash'], zucchine:['zucchini','courgettes'],
    broccolo:['broccoli'], broccoli:['broccoli'], spinacio:['spinach'], spinaci:['spinach','epinard','spinat'],
    lattuga:['lettuce'], sedano:['celery'], peperone:['pepper','bell pepper'], peperoni:['peppers','bell peppers'],
    cipolla:['onion'], cipolle:['onions'], aglio:['garlic'], fungo:['mushroom'], funghi:['mushrooms'],
    ravanello:['radish'], ravanelli:['radishes'], barbabietola:['beet','beetroot'], barbabietole:['beets','beetroots'],
    carciofo:['artichoke'], carciofi:['artichokes'], asparago:['asparagus'], asparagi:['asparagus'], avocado:['avocado','avocados'],
    mandorle:['almond','almonds','amande','mandler'], noci:['walnut','walnuts','noix','valnod'], arachidi:['peanut','peanuts','cacahuete','jordnod'],
    oliva:['olive'], olive:['olives'], olio:['oil','huile','olie'],
    manzo:['beef','boeuf','okse'], maiale:['pork','porc','svin'], crudo:['raw','cru'], cotto:['cooked','boiled','cuit'],
    bollito:['boiled','cooked','bouilli'], grigliato:['grilled','grille'], secco:['dry','dried','sec']
};
function queryTokens(q){
    const stop=new Set(['di','del','della','dei','degli','delle','a','al','alla','con','senza','e','ed','o','un','uno','una','il','lo','la','i','gli','le','da','circa','medio','media','medie','medi','piccolo','piccola','piccoli','piccole','grande','grandi','pezzo','pezzi']);
    return norm(q).split(' ').filter(x=>x&&!stop.has(x)&&!/^\d+(?:[.,]\d+)?$/.test(x)&&!['g','gr','grammi','grammo','kg','chilogrammi','chilogrammo'].includes(x));
}
function tokenAlternatives(token){
    const t=norm(token),out=new Set(t?[t]:[]);
    for(const [key,values] of Object.entries(IT_SYNONYMS)){
        const group=[key,...(values||[])].map(norm).filter(Boolean);
        if(group.includes(t))for(const x of group)out.add(x);
    }
    return [...out];
}
// Phrase/token matching is boundary-aware: e.g. Italian “pollo” must not match English “pollock”.
function hasTerm(text, term) { const t=norm(text), q=norm(term); return Boolean(q) && (t===q || t.startsWith(`${q} `) || t.endsWith(` ${q}`) || t.includes(` ${q} `)); }
function candidateLexicalEvidence(query,candidate){
    const tokens=queryTokens(query);
    if(!tokens.length)return false;
    const text=norm(`${candidate?.name||''} ${candidate?.officialName||''} ${candidate?.name_en||''} ${(candidate?.aliases||[]).join(' ')}`);
    return tokens.some(token=>tokenAlternatives(token).some(alt=>hasTerm(text,alt)));
}
function candidateExactSemanticMatch(query,candidate){
    const q=norm(query); if(!q)return false;
    const names=[candidate?.name,candidate?.officialName,candidate?.name_en,...(candidate?.aliases||[])].map(norm).filter(Boolean);
    if(names.includes(q))return true;
    const qt=queryTokens(query);
    if(qt.length!==1)return false;
    return tokenAlternatives(qt[0]).some(alt=>names.some(name=>name===alt));
}
function semanticLookupQueries(ingredient){
    const ing=typeof ingredient==='string'?{name:ingredient}:ingredient||{};
    return [ing.lookup_name_en,...(ing.search_terms_en||[]),ing.name,...(ing.broader_terms_en||[])]
      .map(clean).filter(Boolean).filter((x,i,a)=>a.findIndex(y=>norm(y)===norm(x))===i).slice(0,20);
}
function candidateSemanticGate(ingredient,candidate,matchedQuery=''){
    const ing=typeof ingredient==='string'?{name:ingredient}:ingredient||{};
    const text=norm(`${candidate?.name||''} ${candidate?.officialName||''} ${candidate?.name_en||''} ${(candidate?.aliases||[]).join(' ')}`);
    if(!text)return false;
    const must=(ing.must_terms_en||[]).map(norm).filter(Boolean), exclude=(ing.exclude_terms_en||[]).map(norm).filter(Boolean);
    if(exclude.some(t=>hasTerm(text,t)))return false;
    // A must-list is interpreted as semantic evidence, not as a requirement that every adjective be present.
    if(must.length&&!must.some(t=>hasTerm(text,t)))return false;
    const queries=semanticLookupQueries(ing);
    return queries.some(q=>candidateLexicalEvidence(q,candidate)||candidateExactSemanticMatch(q,candidate)) ||
      Boolean(matchedQuery&&candidateLexicalEvidence(matchedQuery,candidate));
}
function phraseAlternatives(q) {
    const n = norm(q);
    const out = [n];
    if (n === 'pasta integrale')
        out.push('whole wheat pasta', 'wholemeal pasta', 'pates completes', 'whole grain pasta');
    if (n === 'riso integrale')
        out.push('brown rice', 'whole grain rice', 'riz complet');
    if (n === 'pane integrale')
        out.push('whole wheat bread', 'wholemeal bread', 'pain complet');
    return out;
}
const FIELD_ALIASES = {
    kcal: ['energy kcal', 'energie kcal', 'energia kcal', 'energy kcal 100g', 'energy kcal per 100g', 'kcal'],
    protein: ['protein', 'proteins', 'proteines', 'proteine', 'protein g', 'protein g 100g'],
    carbs: ['carbohydrate', 'carbohydrates', 'available carbohydrates', 'available_carbohydrates', 'glucides', 'carboidrati', 'carboidrati disponibili', 'carbohydrate g'],
    sugar: ['sugars', 'sum sugars', 'soluble sugars', 'soluble_sugars', 'sucres', 'zuccheri', 'zuccheri solubili', 'total sugars'],
    fat: ['fat', 'lipid', 'lipids', 'lipides', 'grassi', 'total fat'],
    saturatedFat: ['saturates', 'saturated fatty acids', 'saturated fat', 'acides gras satures', 'grassi saturi'],
    fiber: ['fibre', 'fiber', 'total fiber', 'total_fiber', 'fibra totale', 'dietary fibre', 'fibres alimentaires', 'fibre alimentaire'],
    salt: ['salt', 'sel chlorure de sodium', 'sale'], sodium: ['sodium', 'sodio'],
};
const NUTRIENT_ALIASES = {
    'Calcio': ['calcium', 'calcio'], 'Ferro': ['iron', 'fer', 'ferro'], 'Magnesio': ['magnesium', 'magnesio'],
    'Potassio': ['potassium', 'potassio'], 'Zinco': ['zinc', 'zinco'], 'Rame': ['copper', 'cuivre', 'rame'],
    'Manganese': ['manganese'], 'Selenio': ['selenium', 'selenio'], 'Iodio': ['iodine', 'iode', 'iodio'],
    'Fosforo': ['phosphorus', 'phosphore', 'fosforo'], 'Vitamina C': ['vitamin c', 'vitamine c', 'vitamina c'],
    'Vitamina D': ['vitamin d', 'vitamine d', 'vitamina d'], 'Vitamina E': ['vitamin e', 'vitamine e', 'vitamina e'],
    'Tiamina B1': ['thiamin', 'thiamine', 'vitamine b1', 'tiamina'], 'Riboflavina B2': ['riboflavin', 'riboflavine', 'vitamine b2'],
    'Niacina B3': ['niacin', 'niacine', 'vitamine b3'], 'Vitamina B6': ['vitamin b6', 'vitamine b6'],
    'Folati': ['folate', 'folates', 'folates totaux', 'vitamin b9', 'vitamine b9'], 'Acido folico': ['folic acid', 'acide folique'],
    'Vitamina B12': ['vitamin b12', 'vitamine b12'], 'Vitamina K': ['vitamin k', 'vitamine k'],
    'ALA': ['alpha linolenic', 'alpha linolenique', '18 3 n 3', 'c18 3 n 3'], 'EPA': ['eicosapentaenoic', '20 5 n 3', 'c20 5 n 3'],
    'DHA': ['docosahexaenoic', '22 6 n 3', 'c22 6 n 3'], 'Acido linoleico (LA)': ['linoleic acid', '18 2 n 6', 'c18 2 n 6'],
    'Colesterolo': ['cholesterol'],
    'Leucina': ['leucine'], 'Isoleucina': ['isoleucine'], 'Valina': ['valine'], 'Lisina': ['lysine'], 'Metionina': ['methionine'],
    'Treonina': ['threonine'], 'Triptofano': ['tryptophan'], 'Istidina': ['histidine'], 'Fenilalanina': ['phenylalanine'],
    'Fruttosio': ['fructose'], 'Glucosio': ['glucose'], 'Galattosio': ['galactose'], 'Lattosio': ['lactose'], 'Saccarosio': ['sucrose'],
    'Sodio': ['sodium', 'sodio'], 'Cloruro': ['chloride', 'chlorine', 'cloro', 'cloruro'], 'Cromo': ['chromium', 'cromo'],
    'Molibdeno': ['molybdenum', 'molibdeno'], 'Nickel': ['nickel'], 'Fluoro': ['fluoride', 'fluorine', 'fluoro'], 'Zolfo': ['sulfur', 'sulphur', 'zolfo'],
    'Vitamina A': ['vitamin a', 'vitamina a', 'retinol equivalent', 'retinolo equivalente'],
    'Acido pantotenico B5': ['pantothenic acid', 'acido pantotenico'], 'Biotina B7': ['biotin', 'biotina'],
    'Colina': ['choline', 'colina'], 'Acido arachidonico (AA)': ['arachidonic acid', 'acido arachidonico', '20 4 n 6'],
};
function matchesHeader(header, aliases) { const h = norm(header); return aliases.some(a => h === norm(a) || h.includes(norm(a))); }
function unitFromHeader(h, fallback = 'mg') { const n = norm(h); if (/\b(kcal)\b/.test(n))
    return 'kcal'; if (/\b(ug|mcg)\b/.test(n))
    return 'µg'; if (/\bmg\b/.test(n))
    return 'mg'; if (/\bg\b/.test(n))
    return 'g'; return fallback; }
function findNameKey(keys) { const candidates = ['alim nom fr', 'food name', 'foodname', 'food name english', 'name', 'description', 'food', 'foedevare navn', 'fødevare navn']; return keys.find(k => candidates.some(c => norm(k) === norm(c))) || keys.find(k => /(food|aliment|alim|fødevare).*(name|nom|navn)|description/.test(norm(k))); }
function findIdKey(keys) { return keys.find(k => /(food id|foodid|alim code|code alim|id food|food code|fdc id|fdc_id)/.test(norm(k))) || null; }
function findBrandKey(keys) { return keys.find(k => /(brand|marque|marca)/.test(norm(k))) || null; }
function sourceRef(source, id) { return `${SOURCE_META[source]?.name || source}${id ? ` · ${id}` : ''}`; }
function newId() { return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`; }
function emptyLabel() { return { kcal: '', protein: '', carbs: '', sugar: '', fat: '', saturatedFat: '', fiber: '', salt: '' }; }
function normalizeWideRows(source, rows) {
    if (!rows?.length)
        return [];
    const keys = Object.keys(rows.find(r => r && Object.keys(r).length) || {});
    const nameKey = findNameKey(keys);
    const idKey = findIdKey(keys);
    const brandKey = findBrandKey(keys);
    if (!nameKey)
        return [];
    const out = [];
    for (const r of rows) {
        const name = clean(r[nameKey]);
        if (!name)
            continue;
        const label = emptyLabel();
        const nutrients = [];
        for (const [key, val] of Object.entries(r)) {
            const v = num(val);
            if (v === null)
                continue;
            for (const [field, aliases] of Object.entries(FIELD_ALIASES))
                if (matchesHeader(key, aliases)) {
                    if (field === 'sodium') {
                        if (label.salt === '')
                            label.salt = v * 2.5 / (unitFromHeader(key) === 'mg' ? 1000 : 1);
                    }
                    else if (label[field] === '')
                        label[field] = v;
                }
            for (const [display, aliases] of Object.entries(NUTRIENT_ALIASES))
                if (matchesHeader(key, aliases)) {
                    nutrients.push({ id: newId(), name: display, form: 'naturalmente presente / non specificata', amount: v, unit: unitFromHeader(key, ['Folati', 'Vitamina B12', 'Vitamina D', 'Iodio'].includes(display) ? 'µg' : 'mg'), source: SOURCE_META[source].name, evidence: 'dataset ufficiale', bio: { mode: 'none' } });
                    break;
                }
        }
        out.push({ localId: `${source}:${clean(r[idKey]) || out.length + 1}`, source, sourceId: clean(r[idKey]) || String(out.length + 1), name, officialName: name, brand: brandKey ? clean(r[brandKey]) : '', servingGrams: 100, label, nutrients, ingredients: '', aliases: [], sourceInfo: { id: newId(), name: SOURCE_META[source].name, reference: sourceRef(source, clean(r[idKey])), quality: 'primaria', version: SOURCE_META[source].version } });
    }
    return out;
}
function normalizeLongRows(source, rows) {
    if (!rows?.length)
        return [];
    const keys = Object.keys(rows.find(r => r && Object.keys(r).length) || {});
    const idKey = findIdKey(keys);
    const nameKey = findNameKey(keys);
    const paramKey = keys.find(k => /(parameter name|parameter|component|nutrient)/.test(norm(k)));
    const valueKey = keys.find(k => /^(value|amount|content)$/.test(norm(k))) || keys.find(k => /(value|amount|content)/.test(norm(k)));
    const unitKey = keys.find(k => /^unit$/.test(norm(k)) || /unit/.test(norm(k)));
    if (!nameKey || !paramKey || !valueKey)
        return [];
    const grouped = new Map();
    for (const r of rows) {
        const id = clean(idKey ? r[idKey] : r[nameKey]);
        const name = clean(r[nameKey]);
        if (!name)
            continue;
        if (!grouped.has(id))
            grouped.set(id, { id, name, rows: [] });
        grouped.get(id).rows.push(r);
    }
    const out = [];
    for (const g of grouped.values()) {
        const label = emptyLabel();
        const nutrients = [];
        for (const r of g.rows) {
            const p = clean(r[paramKey]);
            const v = num(r[valueKey]);
            if (v === null)
                continue;
            const rawUnit=clean(unitKey ? r[unitKey] : ''); const unit = rawUnit ? (rawUnit.replace(/μ/g,'µ').replace(/^ug$/i,'µg').replace(/^mcg$/i,'µg')) : unitFromHeader(p);
            for (const [field, aliases] of Object.entries(FIELD_ALIASES))
                if (matchesHeader(p, aliases)) {
                    if (field === 'sodium') {
                        if (label.salt === '')
                            label.salt = v * 2.5 / (unit.toLowerCase() === 'mg' ? 1000 : 1);
                    }
                    else if (label[field] === '')
                        label[field] = v;
                }
            for (const [display, aliases] of Object.entries(NUTRIENT_ALIASES))
                if (matchesHeader(p, aliases)) {
                    nutrients.push({ id: newId(), name: display, form: 'naturalmente presente / non specificata', amount: v, unit: unit.replace(/ug/i, 'µg'), source: SOURCE_META[source].name, evidence: 'dataset ufficiale', bio: { mode: 'none' } });
                    break;
                }
        }
        out.push({ localId: `${source}:${g.id}`, source, sourceId: g.id, name: g.name, officialName: g.name, brand: '', servingGrams: 100, label, nutrients, ingredients: '', aliases: [], sourceInfo: { id: newId(), name: SOURCE_META[source].name, reference: sourceRef(source, g.id), quality: 'primaria', version: SOURCE_META[source].version } });
    }
    return out;
}
function normalizeRows(source, rows) { const keys = Object.keys(rows?.[0] || {}); const longish = keys.some(k => /(parameter|component|nutrient)/.test(norm(k))) && keys.some(k => /(value|amount|content)/.test(norm(k))); return longish ? normalizeLongRows(source, rows) : normalizeWideRows(source, rows); }
function scoreFood(q, f) {
    const name = norm(`${f.name || ''} ${f.officialName || ''}`), brand = norm(f.brand), aliases = (f.aliases || []).map(norm);
    if (!norm(q))
        return 0;
    let s = 0;
    for (const p of phraseAlternatives(q)) {
        if (name === p)
            s = Math.max(s, 120);
        else if (name.startsWith(`${p} `))
            s = Math.max(s, 65);
        else if (hasTerm(name,p))
            s = Math.max(s, 48);
        if (aliases.some(a=>a===p))
            s = Math.max(s, 150);
    }
    for (const token of queryTokens(q)) {
        const alts = tokenAlternatives(token);
        if (alts.some(a => hasTerm(name,a)))
            s += 14;
        else
            s -= 4;
        if (alts.some(a => aliases.some(x => hasTerm(x,a))))
            s += 25;
    }
    if (brand && norm(q) === brand)
        s += 8;
    return Math.max(0, s);
}
function searchLocalDataset(q, datasets, limit = 12) { const all = []; for (const [source, foods] of Object.entries(datasets || {}))
    for (const f of foods || []) {
        const score = scoreFood(q, f);
        if (score > 0)
            all.push({ ...f, score, source });
    } return all.sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name))).slice(0, limit); }
function searchPersonalFoods(q, foods, limit = 8) { return (foods || []).map(f => ({ ...f, score: scoreFood(q, f), resultType: 'personal' })).filter(f => f.score > 0).sort((a, b) => b.score - a.score).slice(0, limit); }
const BASE_GOALS = [
    { id: 'kcal', name: 'Energia', unit: 'kcal', target: 2400, period: 'day', kind: 'target' },
    { id: 'protein', name: 'Proteine', unit: 'g', target: 160, period: 'day', kind: 'target' },
    { id: 'carbs', name: 'Carboidrati', unit: 'g', target: 260, period: 'day', kind: 'target' },
    { id: 'fat', name: 'Grassi', unit: 'g', target: 75, period: 'day', kind: 'target' },
    { id: 'fiber', name: 'Fibre', unit: 'g', target: 35, period: 'day', kind: 'minimum' },
    { id: 'Magnesio', name: 'Magnesio', form: '*', unit: 'mg', target: 400, period: 'day', kind: 'minimum' },
    { id: 'Ferro', name: 'Ferro', form: '*', unit: 'mg', target: 10, period: 'day', kind: 'minimum' },
    { id: 'Calcio', name: 'Calcio', form: '*', unit: 'mg', target: 1000, period: 'day', kind: 'minimum' },
    { id: 'Potassio', name: 'Potassio', form: '*', unit: 'mg', target: 3500, period: 'day', kind: 'minimum' },
    { id: 'Zinco', name: 'Zinco', form: '*', unit: 'mg', target: 11, period: 'day', kind: 'minimum' },
    { id: 'EPA', name: 'EPA', form: '*', unit: 'mg', target: 1750, period: 'week', kind: 'minimum' },
    { id: 'DHA', name: 'DHA', form: '*', unit: 'mg', target: 1750, period: 'week', kind: 'minimum' }
];
const MACROS = { kcal: 'Calorie (kcal)', protein: 'Proteine (g)', carbs: 'Carboidrati (g)', sugar: 'Zuccheri (g)', fat: 'Grassi (g)', saturatedFat: 'Saturi (g)', fiber: 'Fibre (g)', salt: 'Sale (g)' };
const EAA = ['Leucina', 'Isoleucina', 'Valina', 'Lisina', 'Metionina', 'Treonina', 'Triptofano', 'Istidina', 'Fenilalanina'];
const emptyFood = () => ({ id: crypto.randomUUID(), name: '', brand: '', servingGrams: 100, label: Object.fromEntries(Object.keys(MACROS).map(k => [k, ''])), ingredients: '', additives: [], nutrients: [], nutrientStatus: {}, sources: [], notes: '', mergeMeta: null, masterId: null, masterVersion: null, aiRequested: [] });
const emptyNutrient = () => ({ id: crypto.randomUUID(), name: '', form: '', amount: '', unit: 'mg', source: 'Etichetta', evidence: 'dichiarato', elementalAmount: '', bio: { mode: 'none', min: '', max: '', source: '' } });
const fmt = (n, d = 1) => Number(n || 0).toLocaleString('it-IT', { maximumFractionDigits: d });
const fmtMaybe = (n, d = 1) => isMissing(n) ? 'N/D' : Number(n).toLocaleString('it-IT', { maximumFractionDigits: d });
const dateKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const startOfWeek = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); d.setHours(0, 0, 0, 0); return d; };
const parseAdditives = t => [...new Set((String(t).toUpperCase().match(/\bE\s?\d{3,4}[A-Z]?\b/g) || []).map(x => x.replace(/\s/g, '')))];
const unitFactor = u => u === 'g' ? 1000 : u === 'µg' ? 0.001 : u === 'mg' ? 1 : 1;
const convert = (v, from, to) => Number(v || 0) * unitFactor(from) / unitFactor(to);
function aggregate(logs, foods) {
    const o = { kcal: 0, protein: 0, carbs: 0, sugar: 0, fat: 0, saturatedFat: 0, fiber: 0, salt: 0, nutrients: {} };
    for (const l of logs) {
        const f = foods.find(x => x.id === l.foodId);
        if (!f)
            continue;
        const q = Number(l.grams) / (Number(f.servingGrams) || 100);
        for (const k of Object.keys(MACROS))
            o[k] += (Number(f.label?.[k]) || 0) * q;
        for (const n of f.nutrients || []) {
            const key = `${n.name}|${n.form || 'non specificata'}|${n.unit}`;
            if (!o.nutrients[key])
                o.nutrients[key] = { amount: 0, absorbedMin: 0, absorbedMax: 0, hasBio: false, sources: new Set() };
            const z = o.nutrients[key];
            z.amount += (Number(n.amount) || 0) * q;
            z.sources.add(n.source || 'non specificata');
            const elemental = n.elementalAmount !== '' && n.elementalAmount != null ? Number(n.elementalAmount) : Number(n.amount) || 0;
            const b = n.bio || {};
            if (b.mode === 'fixed' || b.mode === 'range') {
                const min = Number(b.min) || 0, max = Number(b.max || b.min) || 0;
                z.absorbedMin += elemental * q * min / 100;
                z.absorbedMax += elemental * q * max / 100;
                z.hasBio = true;
            }
        }
    }
    return o;
}
function nutrientTotal(ag, name, toUnit = 'mg', form = '*') { let sum = 0; for (const [k, v] of Object.entries(ag.nutrients)) {
    const [n, f, u] = k.split('|');
    if (n.toLowerCase() === name.toLowerCase() && (form === '*' || !form || f.toLowerCase() === form.toLowerCase()))
        sum += convert(v.amount, u, toUnit);
} return sum; }
function absorbedTotal(ag, name, toUnit = 'mg') { let min = 0, max = 0, has = false; for (const [k, v] of Object.entries(ag.nutrients)) {
    const [n, , u] = k.split('|');
    if (n.toLowerCase() !== name.toLowerCase() || !v.hasBio)
        continue;
    min += convert(v.absorbedMin, u, toUnit);
    max += convert(v.absorbedMax, u, toUnit);
    has = true;
} return { min, max, has }; }
function Progress({ value, goal, unit, kind = 'target' }) { const pct = goal ? Math.min(100, value / goal * 100) : 0; const warn = kind === 'upper' && value > goal; return React.createElement("div", { className: "progressBlock" },
    React.createElement("div", { className: "progressTop" },
        React.createElement("strong", null, fmt(value, 2)),
        React.createElement("span", null,
            "/ ",
            fmt(goal, 2),
            " ",
            unit)),
    React.createElement("div", { className: `bar ${warn ? 'over' : ''}` },
        React.createElement("span", { style: { width: `${pct}%` } })),
    React.createElement("small", { className: "goalKind" }, kind === 'minimum' ? 'minimo' : kind === 'upper' ? 'limite massimo' : 'obiettivo')); }
function openDb() { return new Promise((res, rej) => { const r = indexedDB.open('nutritrace-db', 1); r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('datasets'))
    r.result.createObjectStore('datasets'); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); }
async function dbSet(k, v) { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
async function dbGet(k) { const db = await openDb(); return new Promise((res, rej) => { const r = db.transaction('datasets').objectStore('datasets').get(k); r.onsuccess = () => res(r.result || []); r.onerror = () => rej(r.error); }); }
async function dbDel(k) { const db = await openDb(); return new Promise((res, rej) => { const tx = db.transaction('datasets', 'readwrite'); tx.objectStore('datasets').delete(k); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }); }
function parseSheetRows(data, type = 'array') { const wb = XLSX.read(data, { type }); let rows = []; for (const sn of wb.SheetNames) {
    const a = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: '' });
    if (a.length)
        rows.push(...a);
} return rows; }

const h = React.createElement;

const MICRO_CATALOG = [
  { group:'Vitamine', id:'Vitamina A', name:'Vitamina A', unit:'µg', dailyTarget:900, minIndicative:700, ul:3000, kind:'minimum' },
  { group:'Vitamine', id:'Tiamina B1', name:'Tiamina B1', unit:'mg', dailyTarget:1.2, minIndicative:1.1, kind:'minimum' },
  { group:'Vitamine', id:'Riboflavina B2', name:'Riboflavina B2', unit:'mg', dailyTarget:1.3, minIndicative:1.1, kind:'minimum' },
  { group:'Vitamine', id:'Niacina B3', name:'Niacina B3', unit:'mg', dailyTarget:16, minIndicative:14, ul:35, ulNote:'UL principalmente da integratori/forme fortificate', kind:'minimum' },
  { group:'Vitamine', id:'Acido pantotenico B5', name:'Acido pantotenico B5', unit:'mg', dailyTarget:5, minIndicative:5, kind:'minimum' },
  { group:'Vitamine', id:'Vitamina B6', name:'Vitamina B6', unit:'mg', dailyTarget:1.3, minIndicative:1.3, ul:100, ulNote:'UL indicativo; interpretare con cautela per integratori', kind:'minimum' },
  { group:'Vitamine', id:'Biotina B7', name:'Biotina B7', unit:'µg', dailyTarget:30, minIndicative:30, kind:'minimum' },
  { group:'Vitamine', id:'Folati', name:'Folati', unit:'µg', dailyTarget:400, minIndicative:400, ul:1000, ulNote:'UL riferito soprattutto ad acido folico da integratori/fortificati', kind:'minimum' },
  { group:'Vitamine', id:'Vitamina B12', name:'Vitamina B12', unit:'µg', dailyTarget:2.4, minIndicative:2.4, kind:'minimum' },
  { group:'Vitamine', id:'Vitamina C', name:'Vitamina C', unit:'mg', dailyTarget:90, minIndicative:90, ul:2000, kind:'minimum' },
  { group:'Vitamine', id:'Vitamina D', name:'Vitamina D', unit:'µg', dailyTarget:15, minIndicative:15, ul:100, kind:'minimum' },
  { group:'Vitamine', id:'Vitamina E', name:'Vitamina E', unit:'mg', dailyTarget:15, minIndicative:15, ul:1000, ulNote:'UL principalmente da integratori/forme fortificate', kind:'minimum' },
  { group:'Vitamine', id:'Vitamina K', name:'Vitamina K', unit:'µg', dailyTarget:120, minIndicative:120, kind:'minimum' },
  { group:'Vitamine', id:'Colina', name:'Colina', unit:'mg', dailyTarget:550, minIndicative:550, ul:3500, kind:'minimum' },

  { group:'Minerali e oligoelementi', id:'Calcio', name:'Calcio', unit:'mg', dailyTarget:1000, minIndicative:1000, ul:2500, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Fosforo', name:'Fosforo', unit:'mg', dailyTarget:700, minIndicative:700, ul:4000, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Magnesio', name:'Magnesio', unit:'mg', dailyTarget:410, minIndicative:400, ul:350, ulNote:'UL 350 mg riguarda integratori/farmaci, non il magnesio naturalmente presente negli alimenti', kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Sodio', name:'Sodio', unit:'mg', dailyTarget:1500, minIndicative:1500, ul:2000, ulNote:'Riferimento prudenziale; il fabbisogno può aumentare con sudorazione importante', kind:'target' },
  { group:'Minerali e oligoelementi', id:'Cloruro', name:'Cloruro', unit:'mg', dailyTarget:2300, minIndicative:2300, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Potassio', name:'Potassio', unit:'mg', dailyTarget:3400, minIndicative:3400, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Ferro', name:'Ferro', unit:'mg', dailyTarget:8, minIndicative:8, ul:45, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Zinco', name:'Zinco', unit:'mg', dailyTarget:11, minIndicative:11, ul:40, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Rame', name:'Rame', unit:'µg', dailyTarget:900, minIndicative:900, ul:10000, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Manganese', name:'Manganese', unit:'mg', dailyTarget:2.3, minIndicative:2.3, ul:11, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Iodio', name:'Iodio', unit:'µg', dailyTarget:150, minIndicative:150, ul:1100, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Selenio', name:'Selenio', unit:'µg', dailyTarget:55, minIndicative:55, ul:400, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Molibdeno', name:'Molibdeno', unit:'µg', dailyTarget:45, minIndicative:45, ul:2000, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Cromo', name:'Cromo', unit:'µg', dailyTarget:35, minIndicative:35, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Nickel', name:'Nickel', unit:'µg', dailyTarget:0, kind:'target', noOfficialTarget:true },
  { group:'Minerali e oligoelementi', id:'Fluoro', name:'Fluoro', unit:'mg', dailyTarget:4, minIndicative:4, ul:10, kind:'minimum' },
  { group:'Minerali e oligoelementi', id:'Zolfo', name:'Zolfo', unit:'mg', dailyTarget:0, kind:'target', noOfficialTarget:true },

  { group:'Acidi grassi essenziali', id:'ALA', name:'ALA', unit:'g', dailyTarget:1.6, minIndicative:1.6, kind:'minimum' },
  { group:'Acidi grassi essenziali', id:'EPA', name:'EPA', unit:'mg', dailyTarget:250, minIndicative:250, kind:'minimum' },
  { group:'Acidi grassi essenziali', id:'DHA', name:'DHA', unit:'mg', dailyTarget:250, minIndicative:250, kind:'minimum' },
  { group:'Acidi grassi essenziali', id:'EPA + DHA', name:'EPA + DHA', unit:'mg', dailyTarget:500, minIndicative:250, ul:3000, components:['EPA','DHA'], kind:'minimum' },
  { group:'Acidi grassi essenziali', id:'DPA', name:'DPA', unit:'mg', dailyTarget:0, kind:'target', noOfficialTarget:true },
  { group:'Acidi grassi essenziali', id:'Acido linoleico (LA)', name:'Acido linoleico (LA)', unit:'g', dailyTarget:17, minIndicative:12, kind:'minimum' },
  { group:'Acidi grassi essenziali', id:'Acido arachidonico (AA)', name:'Acido arachidonico (AA)', unit:'mg', dailyTarget:0, kind:'target', noOfficialTarget:true },

  { group:'Aminoacidi essenziali', id:'Leucina', name:'Leucina', unit:'g', dailyTarget:2.81, minIndicative:2.81, perKgReference:39, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Isoleucina', name:'Isoleucina', unit:'g', dailyTarget:1.44, minIndicative:1.44, perKgReference:20, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Valina', name:'Valina', unit:'g', dailyTarget:1.87, minIndicative:1.87, perKgReference:26, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Lisina', name:'Lisina', unit:'g', dailyTarget:2.16, minIndicative:2.16, perKgReference:30, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Metionina + cisteina', name:'Metionina + cisteina', unit:'g', dailyTarget:1.08, minIndicative:1.08, perKgReference:15, components:['Metionina','Cisteina'], kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Treonina', name:'Treonina', unit:'g', dailyTarget:1.08, minIndicative:1.08, perKgReference:15, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Triptofano', name:'Triptofano', unit:'g', dailyTarget:0.29, minIndicative:0.29, perKgReference:4, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Istidina', name:'Istidina', unit:'g', dailyTarget:0.72, minIndicative:0.72, perKgReference:10, kind:'minimum' },
  { group:'Aminoacidi essenziali', id:'Fenilalanina + tirosina', name:'Fenilalanina + tirosina', unit:'g', dailyTarget:1.8, minIndicative:1.8, perKgReference:25, components:['Fenilalanina','Tirosina'], kind:'minimum' }
];

const MACRO_GOALS = [
  { id:'kcal', name:'Energia', unit:'kcal', target:2350, period:'day', kind:'target', group:'Energia e macro' },
  { id:'protein', name:'Proteine', unit:'g', target:140, period:'day', kind:'target', group:'Energia e macro' },
  { id:'carbs', name:'Carboidrati', unit:'g', target:317.9, period:'day', kind:'target', group:'Energia e macro' },
  { id:'fat', name:'Grassi', unit:'g', target:57.6, period:'day', kind:'target', group:'Energia e macro' },
  { id:'sugar', name:'Zuccheri semplici', unit:'g', target:60, period:'day', kind:'upper', group:'Energia e macro', preferredMax:40 },
  { id:'fiber', name:'Fibre', unit:'g', target:35, period:'day', kind:'minimum', group:'Energia e macro' }
];

function buildDefaultGoals(){
  return [
    ...MACRO_GOALS.map(x=>({...x,targetMode:'absolute',perKg:0,pinned:false})),
    ...MICRO_CATALOG.map(x=>({...x,target:Number(x.dailyTarget||0)*7,period:'week',form:'*',targetMode:'absolute',perKg:0,pinned:false}))
  ];
}
function mergeGoalCatalog(saved){
  const base=buildDefaultGoals();
  // V2.3 deliberately uses a new storage key. This merge remains useful for import/backups.
  if(!Array.isArray(saved)||!saved.length)return base;
  const map=new Map(saved.map(g=>[String(g.id),g]));
  const out=base.map(b=>({...b,...(map.get(String(b.id))||{}),group:(map.get(String(b.id))||{}).group||b.group,targetMode:(map.get(String(b.id))||{}).targetMode||'absolute',perKg:Number((map.get(String(b.id))||{}).perKg||0),pinned:Boolean((map.get(String(b.id))||{}).pinned)}));
  const ids=new Set(out.map(g=>String(g.id)));
  for(const g of saved)if(!ids.has(String(g.id)))out.push({...g,group:g.group||'Personalizzati',targetMode:g.targetMode||'absolute',perKg:Number(g.perKg||0),pinned:Boolean(g.pinned)});
  return out;
}

const DEFAULT_PROFILE = { weight:72, macroPlan:{ calorieMode:'fixed', kcal:2350, autoMacro:'carbs', perKg:{ protein:140/72, carbs:317.9/72, fat:.8, sugar:60/72, fiber:35/72 } } };
function normalizeProfile(p){
  if(!p)return structuredClone(DEFAULT_PROFILE);
  if(p.macroPlan)return {...structuredClone(DEFAULT_PROFILE),...p,macroPlan:{...structuredClone(DEFAULT_PROFILE).macroPlan,...p.macroPlan,perKg:{...DEFAULT_PROFILE.macroPlan.perKg,...(p.macroPlan.perKg||{})}}};
  return {...structuredClone(DEFAULT_PROFILE),weight:Number(p.weight||72),macroPlan:{...structuredClone(DEFAULT_PROFILE).macroPlan,kcal:Number(p.kcal||2350),perKg:{...DEFAULT_PROFILE.macroPlan.perKg,protein:Number(p.proteinPerKg||140/72),fat:Number(p.fatPerKg||.8)}}};
}
function computeMacroPlan(profile){
  const weight=Math.max(.1,Number(profile.weight)||0), plan=profile.macroPlan||DEFAULT_PROFILE.macroPlan;
  const per={...DEFAULT_PROFILE.macroPlan.perKg,...(plan.perKg||{})};
  const grams={protein:weight*Number(per.protein||0),carbs:weight*Number(per.carbs||0),fat:weight*Number(per.fat||0),sugar:weight*Number(per.sugar||0),fiber:weight*Number(per.fiber||0)};
  const factors={protein:4,carbs:4,fat:9};
  if(plan.calorieMode==='fixed'&&['protein','carbs','fat'].includes(plan.autoMacro)){
    const auto=plan.autoMacro;let used=0;
    for(const k of ['protein','carbs','fat'])if(k!==auto)used+=grams[k]*factors[k];
    grams[auto]=Math.max(0,(Number(plan.kcal||0)-used)/factors[auto]);per[auto]=grams[auto]/weight;
  }
  const derivedKcal=grams.protein*4+grams.carbs*4+grams.fat*9;
  return {weight,perKg:per,grams,kcal:plan.calorieMode==='derived'?derivedKcal:Number(plan.kcal||0),derivedKcal,delta:Number(plan.kcal||0)-derivedKcal};
}

function parseDateKey(k){ const [y,m,d]=String(k).split('-').map(Number); return new Date(y,m-1,d,12,0,0,0); }
function shiftDateKey(k,days){ const d=parseDateKey(k); d.setDate(d.getDate()+days); return dateKey(d); }
function startOfWeekFor(k){ const d=parseDateKey(k); d.setDate(d.getDate()-((d.getDay()+6)%7)); return d; }
function weekBounds(k){ const a=startOfWeekFor(k), b=new Date(a); b.setDate(a.getDate()+6); return [dateKey(a),dateKey(b)]; }
function dayLabel(k,today){ if(k===today) return 'Oggi'; return parseDateKey(k).toLocaleDateString('it-IT',{weekday:'long',day:'numeric',month:'long',year:'numeric'}); }
function shortDate(k){ return parseDateKey(k).toLocaleDateString('it-IT',{day:'2-digit',month:'short'}); }
function monthBounds(k){const d=parseDateKey(k),a=new Date(d.getFullYear(),d.getMonth(),1,12),b=new Date(d.getFullYear(),d.getMonth()+1,0,12);return[dateKey(a),dateKey(b)];}
function yearBounds(k){const d=parseDateKey(k);return[`${d.getFullYear()}-01-01`,`${d.getFullYear()}-12-31`];}
function daysInclusive(a,b){return Math.max(1,Math.round((parseDateKey(b)-parseDateKey(a))/86400000)+1);}
function previousRange(a,b){const n=daysInclusive(a,b);return[shiftDateKey(a,-n),shiftDateKey(a,-1)];}
function effectiveTarget(g,weight){ return g.targetMode==='perKg' ? Number(g.perKg||0)*Number(weight||0) : Number(g.target||0); }
function goalUnitLabel(g){ return g.targetMode==='perKg' ? `${g.unit}/kg` : g.unit; }
function isMissing(v){ return v===null || v===undefined || v==='' || Number.isNaN(v); }

const CREA_NAME_MAP = {
  magnesium:'Magnesio', iron:'Ferro', calcium:'Calcio', potassium:'Potassio', zinc:'Zinco', copper:'Rame', manganese:'Manganese', selenium:'Selenio', iodine:'Iodio', phosphorus:'Fosforo', sodium:'Sodio', chlorine:'Cloruro', chromium:'Cromo', nickel:'Nickel', molybdenum:'Molibdeno', fluorine:'Fluoro', fluoride:'Fluoro', sulfur:'Zolfo',
  vitamin_a_retinol_equivalent:'Vitamina A', thiamine:'Tiamina B1', riboflavin:'Riboflavina B2', niacin:'Niacina B3', pantothenic_acid:'Acido pantotenico B5', vitamin_b6:'Vitamina B6', biotin:'Biotina B7', folate:'Folati', folates:'Folati', vitamin_b12:'Vitamina B12', vitamin_c:'Vitamina C', vitamin_d:'Vitamina D', vitamin_e:'Vitamina E', vitamin_k:'Vitamina K',
  sucrose:'Saccarosio', glucose:'Glucosio', fructose:'Fruttosio', lactose:'Lattosio', galactose:'Galattosio', maltose:'Maltosio',
  leucine:'Leucina', isoleucine:'Isoleucina', valine:'Valina', lysine:'Lisina', methionine:'Metionina', threonine:'Treonina', tryptophan:'Triptofano', histidine:'Istidina', phenylalanine:'Fenilalanina'
};
const CREA_UNIT_MAP = {
  fluorine:'µg', fluoride:'µg', sodium:'mg', magnesium:'mg', phosphorus:'mg', chlorine:'mg', potassium:'mg', calcium:'mg', chromium:'µg', manganese:'mg', iron:'mg', nickel:'µg', molybdenum:'µg', copper:'mg', zinc:'mg', selenium:'µg', iodine:'µg',
  sucrose:'g', glucose:'g', fructose:'g', lactose:'g', galactose:'g', maltose:'g',
  vitamin_a_retinol_equivalent:'µg', thiamine:'mg', riboflavin:'mg', niacin:'mg', pantothenic_acid:'mg', vitamin_b6:'mg', biotin:'µg', folate:'µg', folates:'µg', vitamin_b12:'µg', vitamin_c:'mg', vitamin_d:'µg', vitamin_e:'mg', vitamin_k:'µg'
};
const CREA_AMINO_KEYS = new Set(['leucine','isoleucine','valine','lysine','methionine','threonine','tryptophan','histidine','phenylalanine']);
function creaUnit(raw, display){
  const n=norm(raw);
  const byKey=Object.entries(CREA_UNIT_MAP).find(([k])=>n===norm(k));
  if(byKey) return byKey[1];
  const fromHeader=unitFromHeader(raw,'');
  if(fromHeader) return fromHeader;
  if(['Saccarosio','Glucosio','Fruttosio','Lattosio','Galattosio','Maltosio'].includes(display)) return 'g';
  if(['Vitamina A','Folati','Vitamina B12','Vitamina D','Vitamina K','Selenio','Iodio'].includes(display)) return 'µg';
  return 'mg';
}
function flattenCreaItems(record){
  const items=[];
  for(const [group,val] of Object.entries(record||{})) if(Array.isArray(val)) for(const x of val) if(x && typeof x==='object' && ('description' in x || 'Descrizione Nutriente' in x)) items.push({group,...x});
  return items;
}
function normalizeCreaNested(source, records){
  const meta=SOURCE_META[source]||{name:source,version:'importato'};
  const out=[];
  for(const r of records||[]){
    const name=clean(r.name||r.Nome||r.food_name||r['Nome Alimento']); if(!name) continue;
    const code=clean(r.food_code||r['Codice Alimento']||r.code||out.length+1);
    const items=flattenCreaItems(r); const by={};
    for(const item of items){ const desc=norm(item.description||item['Descrizione Nutriente']); by[desc]={...item,value:num(item.value??item['Valore per 100 g'])}; }
    const get=(...keys)=>{ for(const k of keys){ const x=by[norm(k)]; if(x && x.value!==null) return x.value; } return null; };
    const getMicro=(...keys)=>{ const v=get(...keys); return v===0?null:v; }; // CREA exports can encode unavailable detail as 0: conservatively expose N/D.
    const label=emptyLabel();
    label.kcal=get('energy_kcal','Energia (kcal)')??'';
    label.protein=get('proteins','Proteine (g)')??'';
    label.fat=get('lipids','Lipidi (g)')??'';
    label.carbs=get('available_carbohydrates','Carboidrati disponibili (g)')??'';
    label.sugar=get('soluble_sugars','Zuccheri solubili (g)')??'';
    label.fiber=get('total_fiber','Fibra totale (g)')??'';
    const nutrients=[];
    const add=(name,amount,unit,raw)=>{ if(amount===null || amount===undefined || !Number.isFinite(Number(amount))) return; nutrients.push({id:newId(),name,form:'naturalmente presente / non specificata',amount:Number(amount),unit,source:meta.name,evidence:'dataset CREA/importato · zero dettaglio ambiguo trattato come N/D',rawName:raw||name,bio:{mode:'none',min:'',max:'',source:''}}); };
    for(const item of items){
      const raw=clean(item.description||item['Descrizione Nutriente']); const n=norm(raw); const v=num(item.value??item['Valore per 100 g']); if(v===null||v===0) continue;
      const groupNorm=norm(item.group||'');
      if(groupNorm.includes('amino') || groupNorm.includes('fatty acid') || groupNorm.includes('acidi grassi')) continue;
      let key=Object.keys(CREA_NAME_MAP).find(k=>n===norm(k)||n.startsWith(norm(k)+' '));
      if(CREA_AMINO_KEYS.has(key)) continue;
      if(!key){
        const aliases=Object.entries(NUTRIENT_ALIASES).find(([,a])=>matchesHeader(raw,a));
        if(aliases) key=aliases[0];
      }
      if(key){ const display=CREA_NAME_MAP[key]||key; const unit=creaUnit(key===display?raw:key,display); add(display,v,unit,raw); }
    }
    const fat=Number(label.fat)||0, protein=Number(label.protein)||0;
    const pct=(...keys)=>getMicro(...keys);
    const sat=pct('saturated_fatty_acids','Acidi grassi Saturi (%)'); if(sat!==null && fat) label.saturatedFat=fat*sat/100;
    const fatty=[['ALA',['C18:3_linolenic_acid','c18_3_linolenic_acid','C18:3 acido linolenico (%)']],['Acido linoleico (LA)',['C18:2_linoleic_acid','c18_2_linoleic_acid','C18:2 acido linoleico (%)']],['Acido arachidonico (AA)',['C20:4_arachidonic_acid','c20_4_arachidonic_acid','C20:4 acido arachidonico (%)']],['EPA',['C20:5_eicosapentaenoic_acid_EPA','c20_5_eicosapentaenoic_acid_epa','C20:5 acido eicosapentenoico EPA (%)']],['DHA',['C22:6_docosahexaenoic_acid_DHA','c22_6_docosahexaenoic_acid_dha','C22:6 acido docosaesenoico DHA (%)']]];
    for(const [display,keys] of fatty){ const v=pct(...keys); if(v!==null && fat) add(display,fat*v/100,'g',keys[0]); }
    for(const aa of EAA){ const english=Object.entries(CREA_NAME_MAP).find(([k,v])=>CREA_AMINO_KEYS.has(k)&&v===aa)?.[0]; const v=getMicro(aa,aa.toLowerCase(),english); if(v!==null && protein) add(aa,protein*v/100,'g',aa); }
    const sodium=nutrients.find(n=>n.name==='Sodio'); if(sodium && isMissing(label.salt)) label.salt=convert(sodium.amount,sodium.unit,'g')*2.5;
    out.push({localId:`${source}:${code}`,source,sourceId:code,name,officialName:name,brand:'',servingGrams:100,label,nutrients,ingredients:'',aliases:[],sourceInfo:{id:newId(),name:meta.name,reference:`CREA ${code}`,quality:'primaria',version:meta.version||'2019'}});
  }
  return out;
}
function normalizeCreaFlat(source, rows){
  const meta=SOURCE_META[source]||{name:source,version:'importato'};
  const get=(r,...aliases)=>{ for(const [k,v] of Object.entries(r||{})) if(aliases.some(a=>norm(k)===norm(a))) return num(v); return null; };
  const getMicro=(r,...aliases)=>{ const v=get(r,...aliases); return v===0?null:v; }; // zero in CREA detail fields is ambiguous: N/D is safer than a false absence.
  const out=[];
  for(const r of rows||[]){
    const name=clean(r.name||r.Nome||r['Nome Alimento']); if(!name) continue;
    const code=clean(r.food_code||r['Codice Alimento']||r.code||out.length+1);
    const label=emptyLabel();
    label.kcal=get(r,'energy_kcal','Energia (kcal)')??'';
    label.protein=get(r,'proteins','Proteine (g)')??'';
    label.fat=get(r,'lipids','Lipidi (g)')??'';
    label.carbs=get(r,'available_carbohydrates','Carboidrati disponibili (g)')??'';
    label.sugar=get(r,'soluble_sugars','Zuccheri solubili (g)')??'';
    label.fiber=get(r,'total_fiber','Fibra totale (g)')??'';
    const nutrients=[];
    const add=(display,amount,unit,raw)=>{ if(amount===null||!Number.isFinite(Number(amount))) return; nutrients.push({id:newId(),name:display,form:'naturalmente presente / non specificata',amount:Number(amount),unit,source:meta.name,evidence:'dataset CREA/importato · zero dettaglio ambiguo trattato come N/D',rawName:raw||display,bio:{mode:'none',min:'',max:'',source:''}}); };
    for(const [key,display] of Object.entries(CREA_NAME_MAP)){
      if(CREA_AMINO_KEYS.has(key)) continue;
      const v=getMicro(r,key); if(v!==null) add(display,v,creaUnit(key,display),key);
    }
    const fat=Number(label.fat)||0, protein=Number(label.protein)||0;
    const sat=getMicro(r,'saturated_fatty_acids','Acidi grassi Saturi (%)'); if(sat!==null&&fat) label.saturatedFat=fat*sat/100;
    const fatty=[
      ['ALA',['C18:3_linolenic_acid','c18_3_linolenic_acid','C18:3 acido linolenico (%)']],
      ['Acido linoleico (LA)',['C18:2_linoleic_acid','c18_2_linoleic_acid','C18:2 acido linoleico (%)']],
      ['Acido arachidonico (AA)',['C20:4_arachidonic_acid','c20_4_arachidonic_acid','C20:4 acido arachidonico (%)']],
      ['EPA',['C20:5_eicosapentaenoic_acid_EPA','c20_5_eicosapentaenoic_acid_epa','C20:5 acido eicosapentenoico EPA (%)']],
      ['DHA',['C22:6_docosahexaenoic_acid_DHA','c22_6_docosahexaenoic_acid_dha','C22:6 acido docosaesenoico DHA (%)']]
    ];
    for(const [display,keys] of fatty){ const v=getMicro(r,...keys); if(v!==null&&fat) add(display,fat*v/100,'g',keys[0]); }
    for(const aa of EAA){ const english=Object.entries(CREA_NAME_MAP).find(([k,v])=>CREA_AMINO_KEYS.has(k)&&v===aa)?.[0]; const v=getMicro(r,aa,aa.toLowerCase(),english); if(v!==null&&protein) add(aa,protein*v/100,'g',aa); }
    const sodium=nutrients.find(n=>n.name==='Sodio'); if(sodium) label.salt=convert(sodium.amount,sodium.unit,'g')*2.5;
    out.push({localId:`${source}:${code}`,source,sourceId:code,name,officialName:name,brand:'',servingGrams:100,label,nutrients,ingredients:'',aliases:[],sourceInfo:{id:newId(),name:meta.name,reference:`CREA ${code}`,quality:'primaria',version:meta.version||'2019'}});
  }
  return out;
}
function looksLikeCreaFlat(rows){
  if(!rows?.length) return false;
  const keys=Object.keys(rows[0]||{}).map(norm);
  return keys.includes(norm('energy_kcal')) && keys.includes(norm('available_carbohydrates')) && (keys.includes(norm('food_code')) || keys.includes(norm('Codice Alimento')));
}

function parseJsonDataset(source,text){
  let raw;
  try{ raw=JSON.parse(text); }catch{ raw=String(text).split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)); }
  const arr=Array.isArray(raw)?raw:(Array.isArray(raw?.foods)?raw.foods:(Array.isArray(raw?.data)?raw.data:[]));
  if(!arr.length) return [];
  if(arr.some(x=>Array.isArray(x?.macro_nutrients)||Array.isArray(x?.['MACRO NUTRIENTI']))) return normalizeCreaNested(source,arr);
  if(looksLikeCreaFlat(arr)) return normalizeCreaFlat(source,arr);
  return normalizeRows(source,arr);
}

const MASTER_BASE='./data/master';
const DEFAULT_APP_CONFIG={
  ui:{
    search:{
      title:'Ricerca alimenti',
      dbButton:'Cerca nel database',
      aiButton:'Ricerca con AI',
      aiWorking:'Ricerca con AI…',
      manualButton:'Inserisci manualmente',
      gramsLabel:'Grammi',
      gramsPlaceholder:'facoltativi se esiste una porzione standard',
      notFound:'Nessuna corrispondenza sufficientemente affidabile nel Master DB.'
    },
    recipe:{
      title:'Voce libera / lista / ricetta',
      subtitle:'L’AI interpreta il testo; peso e corrispondenza database vengono poi validati dal codice.',
      interpretButton:'Interpreta e verifica',
      aiEstimateButton:'Ricerca con AI',
      dbSearchButton:'Ricerche DB'
    }
  },
  searchPolicy:{
    portionPolicy:{
      catalogFirst:true,
      aiEstimateWhenCatalogMissing:true,
      validateExplicitMassFromRawText:true,
      ignoreAiGramsWithoutExplicitMass:true,
      defaultNaturalUnitCount:1,
      defaultNaturalUnitSize:'medium',
      autoApplyCatalog:true,
      autoApplyAiConfidence:['high','medium'],
      maxAiRelativeRange:.55,
      neverAutoApplyKinds:['dish','plate','bowl','serving','pizza','slice_variable','piece_variable','unknown'],
      showAssumption:true
    },
    databaseMatchPolicy:{
      requireLexicalEvidence:true,
      minCandidateScore:42,
      minAutoSelectScore:92,
      minAutoSelectGap:14,
      neverAutoSelectOnMaterialAmbiguity:true
    },
    ambiguityPolicy:{askOnlyIfMaterial:true}
  },
  standardPortions:{items:[]}
};
function cfgGet(obj,path,fallback){let cur=obj;for(const k of String(path||'').split('.')){if(cur==null||typeof cur!=='object'||!(k in cur))return fallback;cur=cur[k];}return cur===undefined?fallback:cur;}
async function loadJsonConfig(url,fallback){
  try{
    const r=await fetch(url,{cache:'no-store'});
    if(!r.ok)throw new Error(`config ${r.status}`);
    return await r.json();
  }catch{return fallback;}
}
async function loadAppConfig(){
  const [ui,searchPolicy,standardPortions]=await Promise.all([
    loadJsonConfig('./config/ui.it.json',DEFAULT_APP_CONFIG.ui),
    loadJsonConfig('./config/search-policy.json',DEFAULT_APP_CONFIG.searchPolicy),
    loadJsonConfig('./config/standard-portions.json',DEFAULT_APP_CONFIG.standardPortions)
  ]);
  return {ui,searchPolicy,standardPortions};
}
function explicitMassFromText(text){
  const s=String(text??'').toLowerCase().replace(/(\d),(\d)/g,'$1.$2');
  const m=s.match(/(?:^|\s|\b)(\d+(?:\.\d+)?)\s*(kg|chilogrammi?|kilogrammi?|g|gr|grammi?|grammo)\b/i);
  if(!m)return null;
  const value=Number(m[1]);if(!(value>0))return null;
  return /^(kg|chilogram|kilogram)/i.test(m[2])?value*1000:value;
}
function countFromText(text){
  let s=String(text??'').toLowerCase().replace(/(\d),(\d)/g,'$1.$2');
  s=s.replace(/\d+(?:\.\d+)?\s*(?:kg|chilogrammi?|kilogrammi?|g|gr|grammi?|grammo)\b/gi,' ');
  const n=norm(s);
  const m=n.match(/(?:^| )(\d+(?:\.\d+)?)(?: |$)/);
  if(m){const v=Number(m[1]);if(Number.isFinite(v)&&v>0&&v<=100)return v;}
  const words={un:1,uno:1,una:1,due:2,tre:3,quattro:4,cinque:5,sei:6,sette:7,otto:8,nove:9,dieci:10};
  for(const [w,v] of Object.entries(words))if(hasTerm(n,w))return v;
  return null;
}
function naturalCount(text,def=1){return countFromText(text)??def;}
function textSize(text){const n=norm(text);if(['piccolo','piccola','small'].some(x=>hasTerm(n,x)))return 'small';if(['grande','large'].some(x=>hasTerm(n,x)))return 'large';if(['medio','media','medium'].some(x=>hasTerm(n,x)))return 'medium';return 'medium';}
function findPortionCatalog(textOrTexts,config,sizeOverride='',countOverride=null){
  const items=config?.standardPortions?.items||[];
  const texts=(Array.isArray(textOrTexts)?textOrTexts:[textOrTexts]).map(clean).filter(Boolean);
  if(!texts.length)return null;
  const joined=texts.join(' '), size=sizeOverride&&sizeOverride!=='unspecified'?sizeOverride:textSize(joined);
  const count=Number(countOverride)>0?Number(countOverride):naturalCount(joined,cfgGet(config,'searchPolicy.portionPolicy.defaultNaturalUnitCount',1));
  let best=null,bestScore=-1;
  for(const item of items){
    if(item.kind!=='natural_unit')continue;
    for(const aliasRaw of [...(item.aliases||[]),item.canonicalName].filter(Boolean)){
      const alias=norm(aliasRaw);if(!alias)continue;
      for(const text of texts){
        const nt=norm(text);let score=0;
        if(nt===alias)score=10000+alias.length;
        else if(hasTerm(nt,alias))score=1000+alias.length;
        else continue;
        if(score>bestScore){best={item,matchedAlias:aliasRaw};bestScore=score;}
      }
    }
  }
  if(!best)return null;
  const item=best.item;
  const chosen=item.sizes?.[size]||item.sizes?.[item.defaultSize||'medium']||item.sizes?.medium;
  if(!chosen||!(Number(chosen.grams)>0)||chosen.autoApply===false||cfgGet(config,'searchPolicy.portionPolicy.autoApplyCatalog',true)===false)return null;
  const perLo=Number(chosen.range_g?.[0]??chosen.p10??chosen.grams),perHi=Number(chosen.range_g?.[1]??chosen.p90??chosen.grams);
  const sizeLabel=size==='small'?'piccola':size==='large'?'grande':'media';
  return {
    grams:Number(chosen.grams)*count,count,size,confidence:chosen.confidence||'medium',
    source:item.source?.name||item.sourceNote||'catalogo porzioni',
    range:[perLo*count,perHi*count],kind:item.kind,catalogId:item.id,
    assumption:`${count} × unità ${sizeLabel} ≈ ${fmt(Number(chosen.grams)*count,1)} g edibili`
  };
}
function aiPortionUsable(ing,config,countOverride=null){
  if(!ing||ing.unit_kind!=='natural_unit'||!Number(ing.estimated_piece_grams))return null;
  const policy=cfgGet(config,'searchPolicy.portionPolicy',{});
  if((policy.neverAutoApplyKinds||[]).includes(ing.unit_kind))return null;
  const confidence=ing.portion_confidence||'none';
  if(!(policy.autoApplyAiConfidence||['high','medium']).includes(confidence))return null;
  const mid=Number(ing.estimated_piece_grams),lo=Number(ing.estimated_piece_min_g||mid),hi=Number(ing.estimated_piece_max_g||mid);
  if((hi-lo)/Math.max(1,mid)>Number(policy.maxAiRelativeRange??.55))return null;
  const count=Number(countOverride)>0?Number(countOverride):(Number(ing.count)||1);
  const sizeLabel=ing.size==='small'?'piccola':ing.size==='large'?'grande':'media';
  return {grams:mid*count,count,size:ing.size||'medium',confidence,source:'AI · stima porzione',range:[lo*count,hi*count],kind:ing.unit_kind,assumption:`${count} × unità ${sizeLabel} ≈ ${fmt(mid*count,1)} g (stima AI ${confidence})`};
}
function applyPortionPolicy(ing,config){
  const fragment=`${ing?.raw||''} ${ing?.quantity_text||''}`.trim();
  const explicit=explicitMassFromText(fragment);
  const textCount=countFromText(fragment);
  const parserCount=Number(ing?.count);
  const count=textCount||(!explicit&&parserCount>0&&parserCount<=100?parserCount:1);
  const normalized={...ing,count,grams:null};
  if(ing?.gramsUserEdited&&Number(ing.grams)>0){const manual=Number(ing.grams);return {...normalized,grams:manual,gramsUserEdited:true,requires_weight_confirmation:false,portion_assumption:`Peso inserito manualmente: ${fmt(manual,1)} g`,portionResolution:{type:'manual',grams:manual,count}};}
  if(explicit){
    return {...normalized,grams:explicit,requires_weight_confirmation:false,portion_assumption:`Peso indicato dall’utente: ${fmt(explicit,1)} g`,portionResolution:{type:'explicit',grams:explicit,count}};
  }
  const cat=findPortionCatalog([ing?.raw,ing?.name,ing?.lookup_name_en],config,ing?.size,count);
  if(cat)return {...normalized,grams:cat.grams,requires_weight_confirmation:false,portion_assumption:cat.assumption,portionResolution:{type:'catalog',...cat}};
  if(cfgGet(config,'searchPolicy.portionPolicy.aiEstimateWhenCatalogMissing',true)!==false){
    const ai=aiPortionUsable(normalized,config,count);
    if(ai)return {...normalized,grams:ai.grams,requires_weight_confirmation:false,portion_assumption:ai.assumption,portionResolution:{type:'ai_portion',...ai}};
  }
  return {...normalized,requires_weight_confirmation:true};
}
const masterChunkCache=new Map();
const MASTER_MICRO_SPECS={
  'Vitamina A':{ids:['vitamin_a_rae'],unit:'µg'},
  'Tiamina B1':{ids:['thiamin_b1'],unit:'mg'}, 'Riboflavina B2':{ids:['riboflavin_b2'],unit:'mg'},
  'Niacina B3':{ids:['niacin_b3'],unit:'mg'}, 'Acido pantotenico B5':{ids:['pantothenic_acid_b5'],unit:'mg'},
  'Vitamina B6':{ids:['vitamin_b6'],unit:'mg'}, 'Biotina B7':{ids:['biotin_b7'],unit:'µg'},
  'Folati':{ids:['folate_total_b9'],unit:'µg'}, 'Vitamina B12':{ids:['vitamin_b12'],unit:'µg'},
  'Vitamina C':{ids:['vitamin_c'],unit:'mg'}, 'Vitamina D':{ids:['vitamin_d'],unit:'µg'},
  'Vitamina E':{ids:['alpha_tocopherol','vitamin_e_alpha_te'],unit:'mg'}, 'Vitamina K':{ids:['vitamin_k','vitamin_k1'],unit:'µg'},
  'Colina':{ids:['choline'],unit:'mg'}, 'Calcio':{ids:['calcium'],unit:'mg'}, 'Fosforo':{ids:['phosphorus'],unit:'mg'},
  'Magnesio':{ids:['magnesium'],unit:'mg'}, 'Sodio':{ids:['sodium'],unit:'mg'}, 'Cloruro':{ids:['chloride'],unit:'mg'},
  'Potassio':{ids:['potassium'],unit:'mg'}, 'Ferro':{ids:['iron'],unit:'mg'}, 'Zinco':{ids:['zinc'],unit:'mg'},
  'Rame':{ids:['copper'],unit:'mg'}, 'Manganese':{ids:['manganese'],unit:'mg'}, 'Iodio':{ids:['iodine'],unit:'µg'},
  'Selenio':{ids:['selenium'],unit:'µg'}, 'Molibdeno':{ids:['molybdenum'],unit:'µg'}, 'Cromo':{ids:['chromium'],unit:'µg'},
  'Nickel':{ids:['nickel'],unit:'µg'}, 'Fluoro':{ids:['fluoride'],unit:'µg'}, 'Zolfo':{ids:['sulfur'],unit:'mg'},
  'ALA':{ids:['alpha_linolenic_acid'],unit:'mg'}, 'EPA':{ids:['epa'],unit:'mg'}, 'DHA':{ids:['dha'],unit:'mg'},
  'DPA':{ids:['dpa'],unit:'mg'}, 'Acido linoleico (LA)':{ids:['linoleic_acid'],unit:'g'},
  'Acido arachidonico (AA)':{ids:['arachidonic_acid'],unit:'mg'}, 'Omega-3 totali':{ids:['omega3_total'],unit:'g'},
  'Omega-6 totali':{ids:['omega6_total'],unit:'g'},
  'Leucina':{ids:['leucine'],unit:'g'}, 'Isoleucina':{ids:['isoleucine'],unit:'g'}, 'Valina':{ids:['valine'],unit:'g'},
  'Lisina':{ids:['lysine'],unit:'g'}, 'Metionina':{ids:['methionine'],unit:'g'}, 'Treonina':{ids:['threonine'],unit:'g'},
  'Triptofano':{ids:['tryptophan'],unit:'g'}, 'Istidina':{ids:['histidine'],unit:'g'}, 'Fenilalanina':{ids:['phenylalanine'],unit:'g'}, 'Cisteina':{ids:['cysteine','cystine'],unit:'g'}, 'Tirosina':{ids:['tyrosine'],unit:'g'}
};
const AI_NUTRIENT_SPECS={
  'Vitamina A':{id:'vitamin_a_rae',unit:'µg',advanced:true}, 'Tiamina B1':{id:'thiamin_b1',unit:'mg'},
  'Riboflavina B2':{id:'riboflavin_b2',unit:'mg'}, 'Niacina B3':{id:'niacin_b3',unit:'mg'},
  'Acido pantotenico B5':{id:'pantothenic_acid_b5',unit:'mg'}, 'Vitamina B6':{id:'vitamin_b6',unit:'mg'},
  'Biotina B7':{id:'biotin_b7',unit:'µg',advanced:true}, 'Folati':{id:'folate_total_b9',unit:'µg'},
  'Vitamina B12':{id:'vitamin_b12',unit:'µg'}, 'Vitamina C':{id:'vitamin_c',unit:'mg'},
  'Vitamina D':{id:'vitamin_d',unit:'µg'}, 'Vitamina E':{id:'alpha_tocopherol',unit:'mg'},
  'Vitamina K':{id:'vitamin_k',unit:'µg'}, 'Colina':{id:'choline',unit:'mg'}, 'Calcio':{id:'calcium',unit:'mg'},
  'Fosforo':{id:'phosphorus',unit:'mg'}, 'Magnesio':{id:'magnesium',unit:'mg'}, 'Sodio':{id:'sodium',unit:'mg'},
  'Cloruro':{id:'chloride',unit:'mg',advanced:true}, 'Potassio':{id:'potassium',unit:'mg'}, 'Ferro':{id:'iron',unit:'mg'},
  'Zinco':{id:'zinc',unit:'mg'}, 'Rame':{id:'copper',unit:'mg'}, 'Manganese':{id:'manganese',unit:'mg'},
  'Iodio':{id:'iodine',unit:'µg',advanced:true}, 'Selenio':{id:'selenium',unit:'µg'},
  'Molibdeno':{id:'molybdenum',unit:'µg',advanced:true}, 'Cromo':{id:'chromium',unit:'µg',advanced:true},
  'Nickel':{id:'nickel',unit:'µg',advanced:true}, 'Fluoro':{id:'fluoride',unit:'µg',advanced:true}, 'Zolfo':{id:'sulfur',unit:'mg',advanced:true},
  'ALA':{id:'alpha_linolenic_acid',unit:'mg',advanced:true}, 'EPA':{id:'epa',unit:'mg',advanced:true}, 'DHA':{id:'dha',unit:'mg',advanced:true},
  'DPA':{id:'dpa',unit:'mg',advanced:true}, 'Acido linoleico (LA)':{id:'linoleic_acid',unit:'g',advanced:true},
  'Acido arachidonico (AA)':{id:'arachidonic_acid',unit:'mg',advanced:true}, 'Omega-3 totali':{id:'omega3_total',unit:'g',advanced:true},
  'Omega-6 totali':{id:'omega6_total',unit:'g',advanced:true},
  'Leucina':{id:'leucine',unit:'g',advanced:true}, 'Isoleucina':{id:'isoleucine',unit:'g',advanced:true},
  'Valina':{id:'valine',unit:'g',advanced:true}, 'Lisina':{id:'lysine',unit:'g',advanced:true},
  'Metionina':{id:'methionine',unit:'g',advanced:true}, 'Treonina':{id:'threonine',unit:'g',advanced:true},
  'Triptofano':{id:'tryptophan',unit:'g',advanced:true}, 'Istidina':{id:'histidine',unit:'g',advanced:true},
  'Fenilalanina':{id:'phenylalanine',unit:'g',advanced:true}, 'Cisteina':{id:'cysteine',unit:'g',advanced:true}, 'Tirosina':{id:'tyrosine',unit:'g',advanced:true}
};
const AI_ID_TO_DISPLAY=Object.fromEntries(Object.entries(AI_NUTRIENT_SPECS).map(([name,x])=>[x.id,name]));
const SAFE_AI_DEFAULT=['Tiamina B1','Riboflavina B2','Niacina B3','Acido pantotenico B5','Vitamina B6','Folati','Vitamina B12','Vitamina C','Vitamina D','Vitamina E','Vitamina K','Colina','Calcio','Fosforo','Magnesio','Sodio','Potassio','Ferro','Zinco','Rame','Manganese','Selenio'];
function massUnit(u){ const x=String(u||''); if(x.startsWith('µg')||x.startsWith('ug'))return 'µg'; if(x.startsWith('mg'))return 'mg'; if(x.startsWith('g'))return 'g'; return x; }
function masterNutrientCatalog(manifest){ return Object.fromEntries((manifest?.nutrients||[]).map(n=>[n.id,n])); }
async function loadMasterBundle(){
  const [m,i]=await Promise.all([fetch(`${MASTER_BASE}/manifest.json`,{cache:'no-cache'}),fetch(`${MASTER_BASE}/index.json`,{cache:'no-cache'})]);
  if(!m.ok||!i.ok) throw new Error('Master Food DB non disponibile');
  const manifest=await m.json(), rawIndex=await i.json();
  // V2.3: prepare normalized search fields exactly once. This removes thousands of
  // Unicode/string normalizations from every diary keystroke.
  const index=(rawIndex||[]).map(r=>({
    ...r,
    __nn:norm(r.name),
    __ne:norm(r.name_en),
    __aliases:(r.aliases||[]).map(norm).filter(Boolean),
    __search:norm(`${r.name||''} ${r.name_en||''} ${(r.aliases||[]).join(' ')}`)
  }));
  return {manifest,index};
}
function scoreMasterRow(q,row){
  const nq=norm(q); if(!nq)return 0;
  const nn=row.__nn??norm(row.name), ne=row.__ne??norm(row.name_en), aliases=row.__aliases??(row.aliases||[]).map(norm);
  const name=`${nn} ${ne}`.trim();
  let s=0;
  for(const p of phraseAlternatives(q)){
    if(nn===p||ne===p)s=Math.max(s,120);
    else if(nn.startsWith(`${p} `)||ne.startsWith(`${p} `))s=Math.max(s,65);
    else if(hasTerm(name,p))s=Math.max(s,48);
    if(aliases.some(a=>a===p))s=Math.max(s,150);
  }
  for(const token of queryTokens(q)){
    const alts=tokenAlternatives(token);
    if(alts.some(a=>hasTerm(name,a)))s+=14;else s-=4;
    if(alts.some(a=>aliases.some(x=>hasTerm(x,a))))s+=25;
  }
  if(nq && (nn===nq||ne===nq))s+=80;
  if(nq && (nn.startsWith(nq)||ne.startsWith(nq)))s+=25;
  if(s>=40)s+=Math.min(80,Math.max(0,Number(row.sc||1)-1)*20);
  if((row.sources||[]).includes('it'))s+=25;
  if(Number(row.tc||0)>=.95)s+=4;
  // Prefer records whose runtime has complete core macros, without hiding less-complete alternatives.
  if(row.core)s+=18; else s+=Math.min(6,Number(row.mc||0));
  return Math.max(0,s);
}
function searchMasterIndex(q,index,limit=12){
  const raw=clean(q); if(!raw)return [];
  const nq=norm(raw); if(nq.length<2)return [];
  const tokens=queryTokens(raw), tokenAlts=tokens.flatMap(tokenAlternatives).map(norm).filter(Boolean);
  const out=[];
  for(const r of index||[]){
    // Very cheap pre-filter. If the literal query is absent, require at least one semantic token/alias.
    const hay=r.__search??norm(`${r.name||''} ${r.name_en||''} ${(r.aliases||[]).join(' ')}`);
    if(!hay.includes(nq) && tokenAlts.length && !tokenAlts.some(t=>hasTerm(hay,t)))continue;
    const score=scoreMasterRow(raw,r); if(score>0)out.push({...r,score,resultType:'master'});
  }
  return out.sort((a,b)=>b.score-a.score||Number(b.core)-Number(a.core)||Number(b.mc||0)-Number(a.mc||0)||Number(b.sc||0)-Number(a.sc||0)||String(a.name).localeCompare(String(b.name),'it')).slice(0,limit);
}
async function loadMasterDetail(row){
  const c=Number(row.chunk); if(!masterChunkCache.has(c)) masterChunkCache.set(c,fetch(`${MASTER_BASE}/chunks/${String(c).padStart(2,'0')}.json`).then(r=>{if(!r.ok)throw new Error('Chunk Master DB non disponibile');return r.json();}));
  const data=await masterChunkCache.get(c); return data[String(row.id)]||null;
}
function masterGrade(arr){ return String(arr?.[6]||'C').toUpperCase(); }
function masterWarning(arr){ return clean(arr?.[5]||''); }
function masterPick(detail,ids){ for(const id of ids||[]){ const a=detail?.n?.[id]; if(!a||!Number.isFinite(Number(a[0]))) continue; return {id,arr:a,grade:masterGrade(a),warning:masterWarning(a)}; } return null; }
function masterNd(detail,ids){ for(const id of ids||[]){ const a=detail?.nd?.[id]; if(a)return {id,arr:a}; } return null; }
function nutrientEligibleForDeficiency(n){
  if(!n||!Number.isFinite(Number(n.amount)))return false;
  if(n.aiEstimate||String(n.source||'').toLowerCase().includes('ai · stima'))return false;
  if(n.source==='NutriTrace Master DB')return ['A','B','C'].includes(String(n.grade||'C').toUpperCase());
  return true;
}
function masterToFood(row,detail,manifest,alias=''){
  const f={...emptyFood(),masterId:row.id,masterVersion:manifest?.runtime_version||manifest?.schema||'v1',name:clean(alias)||row.name,officialName:row.name_en||row.name,aliases:[...new Set([row.name,row.name_en,...(row.aliases||[]),clean(alias)].filter(Boolean))],servingGrams:100,nutrientStatus:{}};
  const cat=masterNutrientCatalog(manifest); const label=emptyLabel();
  const macro={kcal:['energy_kcal'],protein:['protein'],carbs:['carbohydrate_available','carbohydrate_total'],sugar:['sugars_total'],fat:['fat_total'],saturatedFat:['fat_saturated'],fiber:['fiber'],salt:['salt']};
  for(const [field,ids] of Object.entries(macro)){ const p=masterPick(detail,ids); if(p) label[field]=Number(p.arr[0]); }
  if(isMissing(label.salt)){ const na=masterPick(detail,['sodium']); if(na)label.salt=Number(na.arr[0])*2.5/1000; }
  f.label=label;
  for(const [display,spec] of Object.entries(MASTER_MICRO_SPECS)){
    const p=masterPick(detail,spec.ids);
    if(p){
      const sourceUnit=massUnit(cat[p.id]?.unit||spec.unit), amount=convert(Number(p.arr[0]),sourceUnit,spec.unit);
      const warning=p.warning?` · warning: ${p.warning}`:'';
      f.nutrients.push({id:newId(),name:display,form:`Master DB · ${cat[p.id]?.name||p.id}`,amount,unit:spec.unit,source:'NutriTrace Master DB',evidence:`Grade ${p.grade} · ${p.arr[1]} · ${p.arr[3]?.join(', ')||'fonte nazionale'}${p.arr[4]?` · range ${p.arr[4][0]}–${p.arr[4][1]} ${cat[p.id]?.unit||''}`:''}${warning}`,canonicalId:p.id,reliability:p.arr[1],grade:p.grade,auditWarning:p.warning,bio:{mode:'none',min:'',max:'',source:''}});
      f.nutrientStatus[display]={status:'numeric',reliability:p.arr[1],grade:p.grade,warning:p.warning,canonicalId:p.id,sources:p.arr[3]||[]};
    }else{
      const nd=masterNd(detail,spec.ids); f.nutrientStatus[display]={status:nd?.arr?.[0]||'nd',reason:nd?.arr?.[1]||'Dato non disponibile nelle fonti compatibili',canonicalId:nd?.id||spec.ids[0],sources:nd?.arr?.[2]||[]};
    }
  }
  const srcMap=Object.fromEntries((manifest?.sources||[]).map(s=>[s.code,s]));
  f.sources=(row.sources||[]).map(code=>({id:newId(),name:srcMap[code]?.name||code,reference:`Master ${manifest?.runtime_version||'v1'} · ${code}`,quality:'primaria',version:srcMap[code]?.version||''}));
  f.notes=`NutriTrace Master DB ${manifest?.runtime_version||''}. ${Number(row.sc||0)} record sorgente compatibili. Grade A/B: alta-media evidenza; C: single-source/low confidence; D: informativo e escluso dalle carenze. I campi assenti sono N/D, non zero.`;
  f.mergeMeta={importedFrom:'MASTER',sourceCount:Number(row.sc||0),masterSources:row.sources||[]};
  return f;
}
function macroCoverage(logs,foods,key){
  let total=0,known=0;
  for(const l of logs||[]){const g=Math.max(0,Number(l.grams)||0),f=(foods||[]).find(x=>x.id===l.foodId);if(!f||!g)continue;total+=g;if(!isMissing(f.label?.[key]))known+=g;}
  return total?known/total:0;
}
function nutrientCoverage(logs,foods,name,mode='display'){
  let total=0,known=0;
  for(const l of logs||[]){
    const g=Math.max(0,Number(l.grams)||0), f=(foods||[]).find(x=>x.id===l.foodId); if(!f||!g)continue;
    total+=g;
    const candidates=(f.nutrients||[]).filter(n=>norm(n.name)===norm(name)&&Number.isFinite(Number(n.amount)));
    if(candidates.some(n=>mode!=='deficiency'||nutrientEligibleForDeficiency(n)))known+=g;
  }
  return total?known/total:0;
}
function nutrientTotalFromLogs(logs,foods,name,toUnit='mg',form='*',mode='display'){
  let sum=0;
  for(const l of logs||[]){
    const g=Math.max(0,Number(l.grams)||0), f=(foods||[]).find(x=>x.id===l.foodId); if(!f||!g)continue;
    const q=g/(Number(f.servingGrams)||100);
    for(const n of f.nutrients||[]){
      if(norm(n.name)!==norm(name)||!Number.isFinite(Number(n.amount)))continue;
      if(form!=='*'&&form&&norm(n.form)!==norm(form))continue;
      if(mode==='deficiency'&&!nutrientEligibleForDeficiency(n))continue;
      sum+=convert(Number(n.amount)*q,n.unit,toUnit);
    }
  }
  return sum;
}
function goalComponents(g){return Array.isArray(g?.components)&&g.components.length?g.components:[g?.name].filter(Boolean);}
function goalNutrientTotalFromLogs(logs,foods,g,mode='display'){
  return goalComponents(g).reduce((sum,name)=>sum+nutrientTotalFromLogs(logs,foods,name,g.unit,g.form||'*',mode),0);
}
function goalCoverageFromLogs(logs,foods,g,mode='display'){
  const names=goalComponents(g);if(!names.length)return 0;
  return Math.min(...names.map(name=>nutrientCoverage(logs,foods,name,mode)));
}
function goalValueFromAggregate(g,ag){
  if(Object.keys(MACROS).includes(g.id))return ag[g.id]||0;
  return goalComponents(g).reduce((sum,name)=>sum+nutrientTotal(ag,name,g.unit,g.form||'*'),0);
}
function goalDailyReference(g,weight){const t=effectiveTarget(g,weight);return g.period==='week'?t/7:t;}
function goalTargetForDays(g,weight,days){return goalDailyReference(g,weight)*Math.max(0,Number(days)||0);}
async function parseFoodEntry(text,context='diary'){
  const r=await fetch('/api/parse-food-entry',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text,context})}); let d={};try{d=await r.json();}catch{}
  if(!r.ok)throw new Error(d.error||`AI ${r.status}`); return d;
}

async function aiEnrich(food, requestedNames=[]){
  const requested=[...new Set(requestedNames)].map(name=>AI_NUTRIENT_SPECS[name]?{name,id:AI_NUTRIENT_SPECS[name].id,unit:AI_NUTRIENT_SPECS[name].unit,advanced:Boolean(AI_NUTRIENT_SPECS[name].advanced)}:null).filter(Boolean).slice(0,12);
  const r=await fetch('/api/nutrition-enrich',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({food:{name:food.name,brand:food.brand||'',servingGrams:Number(food.servingGrams)||100,label:food.label||{},nutrients:food.nutrients||[]},requested,allowAdvanced:requested.some(x=>x.advanced)})});
  let d={}; try{ d=await r.json(); }catch{}
  if(!r.ok) throw new Error(d.error||`AI ${r.status}`);
  return d;
}
function mergeAiFood(food, ai){
  const next=structuredClone(food); next.label={...next.label}; next.nutrientStatus={...(next.nutrientStatus||{})};
  for(const k of Object.keys(MACROS))if(isMissing(next.label[k])&&ai.label&&!isMissing(ai.label[k]))next.label[k]=ai.label[k];
  const existing=new Set((next.nutrients||[]).map(n=>norm(n.name)));next.nutrients=[...(next.nutrients||[])];
  for(const n of ai.nutrients||[]){
    const display=AI_ID_TO_DISPLAY[n.id],spec=display&&AI_NUTRIENT_SPECS[display];if(!display||!spec)continue;
    if(n.status==='blocked_high_risk'){
      next.nutrientStatus[display]={status:'blocked_high_risk',reason:n.note||`Errore ${display}: nutriente ad alto rischio; stima AI disabilitata.`,canonicalId:n.id};continue;
    }
    if(n.status==='error'){
      next.nutrientStatus[display]={status:'ai_error',reason:n.note||`Errore AI durante il completamento di ${display}.`,canonicalId:n.id};continue;
    }
    if(n.status!=='estimated'||!Number.isFinite(Number(n.value))){
      next.nutrientStatus[display]={status:'nd_ai',reason:n.note||'AI: dato non sufficientemente affidabile',canonicalId:n.id};continue;
    }
    if(existing.has(norm(display)))continue;
    next.nutrients.push({id:newId(),name:display,form:'stima AI controllata',amount:Number(n.value),unit:spec.unit,source:'AI · stima',evidence:`stima AI · confidenza ${n.confidence||'media'}${n.note?` · ${n.note}`:''}`,canonicalId:n.id,reliability:'ai_estimate',aiEstimate:true,grade:'AI',bio:{mode:'none',min:'',max:'',source:''}});
    next.nutrientStatus[display]={status:'ai_estimate',reliability:n.confidence||'media',canonicalId:n.id};existing.add(norm(display));
  }
  if((ai.nutrients||[]).length||Object.values(ai.label||{}).some(v=>v!==null&&v!==undefined)){
    const ref=ai.note||'Valori stimati; non equivalenti a dati analitici o di etichetta.';
    if(!(next.sources||[]).some(x=>x?.name==='AI · stima integrativa'&&x?.reference===ref))next.sources=[...(next.sources||[]),{id:newId(),name:'AI · stima integrativa',reference:ref,quality:'stimata'}];
  }
  return next;
}

function GoalRow({g,index,goals,setGoals,weight,current}){
  const patch=(x)=>{ const a=[...goals]; a[index]={...a[index],...x}; setGoals(a); };
  const amount=g.targetMode==='perKg'?g.perKg:g.target, custom=g.group==='Personalizzati';
  return h('div',{className:`goalRow ${custom?'customGoal':''}`},
    h('div',{className:'goalIdentity'},custom?h('input',{value:g.name,onChange:e=>patch({name:e.target.value}),placeholder:'Nome nutriente'}):h('b',null,g.name),h('small',null,`${fmt(current,2)} ${g.unit} registrati`)),
    h('input',{type:'number',step:'any',value:amount,onChange:e=>patch(g.targetMode==='perKg'?{perKg:Number(e.target.value)}:{target:Number(e.target.value)})}),
    h('select',{value:g.unit||'mg',onChange:e=>patch({unit:e.target.value})},h('option',{value:'g'},'g'),h('option',{value:'mg'},'mg'),h('option',{value:'µg'},'µg')),
    h('select',{value:g.targetMode||'absolute',onChange:e=>patch({targetMode:e.target.value})},h('option',{value:'absolute'},'Assoluto'),h('option',{value:'perKg'},'Per kg BW')),
    h('select',{value:g.kind||'minimum',onChange:e=>patch({kind:e.target.value})},h('option',{value:'minimum'},'Minimo'),h('option',{value:'target'},'Target'),h('option',{value:'upper'},'Massimo')),
    h('select',{value:g.period||'day',onChange:e=>patch({period:e.target.value})},h('option',{value:'day'},'Giorno'),h('option',{value:'week'},'Settimana')),
    h('span',{className:'goalComputed'},`→ ${fmt(effectiveTarget(g,weight),2)} ${g.unit}${g.period==='week'?` / settimana · ${fmt(goalDailyReference(g,weight),2)}/die`:''}${g.ul?` · UL ${fmt(g.ul,2)}/die`:''}${g.targetMode==='perKg'?` (${fmt(Number(g.perKg||0),3)} ${g.unit}/kg)`:''}`),
    g.group!=='Energia e macro'?h('button',{className:`pinBtn ${g.pinned?'pinned':''}`,title:g.pinned?'Rimuovi dai pinnati':'Pinna nel diario',onClick:()=>patch({pinned:!g.pinned})},g.pinned?'★':'☆'):null,
    custom?h('button',{className:'ghost danger',onClick:()=>setGoals(goals.filter(x=>x.id!==g.id))},'×'):null
  );
}

function CandidatePreviewModal({food,onClose}){
  const ndRows=Object.entries(food?.nutrientStatus||{}).filter(([,st])=>!['numeric','ai_estimate'].includes(st?.status));
  return h('div',{className:'modalBackdrop'},
    h('div',{className:'modal candidatePreviewModal'},
      h('div',{className:'modalHead'},
        h('div',null,
          h('span',{className:'eyebrow'},'DETTAGLIO DATABASE'),
          h('h2',null,food?.name||food?.officialName||'Alimento'),
          food?.officialName&&food.officialName!==food.name?h('p',{className:'muted'},food.officialName):null
        ),
        h('button',{className:'close',onClick:onClose},'×')
      ),
      h('div',{className:'previewMacroGrid'},
        ...Object.entries(MACROS).map(([k,label])=>h('div',{key:k},h('small',null,label),h('strong',null,fmtMaybe(food?.label?.[k],2))))
      ),
      h('h3',null,'Micronutrienti e componenti'),
      !(food?.nutrients||[]).length
        ?h('p',{className:'muted'},'Nessun micronutriente numerico disponibile nella scheda.')
        :h('div',{className:'previewNutrients'},
          ...(food.nutrients||[]).map(n=>h('div',{className:'previewNutrient',key:n.id||`${n.name}-${n.form}`},
            h('div',null,h('b',null,n.name),h('small',null,n.form||'')),
            h('strong',null,`${fmt(Number(n.amount),4)} ${n.unit}`),
            h('small',null,`${n.source||''}${n.grade?` · Grade ${n.grade}`:''}${n.evidence?` · ${n.evidence}`:''}`)
          ))
        ),
      ndRows.length?h('details',{className:'previewNd'},
        h('summary',null,'Campi N/D / non disponibili'),
        h('div',null,...ndRows.map(([name,st])=>h('div',{className:'previewNdRow',key:name},h('b',null,name),h('span',null,st?.reason||st?.status||'N/D'))))
      ):null,
      (food?.sources||[]).length?h('details',{className:'previewSources'},
        h('summary',null,'Fonti e provenienza'),
        h('div',null,...(food.sources||[]).map((src,i)=>h('div',{className:'previewSourceRow',key:src?.id||i},h('b',null,src?.name||String(src)),h('small',null,src?.reference||''))))
      ):null,
      h('div',{className:'modalActions'},h('button',{className:'cta',onClick:onClose},'Chiudi'))
    )
  );
}

function Home(){
  const [foods,setFoods]=useState([]), [logs,setLogs]=useState([]), [goals,setGoals]=useState(buildDefaultGoals()), [profile,setProfile]=useState(structuredClone(DEFAULT_PROFILE));
  const [tab,setTab]=useState('oggi'), [foodDraft,setFoodDraft]=useState(null), [grams,setGrams]=useState(''), [loaded,setLoaded]=useState(false);
  const [query,setQuery]=useState(''), [results,setResults]=useState([]), [searchError,setSearchError]=useState(''), [searching,setSearching]=useState(false);
  const [quickQuery,setQuickQuery]=useState(''), [datasetMsg,setDatasetMsg]=useState(''), [datasets,setDatasets]=useState({}), [datasetMeta,setDatasetMeta]=useState([]), [newDatasetName,setNewDatasetName]=useState('CREA Italia'), [newDatasetFile,setNewDatasetFile]=useState(null);
  const [aiBusy,setAiBusy]=useState(''), [aiMsg,setAiMsg]=useState('');
  const [deviceToday,setDeviceToday]=useState(dateKey()), [selectedDate,setSelectedDate]=useState(dateKey());
  const [masterManifest,setMasterManifest]=useState(null), [masterIndex,setMasterIndex]=useState([]), [masterStatus,setMasterStatus]=useState('Caricamento Master DB…'), [masterOfflineMsg,setMasterOfflineMsg]=useState('');
  const [recipeText,setRecipeText]=useState(''), [recipeReview,setRecipeReview]=useState(null), [recipeBusy,setRecipeBusy]=useState(''), [recipeMsg,setRecipeMsg]=useState('');
  const [showAllDeficits,setShowAllDeficits]=useState(false), [masterMigrationDone,setMasterMigrationDone]=useState(false);
  const [appConfig,setAppConfig]=useState(DEFAULT_APP_CONFIG);
  const [quickSearchQuery,setQuickSearchQuery]=useState('');
  const [candidateBrowserIndex,setCandidateBrowserIndex]=useState(null), [candidatePreview,setCandidatePreview]=useState(null), [candidatePreviewBusy,setCandidatePreviewBusy]=useState(false);
  const [reportMode,setReportMode]=useState('week'), [reportAnchor,setReportAnchor]=useState(dateKey()), [reportFrom,setReportFrom]=useState(dateKey()), [reportTo,setReportTo]=useState(dateKey());

  useEffect(()=>{ try{
    setFoods(JSON.parse(localStorage.getItem('nutritrace_foods')||'[]'));
    setLogs(JSON.parse(localStorage.getItem('nutritrace_logs')||'[]'));
    setGoals(mergeGoalCatalog(JSON.parse(localStorage.getItem('nutritrace_goals_v23')||'null')));
    setProfile(normalizeProfile(JSON.parse(localStorage.getItem('nutritrace_profile_v23')||'null')));
    let meta=JSON.parse(localStorage.getItem('nutritrace_dataset_meta_v4')||'[]');
    (async()=>{
      if(localStorage.getItem('nutritrace_dataset_migration_v4')!=='1'){
        for(const legacy of [{id:'CIQUAL',name:'ANSES-CIQUAL'},{id:'FRIDA',name:'FRIDA / DTU Food Institute'},{id:'COFID',name:'UK CoFID'}]){
          const rows=await dbGet(legacy.id);
          if(rows.length && !meta.some(m=>m.id===legacy.id)) meta.push({id:legacy.id,name:legacy.name,fileName:'migrato dalla v1.1',count:rows.length,version:SOURCE_META[legacy.id]?.version||'legacy'});
        }
        await Promise.allSettled(['USDA_FOUNDATION','USDA_SR','USDA_BRANDED'].map(dbDel));
        localStorage.removeItem('nutritrace_usda_key'); localStorage.removeItem('nutritrace_commercial_online');
        localStorage.setItem('nutritrace_dataset_migration_v4','1');
      }
      setDatasetMeta(meta);
      const obj={}; for(const m of meta){ SOURCE_META[m.id]={name:m.name,version:m.version||'importato',mode:'local',official:false,scientific:true}; obj[m.id]=await dbGet(m.id); } setDatasets(obj);
    })();
  } finally { setLoaded(true); }
  if('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(()=>{});
  },[]);
  useEffect(()=>{let alive=true;loadAppConfig().then(c=>{if(alive)setAppConfig(c||DEFAULT_APP_CONFIG)});return()=>{alive=false};},[]);
  useEffect(()=>{const t=setTimeout(()=>setQuickSearchQuery(quickQuery),220);return()=>clearTimeout(t);},[quickQuery]);
  useEffect(()=>{ let alive=true; loadMasterBundle().then(({manifest,index})=>{ if(!alive)return; setMasterManifest(manifest); setMasterIndex(index); setMasterStatus(`${Number(manifest.food_count||index.length).toLocaleString('it-IT')} alimenti · Runtime ${manifest.runtime_version||'v1'} auditato pronto`); }).catch(e=>alive&&setMasterStatus(`Master DB non disponibile: ${e.message}`)); return()=>{alive=false}; },[]);
  useEffect(()=>{ if(!loaded||!masterManifest||!masterIndex.length||masterMigrationDone)return; let alive=true; (async()=>{
    const byId=new Map(masterIndex.map(r=>[String(r.id),r])); const stale=foods.filter(f=>f.mergeMeta?.importedFrom==='MASTER'&&f.masterId&&String(f.masterVersion||'')!==String(masterManifest.runtime_version||masterManifest.schema||''));
    if(!stale.length){if(alive)setMasterMigrationDone(true);return;}
    const refreshed=new Map();
    for(const old of stale){const row=byId.get(String(old.masterId));if(!row)continue;try{const detail=await loadMasterDetail(row);if(detail){const nf=masterToFood(row,detail,masterManifest,old.name);nf.id=old.id;refreshed.set(old.id,nf);}}catch{}}
    if(alive&&refreshed.size)setFoods(cur=>cur.map(f=>refreshed.get(f.id)||f));
    if(alive)setMasterMigrationDone(true);
  })(); return()=>{alive=false}; },[loaded,masterManifest,masterIndex,masterMigrationDone]);
  useEffect(()=>{ if(loaded) localStorage.setItem('nutritrace_foods',JSON.stringify(foods)); },[foods,loaded]);
  useEffect(()=>{ if(loaded) localStorage.setItem('nutritrace_logs',JSON.stringify(logs)); },[logs,loaded]);
  useEffect(()=>{ if(loaded) localStorage.setItem('nutritrace_goals_v23',JSON.stringify(goals)); },[goals,loaded]);
  useEffect(()=>{ if(loaded) localStorage.setItem('nutritrace_profile_v23',JSON.stringify(profile)); },[profile,loaded]);
  useEffect(()=>{ if(loaded) localStorage.setItem('nutritrace_dataset_meta_v4',JSON.stringify(datasetMeta)); },[datasetMeta,loaded]);
  useEffect(()=>{ const sync=()=>{ const now=dateKey(); if(now!==deviceToday){ setSelectedDate(d=>d===deviceToday?now:d); setDeviceToday(now); } }; const t=setInterval(sync,30000); document.addEventListener('visibilitychange',sync); return()=>{clearInterval(t);document.removeEventListener('visibilitychange',sync)}; },[deviceToday]);

  const dayLogs=useMemo(()=>logs.filter(l=>l.date===selectedDate),[logs,selectedDate]);
  const [weekStart,weekEnd]=useMemo(()=>weekBounds(selectedDate),[selectedDate]);
  const weekLogs=useMemo(()=>logs.filter(l=>l.date>=weekStart&&l.date<=weekEnd),[logs,weekStart,weekEnd]);
  const totals=useMemo(()=>aggregate(dayLogs,foods),[dayLogs,foods]), weekTotals=useMemo(()=>aggregate(weekLogs,foods),[weekLogs,foods]);
  const recentIds=useMemo(()=>[...logs].reverse().map(l=>l.foodId).filter((id,i,a)=>a.indexOf(id)===i).slice(0,6),[logs]);
  const quickSuggestions=useMemo(()=>{
    const q=quickSearchQuery.trim();
    if(!q)return recentIds.map(id=>foods.find(f=>f.id===id)).filter(Boolean).map(f=>({...f,resultType:'personal'}));
    if(norm(q).length<2)return [];
    const personal=searchPersonalFoods(q,foods,4);
    const master=searchMasterIndex(q,masterIndex,8);
    const local=searchLocalDataset(q,datasets,4).map(f=>({...f,resultType:'local'}));
    return [...personal,...master,...local].slice(0,10);
  },[quickSearchQuery,foods,datasets,recentIds,masterIndex]);
  const macroPreview=useMemo(()=>computeMacroPlan(profile),[profile]);
  const pinnedGoals=goals.filter(g=>g.group!=='Energia e macro'&&g.pinned);
  const trackedWeekDays=useMemo(()=>new Set(weekLogs.map(l=>l.date)).size,[weekLogs]);
  const weeklyDeficits=useMemo(()=>{
    const list=[];
    // Unlogged days are unknown, not zero: daily goals are compared only with days that contain diary entries.
    // Weekly goals are prorated by the same tracked-day fraction until a complete 7-day week is available.
    const tracked=Math.max(0,trackedWeekDays);
    for(const g of goals){
      if(g.group==='Energia e macro'||g.kind==='upper')continue;
      const one=effectiveTarget(g,profile.weight); if(!(one>0)||tracked===0)continue;
      const target=goalTargetForDays(g,profile.weight,tracked), current=goalNutrientTotalFromLogs(weekLogs,foods,g,'deficiency'), coverage=goalCoverageFromLogs(weekLogs,foods,g,'deficiency');
      const dataSufficient=coverage>=.65, deficit=dataSufficient?Math.max(0,1-current/target):null;
      list.push({g,target,current,coverage,dataSufficient,deficit,trackedDays:tracked});
    }
    return list.sort((a,b)=>Number(b.dataSufficient)-Number(a.dataSufficient)||(b.deficit??-1)-(a.deficit??-1)||a.g.name.localeCompare(b.g.name,'it'));
  },[goals,weekTotals,weekLogs,foods,profile.weight,trackedWeekDays]);
  const topDeficits=weeklyDeficits.filter(x=>x.dataSufficient&&x.deficit>0).slice(0,6);
  const reportRange=useMemo(()=>{
    if(reportMode==='day')return[reportAnchor,reportAnchor];
    if(reportMode==='week')return weekBounds(reportAnchor);
    if(reportMode==='month')return monthBounds(reportAnchor);
    if(reportMode==='year')return yearBounds(reportAnchor);
    const a=reportFrom<=reportTo?reportFrom:reportTo,b=reportFrom<=reportTo?reportTo:reportFrom;return[a,b];
  },[reportMode,reportAnchor,reportFrom,reportTo]);
  const reportLogs=useMemo(()=>logs.filter(l=>l.date>=reportRange[0]&&l.date<=reportRange[1]),[logs,reportRange[0],reportRange[1]]);
  const reportTrackedDays=useMemo(()=>new Set(reportLogs.map(l=>l.date)).size,[reportLogs]);
  const reportTotals=useMemo(()=>aggregate(reportLogs,foods),[reportLogs,foods]);
  const reportAvg=useMemo(()=>{const d=Math.max(1,reportTrackedDays),o={};for(const k of Object.keys(MACROS))o[k]=(reportTotals[k]||0)/d;return o;},[reportTotals,reportTrackedDays]);
  const previousReportRange=useMemo(()=>previousRange(reportRange[0],reportRange[1]),[reportRange[0],reportRange[1]]);
  const previousReportLogs=useMemo(()=>logs.filter(l=>l.date>=previousReportRange[0]&&l.date<=previousReportRange[1]),[logs,previousReportRange[0],previousReportRange[1]]);
  const previousTrackedDays=useMemo(()=>new Set(previousReportLogs.map(l=>l.date)).size,[previousReportLogs]);
  const previousTotals=useMemo(()=>aggregate(previousReportLogs,foods),[previousReportLogs,foods]);
  const previousAvg=useMemo(()=>{const d=Math.max(1,previousTrackedDays),o={};for(const k of Object.keys(MACROS))o[k]=(previousTotals[k]||0)/d;return o;},[previousTotals,previousTrackedDays]);
  const reportGoalStats=useMemo(()=>goals.filter(g=>g.group!=='Energia e macro'&&effectiveTarget(g,profile.weight)>0).map(g=>{
    const coverage=goalCoverageFromLogs(reportLogs,foods,g,'deficiency'),current=goalNutrientTotalFromLogs(reportLogs,foods,g,'deficiency'),target=goalTargetForDays(g,profile.weight,reportTrackedDays);
    const pct=target>0?current/target:null,ulTotal=g.ul?Number(g.ul)*Math.max(1,reportTrackedDays):null;
    const status=coverage<.65?'insufficient':ulTotal&&current>ulTotal?'high':pct!==null&&pct<.8?'low':'adequate';
    return{g,coverage,current,target,pct,ulTotal,status};
  }).sort((a,b)=>({low:0,high:1,adequate:2,insufficient:3}[a.status]-({low:0,high:1,adequate:2,insufficient:3}[b.status]))||a.g.name.localeCompare(b.g.name,'it')),[goals,profile.weight,reportLogs,foods,reportTrackedDays]);
  const reportHistory=useMemo(()=>{
    const weekMap=new Map(),monthMap=new Map(),yearMap=new Map();
    for(const l of logs){
      const [ws,we]=weekBounds(l.date),mk=l.date.slice(0,7),yk=l.date.slice(0,4);
      if(!weekMap.has(ws))weekMap.set(ws,{from:ws,to:we,dates:new Set(),count:0});const w=weekMap.get(ws);w.dates.add(l.date);w.count++;
      if(!monthMap.has(mk)){const [a,b]=monthBounds(`${mk}-01`);monthMap.set(mk,{from:a,to:b,dates:new Set(),count:0});}const m=monthMap.get(mk);m.dates.add(l.date);m.count++;
      if(!yearMap.has(yk))yearMap.set(yk,{from:`${yk}-01-01`,to:`${yk}-12-31`,dates:new Set(),count:0});const y=yearMap.get(yk);y.dates.add(l.date);y.count++;
    }
    const finish=map=>[...map.values()].map(x=>({...x,trackedDays:x.dates.size})).sort((a,b)=>b.from.localeCompare(a.from));
    return{weeks:finish(weekMap).slice(0,26),months:finish(monthMap).slice(0,24),years:finish(yearMap)};
  },[logs]);
  const masterSources=masterManifest?.sources||[];
  const includedMasterSources=masterSources.filter(x=>x.inclusion_status==='included'||!x.inclusion_status);
  const validationOnlySources=masterSources.filter(x=>x.inclusion_status==='validation_only');
  const missingMasterSources=masterSources.filter(x=>x.inclusion_status==='missing_input');
  const draftNdRows=foodDraft?Object.entries(foodDraft.nutrientStatus||{}).filter(([,x])=>!['numeric','ai_estimate'].includes(x?.status)):[];
  const ui=(path,fallback)=>cfgGet(appConfig?.ui,path,fallback);

  function valueForGoal(g,ag){ const v=goalValueFromAggregate(g,ag); if(v===0&&g.name==='Sodio'&&ag.salt>0)return convert(ag.salt/2.5,'g',g.unit); return v; }
  function saveFood(){ if(!foodDraft?.name?.trim()) return; const f={...foodDraft,additives:parseAdditives(foodDraft.ingredients)}; setFoods(p=>[...p.filter(x=>x.id!==f.id),f]); setFoodDraft(null); }
  function removeFood(id){ const f=foods.find(x=>x.id===id); if(!f) return; const n=logs.filter(l=>l.foodId===id).length; if(!confirm(`Rimuovere “${f.name}” dall'archivio?${n?` Verranno eliminate anche ${n} registrazioni del diario.`:''}`)) return; setFoods(p=>p.filter(x=>x.id!==id)); setLogs(p=>p.filter(l=>l.foodId!==id)); }
  function addFoodLog(foodId,g=grams,extra={}){ if(!foodId||Number(g)<=0) return; setLogs(p=>[...p,{id:newId(),date:selectedDate,foodId,grams:Number(g),...extra}]); }
  async function masterFoodFromResult(r,alias=''){
    const existing=foods.find(f=>String(f.masterId||'')===String(r.id)); if(existing)return existing;
    const detail=await loadMasterDetail(r); if(!detail)throw new Error('Dettaglio alimento Master DB non trovato.');
    return masterToFood(r,detail,masterManifest,alias);
  }
  async function quickAdd(r){
    let useGrams=Number(grams); let portion=null;
    if(!(useGrams>0)){portion=findPortionCatalog([quickQuery,r?.name],appConfig,'',countFromText(quickQuery)||1);if(portion)useGrams=portion.grams;}
    if(!(useGrams>0)){setAiMsg('Peso non definito: indica i grammi oppure usa “Ricerca con AI” per una porzione naturale/standard.');return;}
    if(r.resultType==='personal'){addFoodLog(r.id,useGrams,portion?{portionAssumption:portion.assumption}:{});setQuickQuery('');setGrams('');if(portion)setAiMsg(`Porzione standard applicata: ${portion.assumption}.`);return;}
    if(r.resultType==='master'){
      try{setRecipeBusy('quick');const existing=foods.find(f=>String(f.masterId||'')===String(r.id));const f=existing||await masterFoodFromResult(r,quickQuery||r.name);if(!existing)setFoods(p=>[...p,f]);setLogs(p=>[...p,{id:newId(),date:selectedDate,foodId:f.id,grams:useGrams,...(portion?{portionAssumption:portion.assumption}:{})}]);setQuickQuery('');setGrams('');if(portion)setAiMsg(`Porzione standard applicata: ${portion.assumption}.`);}catch(e){setAiMsg(e.message)}finally{setRecipeBusy('')};return;
    }
    const f=materializeImported(r,quickQuery||r.name); setFoods(p=>[...p,f]); setLogs(p=>[...p,{id:newId(),date:selectedDate,foodId:f.id,grams:useGrams,...(portion?{portionAssumption:portion.assumption}:{})}]); setQuickQuery('');setGrams('');if(portion)setAiMsg(`Porzione standard applicata: ${portion.assumption}.`);
  }
  function materializeImported(f,alias=''){ const source=f.sourceInfo||f.source; const useAlias=alias.trim(); return {...emptyFood(),source:f.source||'',sourceId:f.sourceId||'',name:useAlias?alias.trim():f.name,officialName:f.officialName||f.name,aliases:[...new Set([...(f.aliases||[]),...(useAlias?[alias.trim()]:[])])],brand:f.brand||'',servingGrams:f.servingGrams||100,label:f.label||emptyFood().label,ingredients:f.ingredients||'',nutrients:f.nutrients||[],sources:[source],mergeMeta:{importedFrom:f.source||source?.name}}; }
  function openImported(f,alias=query){ const same=foods.find(z=>(z.sourceId&&z.sourceId===f.sourceId)||(norm(z.name)===norm(f.name)&&norm(z.brand||'')===norm(f.brand||''))); if(same) setFoodDraft({...structuredClone(same),mergeMeta:{mode:'review',candidate:f}}); else setFoodDraft(materializeImported(f,alias)); setTab('alimenti'); }
  async function openResult(r,alias=query){
    if(r.resultType!=='master'){openImported(r,alias);return;}
    setSearching(true);setSearchError('');try{const existing=foods.find(f=>String(f.masterId||'')===String(r.id));setFoodDraft(existing?structuredClone(existing):await masterFoodFromResult(r,alias));setTab('alimenti');}catch(e){setSearchError(e.message)}finally{setSearching(false)}
  }
  async function searchFoods(){ if(!query.trim()) return; setSearching(true); setSearchError(''); try{ const master=searchMasterIndex(query,masterIndex,30); const local=searchLocalDataset(query,datasets,12).map(f=>({...f,resultType:'local'})); setResults([...master,...local].slice(0,40)); if(!master.length&&!local.length) setSearchError(ui('search.notFound','Nessun risultato nel Master DB o nei database personali.')); } finally{ setSearching(false); } }
  async function createWithAI(name){ setAiBusy('search'); setAiMsg(''); try{ let f={...emptyFood(),name:name.trim(),aliases:[name.trim()]}; const ai=await aiEnrich(f,SAFE_AI_DEFAULT); f=mergeAiFood(f,ai); for(const x of MICRO_CATALOG) if(!f.nutrientStatus[x.name])f.nutrientStatus[x.name]={status:'nd',reason:'N/D: non stimato in assenza di una fonte strutturata'}; setFoodDraft(f); setTab('alimenti'); }catch(e){ setAiMsg(e.message); }finally{ setAiBusy(''); } }
  async function enrichDraft(){
    if(!foodDraft?.name)return;setAiBusy('draft');setAiMsg('');
    const selected=[...new Set(foodDraft.aiRequested||[])],batches=[];for(let i=0;i<selected.length;i+=10)batches.push(selected.slice(i,i+10));
    // Even with no micro selected, run one request so missing macros can be completed.
    if(!batches.length)batches.push([]);
    let next=structuredClone(foodDraft),failures=[];
    try{
      for(let bi=0;bi<batches.length;bi++){
        const batch=batches[bi];setAiMsg(batches.length>1?`Completamento AI: blocco ${bi+1}/${batches.length}…`: 'Completamento AI…');
        try{next=mergeAiFood(next,await aiEnrich(next,batch));}
        catch(e){
          failures.push(...batch);
          next.nutrientStatus={...(next.nutrientStatus||{})};
          for(const name of batch){const spec=AI_NUTRIENT_SPECS[name];next.nutrientStatus[name]={status:'ai_error',reason:`Errore ${name}: ${e.message}`,canonicalId:spec?.id||''};}
          if(!batch.length)throw e;
        }
      }
      next.aiRequested=failures;setFoodDraft(next);
      setAiMsg(failures.length?`Completamento parziale: ${failures.length} nutrienti non completati. Puoi ritentare solo quelli rimasti selezionati.`:'Completamento terminato. Le stime AI restano escluse dal calcolo delle carenze.');
    }catch(e){setAiMsg(e.message)}finally{setAiBusy('')}
  }
  function toggleAiRequest(name){const a=[...(foodDraft.aiRequested||[])],i=a.indexOf(name);if(i>=0)a.splice(i,1);else a.push(name);setFoodDraft({...foodDraft,aiRequested:a});}
  function ingredientCandidates(ingredient,ambiguity='none'){
    const ing=typeof ingredient==='string'?{name:ingredient}:ingredient||{};
    const queries=semanticLookupQueries(ing);
    const policy=cfgGet(appConfig,'searchPolicy.databaseMatchPolicy',{});
    const byKey=new Map();
    for(const q of queries){
      for(const x of searchPersonalFoods(q,foods,5)){
        const candidate={...x,candidateKey:`p:${x.id}`,matchedQuery:q};const prev=byKey.get(candidate.candidateKey);if(!prev||candidate.score>prev.score)byKey.set(candidate.candidateKey,candidate);
      }
      for(const x of searchMasterIndex(q,masterIndex,8)){
        const candidate={...x,candidateKey:`m:${x.id}`,matchedQuery:q};const prev=byKey.get(candidate.candidateKey);if(!prev||candidate.score>prev.score)byKey.set(candidate.candidateKey,candidate);
      }
    }
    let candidates=[...byKey.values()];
    if(policy.requireLexicalEvidence!==false)candidates=candidates.filter(c=>candidateSemanticGate(ing,c,c.matchedQuery));
    const minScore=Number(policy.minCandidateScore??42);
    candidates=candidates.filter(c=>Number(c.score)>=minScore).sort((a,b)=>b.score-a.score).slice(0,8);
    let selectedKey='';
    const materialAmbiguity=(ambiguity||ing.ambiguity)==='needs_detail';
    if(!materialAmbiguity&&candidates.length){
      const top=candidates[0],second=candidates[1],exact=queries.some(q=>candidateExactSemanticMatch(q,top));
      const minAuto=Number(policy.minAutoSelectScore??92),gap=Number(policy.minAutoSelectGap??14);
      if(exact || (top.score>=minAuto&&(!second||top.score-second.score>=gap)))selectedKey=top.candidateKey;
    }
    return {candidates,selectedKey};
  }
  async function interpretText(text,context='diary'){
    const parsed=await parseFoodEntry(text,context);
    const ingredients=(parsed.ingredients||[]).map(x=>{
      const weighted=applyPortionPolicy(x,appConfig);
      return {...weighted,...ingredientCandidates(weighted,weighted.ambiguity)};
    });
    const unresolvedErrors=(parsed.errors||[]).filter(err=>!ingredients.some(ing=>Number(ing.grams)>0&&String(err).toLowerCase().includes(String(ing.name||'').toLowerCase())));
    const mode=parsed.mode==='recipe'?'recipe':ingredients.length>1?'multi':'single';
    return {...parsed,mode,ingredients,errors:unresolvedErrors,yieldOverride:parsed.final_recipe_weight_g||''};
  }
  async function interpretRecipe(){
    if(!recipeText.trim())return;setRecipeBusy('parse');setRecipeMsg('');setRecipeReview(null);
    try{const review=await interpretText(recipeText,'recipe');setRecipeReview(review);if(review.errors?.length)setRecipeMsg(review.errors.join(' · '));}
    catch(e){setRecipeMsg(e.message)}finally{setRecipeBusy('')}
  }
  async function quickSearchWithAI(){
    if(!quickQuery.trim())return;setRecipeBusy('parse');setRecipeMsg('');setRecipeReview(null);try{const review=await interpretText(quickQuery,'quick');setRecipeText(quickQuery);setRecipeReview(review);if(review.errors?.length)setRecipeMsg(review.errors.join(' · '));}catch(e){setRecipeMsg(e.message)}finally{setRecipeBusy('')}
  }
  async function searchFoodsWithAI(){
    if(!query.trim())return;setAiBusy('search-ai');setAiMsg('');setSearchError('');
    try{
      const review=await interpretText(query,'search');const ing=review.ingredients?.[0];if(!ing)throw new Error('L’AI non ha individuato un alimento.');
      const queries=semanticLookupQueries(ing);
      const byKey=new Map();
      for(const q of queries){
        for(const r0 of searchMasterIndex(q,masterIndex,30)){const r={...r0,matchedQuery:q},k=`m:${r.id}`,prev=byKey.get(k);if(!prev||r.score>prev.score)byKey.set(k,r);}
        for(const r0 of searchLocalDataset(q,datasets,12)){const r={...r0,resultType:'local',matchedQuery:q},k=`l:${r.localId||r.sourceId||r.id}`,prev=byKey.get(k);if(!prev||r.score>prev.score)byKey.set(k,r);}
      }
      const policy=cfgGet(appConfig,'searchPolicy.databaseMatchPolicy',{});
      let found=[...byKey.values()];
      if(policy.requireLexicalEvidence!==false)found=found.filter(r=>candidateSemanticGate(ing,r,r.matchedQuery));
      found=found.filter(r=>Number(r.score)>=Number(policy.minCandidateScore??42)).sort((a,b)=>b.score-a.score).slice(0,40);
      setResults(found);
      const assumption=ing.portion_assumption;setAiMsg(`Interpretato come “${ing.name}”${assumption?` · ${assumption}`:''}.`);
      if(!found.length)setSearchError('Alimento interpretato, ma nessuna corrispondenza database sufficientemente affidabile.');
    }catch(e){setSearchError(e.message)}finally{setAiBusy('')}
  }
  function updateRecipeIngredient(i,patch){const rr=structuredClone(recipeReview);rr.ingredients[i]={...rr.ingredients[i],...patch};setRecipeReview(rr);}
  function rerunRecipeCandidates(i){const ing=recipeReview.ingredients[i],r=ingredientCandidates(ing,'none');updateRecipeIngredient(i,r);setCandidateBrowserIndex(i);}
  async function previewCandidate(c,alias=''){
    if(!c)return;setCandidatePreviewBusy(true);setRecipeMsg('');
    try{
      if(c.resultType==='master'){
        const detail=await loadMasterDetail(c);if(!detail)throw new Error('Dettaglio Master DB non disponibile.');
        setCandidatePreview(masterToFood(c,detail,masterManifest,alias||c.name));
      }else setCandidatePreview(structuredClone(c));
    }catch(e){setRecipeMsg(e.message)}finally{setCandidatePreviewBusy(false)}
  }
  async function estimateRecipeIngredient(i){
    const ing=recipeReview.ingredients[i];setRecipeBusy(`ai-${i}`);setRecipeMsg('');
    try{
      const parsed=await parseFoodEntry(ing.name,'search');const raw=parsed.ingredients?.[0];if(!raw)throw new Error('L’AI non ha reinterpretato l’alimento.');
      const weighted=applyPortionPolicy({...ing,...raw,grams:ing.grams||raw.grams},appConfig);const match=ingredientCandidates(weighted,weighted.ambiguity);
      updateRecipeIngredient(i,{...weighted,...match});
      if(!match.candidates.length)setRecipeMsg(`AI: “${weighted.name}” interpretato, ma nessuna corrispondenza DB affidabile.`);
    }catch(e){setRecipeMsg(e.message)}finally{setRecipeBusy('')}
  }
  async function commitRecipe(){
    if(!recipeReview)return;setRecipeBusy('commit');setRecipeMsg('');
    try{
      const bad=recipeReview.ingredients.filter(x=>!(Number(x.grams)>0)||!x.selectedKey||x.ambiguity==='needs_detail');
      if(bad.length)throw new Error('Completa il peso e seleziona una corrispondenza database affidabile per ogni alimento evidenziato.');
      const isRecipe=recipeReview.mode==='recipe';
      const ingredientSum=recipeReview.ingredients.reduce((a,x)=>a+Number(x.grams),0);
      let factor=1,consumed=ingredientSum,groupId=null;
      if(isRecipe){
        const yieldG=Number(recipeReview.yieldOverride)||ingredientSum;consumed=Number(recipeReview.consumed_grams)||yieldG;
        if(!(yieldG>0)||!(consumed>0))throw new Error('Peso totale/porzione non valido.');
        factor=consumed/yieldG;groupId=newId();
      }
      const created=[],newLogs=[];
      for(const ing of recipeReview.ingredients){
        let f;
        if(ing.selectedKey.startsWith('p:'))f=foods.find(x=>x.id===ing.selectedKey.slice(2))||created.find(x=>x.id===ing.selectedKey.slice(2));
        else {
          const id=Number(ing.selectedKey.slice(2)),row=(ing.candidates||[]).find(x=>Number(x.id)===id)||masterIndex.find(x=>Number(x.id)===id);
          f=foods.find(x=>String(x.masterId||'')===String(id))||created.find(x=>String(x.masterId||'')===String(id));
          if(!f){if(!row)throw new Error(`Corrispondenza Master non trovata: ${ing.name}`);const detail=await loadMasterDetail(row);f=masterToFood(row,detail,masterManifest,ing.name);created.push(f);}
        }
        if(!f)throw new Error(`Alimento non risolto: ${ing.name}`);
        newLogs.push({id:newId(),date:selectedDate,foodId:f.id,grams:Number(ing.grams)*factor,...(isRecipe?{recipeGroupId:groupId,recipeName:recipeReview.recipe_name||'Ricetta',recipeIngredient:ing.name}:{}),...(ing.portion_assumption?{portionAssumption:ing.portion_assumption}:{})});
      }
      if(created.length)setFoods(p=>[...p,...created.filter(f=>!p.some(x=>x.id===f.id||String(x.masterId||'')===String(f.masterId||'')))]);
      setLogs(p=>[...p,...newLogs]);setRecipeText('');setRecipeReview(null);
      setRecipeMsg(isRecipe?`Ricetta aggiunta: ${fmt(consumed)} g registrati nel giorno selezionato.`:newLogs.length>1?`Alimenti aggiunti: ${newLogs.length} voci registrate nel giorno selezionato.`:'Alimento aggiunto nel giorno selezionato.');
    }catch(e){setRecipeMsg(e.message)}finally{setRecipeBusy('')}
  }
  async function downloadMasterOffline(){
    if(!masterManifest||!('caches' in window)){setMasterOfflineMsg('Cache offline non disponibile in questo browser.');return;}
    const count=Number(masterManifest.chunk_count||0),cache=await caches.open('nutrichat-v23-runtime');
    try{
      if(navigator.storage?.persist) navigator.storage.persist().catch(()=>{});
      for(let i=0;i<count;i++){
        setMasterOfflineMsg(`Download Master offline ${i+1}/${count}…`);
        const url=`${MASTER_BASE}/chunks/${String(i).padStart(2,'0')}.json`,r=await fetch(url,{cache:'no-cache'});if(!r.ok)throw new Error(`chunk ${i}`);await cache.put(url,r.clone());
      }
      setMasterOfflineMsg(`Master DB completo disponibile offline · ${count} chunk.`);
    }catch(e){setMasterOfflineMsg(`Download offline incompleto: ${e.message}. Puoi riprovare; i chunk già salvati restano in cache.`);}
  }
  function applyMacroPlan(){ const p=macroPreview; setProfile(x=>({...x,macroPlan:{...x.macroPlan,perKg:{...x.macroPlan.perKg,...p.perKg}}})); setGoals(gs=>gs.map(g=>g.id==='kcal'?{...g,target:p.kcal,targetMode:'absolute'}:['protein','carbs','fat','sugar','fiber'].includes(g.id)?{...g,perKg:p.perKg[g.id],target:p.grams[g.id],targetMode:'perKg'}:g)); }
  function exportData(){ const b=new Blob([JSON.stringify({version:4,foods,logs,goals,profile},null,2)],{type:'application/json'}),u=URL.createObjectURL(b),a=document.createElement('a'); a.href=u; a.download=`nutritrace-${dateKey()}.json`; a.click(); URL.revokeObjectURL(u); }
  function importBackup(e){ const f=e.target.files?.[0]; if(!f)return; const rd=new FileReader(); rd.onload=()=>{ try{ const d=JSON.parse(rd.result); if(d.foods)setFoods(d.foods); if(d.logs)setLogs(d.logs); if(d.goals)setGoals(mergeGoalCatalog(d.goals)); if(d.profile)setProfile(normalizeProfile(d.profile)); }catch{ alert('Backup non valido'); } }; rd.readAsText(f); }
  async function importCustomDataset(){ if(!newDatasetName.trim()||!newDatasetFile){ setDatasetMsg('Inserisci un nome e seleziona un file.'); return; } const id=`CUSTOM_${Date.now()}`; SOURCE_META[id]={name:newDatasetName.trim(),version:'importato',mode:'local',official:false,scientific:true}; setDatasetMsg(`Importazione ${newDatasetName.trim()}…`); try{ const buf=await newDatasetFile.arrayBuffer(), lower=newDatasetFile.name.toLowerCase(); let normalized=[]; if(lower.endsWith('.json')||lower.endsWith('.jsonl')) normalized=parseJsonDataset(id,new TextDecoder().decode(buf)); else { const rows=parseSheetRows(buf,'array'); normalized=looksLikeCreaFlat(rows)?normalizeCreaFlat(id,rows):normalizeRows(id,rows); } if(!normalized.length) throw new Error('Formato non riconosciuto o nessun alimento trovato. Sono supportati CSV/XLSX/ODS e JSON/JSONL, incluso il formato CREA esportato.'); await dbSet(id,normalized); setDatasets(d=>({...d,[id]:normalized})); setDatasetMeta(m=>[...m,{id,name:newDatasetName.trim(),fileName:newDatasetFile.name,count:normalized.length,version:'importato'}]); setDatasetMsg(`${newDatasetName.trim()}: ${normalized.length} alimenti disponibili offline.`); setNewDatasetFile(null); }catch(e){ setDatasetMsg(`Errore: ${e.message}`); } }
  async function removeDataset(id){ const m=datasetMeta.find(x=>x.id===id); if(!confirm(`Rimuovere il database “${m?.name||id}” dal dispositivo?`)) return; await dbDel(id); setDatasets(d=>{const x={...d};delete x[id];return x}); setDatasetMeta(x=>x.filter(m=>m.id!==id)); setDatasetMsg('Database rimosso.'); }
  const addNutrient=()=>setFoodDraft({...foodDraft,nutrients:[...(foodDraft.nutrients||[]),emptyNutrient()]});
  function editNutrient(i,patch){ const a=[...foodDraft.nutrients]; a[i]={...a[i],...patch}; setFoodDraft({...foodDraft,nutrients:a}); }

  const dateNavigator=h('div',{className:'dateNavigator'},
    h('button',{className:'ghost navDay',onClick:()=>setSelectedDate(shiftDateKey(selectedDate,-1))},'‹'),
    h('div',{className:'dateCenter'},h('strong',null,dayLabel(selectedDate,deviceToday)),h('small',null,`${shortDate(weekStart)} – ${shortDate(weekEnd)}`)),
    h('input',{type:'date',value:selectedDate,onChange:e=>e.target.value&&setSelectedDate(e.target.value),'aria-label':'Seleziona giorno'}),
    h('button',{className:'ghost navDay',onClick:()=>setSelectedDate(shiftDateKey(selectedDate,1))},'›'),
    selectedDate!==deviceToday?h('button',{className:'ghost todayBtn',onClick:()=>setSelectedDate(deviceToday)},'Oggi'):null
  );

  return h('main',null,
    h('header',{className:'hero'},h('div',null,h('div',{className:'eyebrow'},'DIARIO NUTRIZIONALE PERSONALE · V2.3 DATA + SEARCH'),h('h1',null,'NutriTrace'),h('p',null,'Diario per data, Master Food DB multi-fonte, N/D espliciti e AI usata come interprete e ricerca assistita.')),h('div',{className:'privacy'},'● Local-first · Master DB primario · AI tracciata')),
    h('nav',{className:'tabs'},['oggi','ricerca','alimenti','obiettivi','analisi','dati'].map(x=>h('button',{key:x,className:tab===x?'active':'',onClick:()=>setTab(x)},x[0].toUpperCase()+x.slice(1)))),

    tab==='oggi'&&h('section',null,
      dateNavigator,
      h('div',{className:'grid5'},[['kcal','Energia','kcal'],['protein','Proteine','g'],['carbs','Carboidrati','g'],['fat','Grassi','g'],['fiber','Fibre','g']].map(([id,n,u],i)=>{const g=goals.find(x=>x.id===id),cov=macroCoverage(dayLogs,foods,id);return h('article',{className:`metric ${i===0?'primary':''}`,key:id},h('span',null,n),h(Progress,{value:totals[id],goal:effectiveTarget(g||{},profile.weight),unit:u,kind:g?.kind}),dayLogs.length&&cov<.999?h('small',{className:'metricCoverage'},`totale parziale · dati ${fmt(cov*100,0)}%`):null);})),
      h('article',{className:'card quickDiary'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,selectedDate===deviceToday?'Cosa hai mangiato oggi?':`Aggiungi al ${shortDate(selectedDate)}`),h('p',null,'Il Master DB è la fonte primaria. Ogni voce resta associata al giorno selezionato.'))),
        h('div',{className:'quickInputs'},h('label',null,'Alimento',h('input',{value:quickQuery,placeholder:'es. banana, 2 uova, cetriolo, salmone cotto…',onChange:e=>setQuickQuery(e.target.value)})),h('label',null,ui('search.gramsLabel','Grammi (facoltativi)'),h('input',{type:'number',min:'1',step:'any',value:grams,placeholder:ui('search.gramsPlaceholder','automatici per porzioni standard'),onChange:e=>setGrams(e.target.value)}))),
        h('div',{className:'masterStatusLine'},h('span',{className:`masterBadge ${masterManifest?'ok':'loading'}`},masterStatus),h('small',null,'N/D ≠ 0 · valori multi-fonte quando esiste corrispondenza sicura')),
        quickSuggestions.length?h('div',{className:'quickSuggestions'},quickSuggestions.map(r=>h('button',{className:'quickChoice',key:r.resultType==='master'?`m:${r.id}`:(r.id||r.localId),onClick:()=>quickAdd(r),disabled:recipeBusy==='quick'},h('span',null,h('b',null,r.name),h('small',null,r.resultType==='personal'?'Archivio personale':r.resultType==='master'?`Master DB · ${r.sc||1} ${Number(r.sc||1)===1?'fonte':'fonti'} · ${(r.sources||[]).join(', ')}`:(SOURCE_META[r.source]?.name||'Database locale'))),h('strong',null,recipeBusy==='quick'?'…':'+ Aggiungi')))):quickQuery.trim()?h('div',{className:'emptyAction'},h('span',{className:'muted'},ui('search.notFound','Nessuna corrispondenza nel Master DB o nei database personali.')),h('div',{className:'inlineActions'},h('button',{className:'ghost',onClick:()=>{setFoodDraft({...emptyFood(),name:quickQuery.trim(),aliases:[quickQuery.trim()]});setTab('alimenti');}},ui('search.manualButton','Inserisci manualmente')))):null,
        quickQuery.trim()&&h('div',{className:'inlineActions'},h('button',{className:'cta',disabled:recipeBusy==='parse',onClick:quickSearchWithAI},recipeBusy==='parse'?ui('search.aiWorking','Ricerca AI…'):ui('search.aiButton','Ricerca con AI'))),
        h('div',{className:'recipeComposer'},
          h('div',{className:'recipeComposerHead'},h('div',null,h('b',null,ui('recipe.title','Voce libera / lista / ricetta')),h('p',{className:'muted tiny'},ui('recipe.subtitle','L’AI interpreta il testo; peso e corrispondenza database vengono poi validati dal codice.'))),h('span',{className:'aiRole'},'AI = interprete')),
          h('textarea',{rows:3,value:recipeText,onChange:e=>setRecipeText(e.target.value),placeholder:'es. Ho mangiato 200 g di torta fatta con 100 g zucchero, 200 g farina 00, 50 g cacao e …'}),
          h('div',{className:'inlineActions'},h('button',{className:'cta',onClick:interpretRecipe,disabled:recipeBusy==='parse'||!recipeText.trim()},recipeBusy==='parse'?'Interpretazione…':ui('recipe.interpretButton','Interpreta e verifica')),h('small',{className:'muted'},'Pesi mancanti o alimenti realmente ambigui vengono fermati prima del calcolo.')),
          recipeMsg&&h('p',{className:/^(Ricetta aggiunta|Alimenti aggiunti|Alimento aggiunto)/.test(recipeMsg)?'statusMsg':'errorText'},recipeMsg),
          recipeReview&&h('div',{className:'recipeReview'},
            h('div',{className:'recipeSummary'},h('div',null,h('b',null,recipeReview.recipe_name||'Voce libera'),h('small',null,recipeReview.mode==='recipe'?'Ricetta composta':recipeReview.mode==='multi'?'Lista di alimenti':'Alimento singolo')),h('div',null,recipeReview.mode==='recipe'?h(React.Fragment,null,h('small',null,'Porzione dichiarata'),h('strong',null,recipeReview.consumed_grams?`${fmt(recipeReview.consumed_grams)} g`:'non specificata')):h(React.Fragment,null,h('small',null,'Alimenti interpretati'),h('strong',null,String(recipeReview.ingredients?.length||0))))),
            (recipeReview.errors||[]).length?h('div',{className:'recipeErrors'},(recipeReview.errors||[]).map((x,i)=>h('div',{key:i},`• ${x}`))):null,
            h('div',{className:'recipeIngredients'},(recipeReview.ingredients||[]).map((ing,i)=>{
              const problem=!(Number(ing.grams)>0)||!ing.selectedKey||ing.ambiguity==='needs_detail';
              return h('div',{className:`recipeIngredient ${problem?'problem':''}`,key:`ing-${i}`},
                h('div',{className:'recipeIngredientTop'},h('b',null,`${recipeReview.mode==='recipe'?'Ingrediente':'Alimento'} ${i+1}`),problem?h('span',{className:'coverageTag warn'},'da verificare'):h('span',{className:'coverageTag ok'},'risolto')),
                h('div',{className:'recipeGrid'},
                  h('label',null,'Alimento interpretato',h('input',{value:ing.name||'',onChange:e=>updateRecipeIngredient(i,{name:e.target.value,ambiguity:'none',ambiguity_reason:'',selectedKey:''})})),
                  h('label',null,'Grammi',h('input',{type:'number',min:'0',step:'any',value:ing.grams??'',placeholder:ing.quantity_text||'peso richiesto',onChange:e=>updateRecipeIngredient(i,{grams:e.target.value,gramsUserEdited:true})})),
                  h('label',{className:'candidateSelect'},'Corrispondenza database',h('select',{value:ing.selectedKey||'',onChange:e=>updateRecipeIngredient(i,{selectedKey:e.target.value,ambiguity:e.target.value?'none':ing.ambiguity})},h('option',{value:''},'— seleziona —'),...(ing.candidates||[]).map(c=>h('option',{key:c.candidateKey,value:c.candidateKey},`${c.name} · ${c.resultType==='master'?`Master ${c.sc||1} fonti`:'personale'}`))))
                ),
                ing.preparation&&norm(ing.preparation)!=='none'&&h('small',{className:'muted'},`Preparazione: ${ing.preparation}`),
                ing.portion_assumption&&h('small',{className:'muted portionAssumption'},`Porzione applicata: ${ing.portion_assumption}`),
                ing.ambiguity_reason&&h('p',{className:'errorText tiny'},ing.ambiguity_reason),
                h('div',{className:'recipeActions'},h('button',{className:'ghost',onClick:()=>rerunRecipeCandidates(i)},ui('recipe.dbSearchButton','Ricerche DB e dettagli')),!(ing.candidates||[]).length?h('button',{className:'ghost',disabled:recipeBusy===`ai-${i}`,onClick:()=>estimateRecipeIngredient(i)},recipeBusy===`ai-${i}`?'Ricerca…':ui('recipe.aiEstimateButton','Ricerca con AI')):null),
                candidateBrowserIndex===i&&h('div',{className:'candidateBrowser'},
                  h('div',{className:'candidateBrowserHead'},h('b',null,'Corrispondenze database'),h('small',null,'Apri la scheda completa prima di selezionare.')),
                  !(ing.candidates||[]).length?h('p',{className:'muted tiny'},'Nessuna corrispondenza affidabile. Usa Ricerca con AI per espandere semanticamente la query.'):
                  (ing.candidates||[]).map(c=>h('div',{className:'candidateRow',key:c.candidateKey},
                    h('div',null,h('b',null,c.name),h('small',null,c.resultType==='master'?`Master · ${c.sc||1} ${Number(c.sc||1)===1?'fonte':'fonti'}${c.core?' · macro core completi':''}`:'Archivio personale')),
                    h('div',{className:'inlineActions'},
                      h('button',{className:'ghost',disabled:candidatePreviewBusy,onClick:()=>previewCandidate(c,ing.name)},candidatePreviewBusy?'Caricamento…':'Dettagli'),
                      h('button',{className:'cta',onClick:()=>{updateRecipeIngredient(i,{selectedKey:c.candidateKey,ambiguity:'none'});setCandidateBrowserIndex(null);}},'Seleziona')
                    )
                  ))
                )
              );
            })),
            recipeReview.mode==='recipe'?h('div',{className:'recipeFinalize'},
              h('label',null,'Peso finale ricetta (g, consigliato se cotta)',h('input',{type:'number',min:'0',step:'any',value:recipeReview.yieldOverride??'',placeholder:'se vuoto = somma ingredienti',onChange:e=>setRecipeReview({...recipeReview,yieldOverride:e.target.value})})),
              h('p',{className:'muted tiny'},'Se non indichi il peso finale, viene usata la somma dei grammi degli ingredienti: per cotture con perdita/assorbimento d’acqua è solo un’approssimazione di resa.'),
              h('button',{className:'cta',onClick:commitRecipe,disabled:recipeBusy==='commit'},recipeBusy==='commit'?'Calcolo…':`Aggiungi ricetta al ${shortDate(selectedDate)}`)
            ):h('div',{className:'recipeFinalize'},
              h('p',{className:'muted tiny'},recipeReview.mode==='multi'?'Ogni alimento verrà registrato separatamente con il proprio peso.':'L’alimento verrà registrato con il peso risolto sopra.'),
              h('button',{className:'cta',onClick:commitRecipe,disabled:recipeBusy==='commit'},recipeBusy==='commit'?'Aggiunta…':recipeReview.mode==='multi'?`Aggiungi tutti al ${shortDate(selectedDate)}`:`Aggiungi al ${shortDate(selectedDate)}`)
            )
          )
        )
      ),
      h('div',{className:'twoCol'},
        h('article',{className:'card'},h('h2',null,'Diario del giorno'),!dayLogs.length?h('p',{className:'empty'},'Nessun alimento nel giorno selezionato.'):h('div',{className:'list'},dayLogs.map(l=>{const f=foods.find(x=>x.id===l.foodId);const kcal=f&&!isMissing(f.label?.kcal)?Number(f.label.kcal)*Number(l.grams)/(Number(f.servingGrams)||100):null;return h('div',{className:'row',key:l.id},h('div',null,h('b',null,f?.name||'Alimento rimosso'),h('small',null,`${fmt(l.grams)} g${l.recipeName?` · ${l.recipeName}`:''}`)),h('span',null,kcal===null?'N/D kcal':`${fmt(kcal)} kcal`),h('button',{className:'ghost danger',onClick:()=>setLogs(p=>p.filter(x=>x.id!==l.id))},'Rimuovi'));}))),
        h('article',{className:'card'},h('h2',null,'Settimana selezionata'),h('p',{className:'muted'},`${shortDate(weekStart)} – ${shortDate(weekEnd)}`),h('div',{className:'miniGrid'},h('div',null,h('small',null,'Energia'),h('strong',null,`${fmt(weekTotals.kcal)} kcal`)),h('div',null,h('small',null,'Proteine'),h('strong',null,`${fmt(weekTotals.protein)} g`)),h('div',null,h('small',null,'Carboidrati'),h('strong',null,`${fmt(weekTotals.carbs)} g`)),h('div',null,h('small',null,'Grassi'),h('strong',null,`${fmt(weekTotals.fat)} g`))))
      ),
      pinnedGoals.length?h('article',{className:'card'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,'Micronutrienti pinnati'),h('p',null,'I nutrienti che vuoi controllare sempre, senza scorrere l’intero elenco.')),h('button',{className:'ghost',onClick:()=>setTab('obiettivi')},'Gestisci pin')),h('div',{className:'pinnedGrid'},pinnedGoals.map(g=>{const current=valueForGoal(g,totals),target=effectiveTarget(g,profile.weight),coverage=goalCoverageFromLogs(dayLogs,foods,g);return h('div',{className:'pinnedMicro',key:g.id},h('div',null,h('b',null,g.name),h('small',null,dayLogs.length?`Copertura dati ${fmt(coverage*100,0)}%`:'Nessun alimento registrato')),h('strong',null,`${fmt(current,3)} / ${fmt(target,3)} ${g.unit}`),h('div',{className:'miniBar'},h('span',{style:{width:`${Math.min(100,target?current/target*100:0)}%`}})));}))) : null,
      h('article',{className:'card deficitCard'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,'Micronutrienti più carenti · settimana'),h('p',null,`Top 6 rispetto ai tuoi obiettivi sui ${trackedWeekDays||0} giorni registrati. Giorni non registrati e nutrienti con copertura dati <65% non vengono falsamente trattati come zero.`)),h('button',{className:'ghost',onClick:()=>setShowAllDeficits(true)},'Vedi tutti')),
        !topDeficits.length?h('p',{className:'empty'},weekLogs.length?'Nessuna carenza classificabile con copertura dati sufficiente. Controlla “Vedi tutti” per i nutrienti con dati incompleti.':'Nessun dato nella settimana selezionata.'):
        h('div',{className:'deficitGrid'},topDeficits.map(x=>h('button',{className:'deficitItem',key:x.g.id,onClick:()=>setShowAllDeficits(true)},h('div',null,h('b',null,x.g.name),h('small',null,`Copertura ${fmt(x.coverage*100,0)}%`)),h('strong',null,`−${fmt(x.deficit*100,0)}%`),h('span',null,`${fmt(x.current,2)} / ${fmt(x.target,2)} ${x.g.unit}`))))
      ),
      h('article',{className:'card'},h('h2',null,'Micronutrienti del giorno'),!Object.keys(totals.nutrients).length?h('p',{className:'empty'},'Nessun micronutriente numerico registrato. I campi N/D non vengono sommati come zero.'):h('div',{className:'nutriTable'},Object.entries(totals.nutrients).sort().map(([k,v])=>{const [n,form,unit]=k.split('|');return h('div',{className:'bioRow',key:k},h('div',null,h('b',null,n),h('small',null,form)),h('strong',null,`${fmt(v.amount,3)} ${unit}`),h('span',null,[...v.sources].join(', ')));})))
    ),

    tab==='ricerca'&&h('section',null,
      h('div',{className:'sectionHead'},h('div',null,h('h2',null,'Ricerca alimenti'),h('p',null,'Runtime Food DB auditato a 14 fonti prima, archivio personale e database aggiunti da te come fonti complementari.'))),
      h('article',{className:'card'},
        h('div',{className:'masterStatusLine'},h('span',{className:`masterBadge ${masterManifest?'ok':'loading'}`},masterStatus),masterManifest&&h('small',null,`${includedMasterSources.length} sorgenti nazionali derivate · ${validationOnlySources.length} solo validazione`)),
        h('div',{className:'searchBox'},h('input',{value:query,placeholder:'Cerca un alimento…',onChange:e=>setQuery(e.target.value),onKeyDown:e=>e.key==='Enter'&&searchFoods()}),h('button',{className:'cta',onClick:searchFoods,disabled:searching},searching?'Ricerca…':ui('search.dbButton','Cerca')),h('button',{className:'ghost',onClick:searchFoodsWithAI,disabled:aiBusy==='search-ai'||!query.trim()},aiBusy==='search-ai'?ui('search.aiWorking','Ricerca AI…'):ui('search.aiButton','Ricerca con AI'))),
        datasetMeta.length?h('div',{className:'sourceBadges'},datasetMeta.map(m=>h('span',{className:'online',key:m.id},`${m.name} · ${datasets[m.id]?.length||0}`))):h('p',{className:'muted tiny'},'Nessun database personale aggiuntivo: il Master DB integrato resta disponibile.'),
        searchError&&h('p',{className:'errorText'},searchError),
        results.map(r=>h('div',{className:'searchResult',key:r.resultType==='master'?`m:${r.id}`:(r.localId||r.sourceId||r.id)},h('div',null,h('b',null,r.name),h('small',null,r.resultType==='master'?`NutriTrace Master DB · ${r.sc||1} ${Number(r.sc||1)===1?'fonte':'fonti'} · ${(r.sources||[]).join(', ')}`:`${SOURCE_META[r.source]?.name||'Database locale'}${r.brand?` · ${r.brand}`:''}`)),h('button',{className:'ghost',onClick:()=>openResult(r,query)},r.resultType==='master'?'Apri Master':'Apri / importa'))),
        query.trim()&&!results.length&&h('div',{className:'aiFallback'},h('div',null,h('b',null,'Nessuna corrispondenza affidabile?'),h('p',{className:'muted'},'Usa la Ricerca con AI per reinterpretare il nome. Se il Master non contiene davvero l’alimento, puoi inserirlo manualmente senza inventare valori nutrizionali.')),h('div',{className:'inlineActions'},h('button',{className:'ghost',disabled:aiBusy==='search-ai',onClick:searchFoodsWithAI},ui('search.aiButton','Ricerca con AI')),h('button',{className:'cta',onClick:()=>{setFoodDraft({...emptyFood(),name:query.trim(),aliases:[query.trim()]});setTab('alimenti');}},ui('search.manualButton','Inserisci manualmente')))),
        aiMsg&&h('p',{className:'errorText'},aiMsg)
      )
    ),

    tab==='alimenti'&&h('section',null,
      h('div',{className:'sectionHead'},h('div',null,h('h2',null,'Archivio alimenti'),h('p',null,'Alimenti importati, manuali o stimati con AI.'))),
      !foods.length?h('article',{className:'card empty'},'Non hai ancora alimenti.'):h('div',{className:'foodCards'},foods.map(f=>h('article',{className:'card',key:f.id},h('div',{className:'cardTitle'},h('div',null,h('h3',null,f.name),h('p',null,f.brand||f.officialName||'')),h('div',{className:'inlineActions'},h('button',{className:'ghost',onClick:()=>setFoodDraft(structuredClone(f))},'Modifica'),h('button',{className:'ghost danger',onClick:()=>removeFood(f.id)},'Rimuovi'))),h('div',{className:'macroLine'},h('span',null,`${fmtMaybe(f.label?.kcal)} kcal`),h('span',null,`P ${fmtMaybe(f.label?.protein)} g`),h('span',null,`C ${fmtMaybe(f.label?.carbs)} g`),h('span',null,`G ${fmtMaybe(f.label?.fat)} g`)),h('small',{className:'sourceText'},`${f.masterId?'Master DB · ':''}Fonti: ${f.sources?.length?f.sources.map(s=>s?.name||s).join(', '):'manuale'} · N/D non conteggiati come zero`))))
    ),

    tab==='obiettivi'&&h('section',null,
      h('div',{className:'twoCol goalsTop'},
        h('article',{className:'card'},h('h2',null,'Peso ed energia / macro'),h('p',{className:'muted'},'Proteine, carboidrati, grassi, zuccheri semplici e fibre sono impostabili in g/kg di peso corporeo.'),
          h('div',{className:'macroPlanGrid'},
            h('label',null,'Peso (kg)',h('input',{type:'number',step:'any',value:profile.weight,onChange:e=>setProfile({...profile,weight:e.target.value})})),
            h('label',null,'Gestione calorie',h('select',{value:profile.macroPlan.calorieMode,onChange:e=>setProfile({...profile,macroPlan:{...profile.macroPlan,calorieMode:e.target.value}})},h('option',{value:'fixed'},'Calorie fisse · un macro automatico'),h('option',{value:'derived'},'Calorie automatiche dai macro'))),
            profile.macroPlan.calorieMode==='fixed'&&h('label',null,'Calorie target',h('input',{type:'number',step:'1',value:profile.macroPlan.kcal,onChange:e=>setProfile({...profile,macroPlan:{...profile.macroPlan,kcal:e.target.value}})})),
            profile.macroPlan.calorieMode==='fixed'&&h('label',null,'Macro automatico',h('select',{value:profile.macroPlan.autoMacro,onChange:e=>setProfile({...profile,macroPlan:{...profile.macroPlan,autoMacro:e.target.value}})},h('option',{value:'carbs'},'Carboidrati'),h('option',{value:'protein'},'Proteine'),h('option',{value:'fat'},'Grassi'))),
            ...[['protein','Proteine'],['carbs','Carboidrati'],['fat','Grassi'],['sugar','Zuccheri semplici'],['fiber','Fibre']].map(([k,l])=>h('label',{key:k},`${l} (g/kg)`,h('input',{type:'number',step:'any',disabled:profile.macroPlan.calorieMode==='fixed'&&profile.macroPlan.autoMacro===k,value:macroPreview.perKg[k],onChange:e=>setProfile({...profile,macroPlan:{...profile.macroPlan,perKg:{...profile.macroPlan.perKg,[k]:e.target.value}}})})))
          ),
          h('div',{className:'planPreview'},h('b',null,`${fmt(macroPreview.kcal,0)} kcal`),h('span',null,`P ${fmt(macroPreview.grams.protein)} g · C ${fmt(macroPreview.grams.carbs)} g · G ${fmt(macroPreview.grams.fat)} g · zuccheri ${fmt(macroPreview.grams.sugar)} g · fibre ${fmt(macroPreview.grams.fiber)} g`)),
          profile.macroPlan.calorieMode==='fixed'&&macroPreview.derivedKcal>macroPreview.kcal+1&&h('p',{className:'errorText tiny'},`Combinazione impossibile: i macro fissati richiedono già ${fmt(macroPreview.derivedKcal,0)} kcal, oltre il target di ${fmt(macroPreview.kcal,0)} kcal.`),
          macroPreview.grams.sugar>macroPreview.grams.carbs&&h('p',{className:'errorText tiny'},'Zuccheri semplici non possono superare i carboidrati totali: correggi il target g/kg.'),
          h('p',{className:'muted tiny'},'Nota tecnica: zuccheri semplici sono una sottoquota dei carboidrati e le fibre non vengono usate come “residuo calorico”. Il solver automatico agisce solo su proteine/carboidrati/grassi; se scegli tutti e tre, imposta “Calorie automatiche”.'),
          h('button',{className:'cta',onClick:applyMacroPlan},'Applica ai target')
        ),
        h('article',{className:'card'},h('h2',null,'Stato settimana selezionata'),h('p',{className:'muted'},`${shortDate(weekStart)} – ${shortDate(weekEnd)}`),goals.filter(g=>g.period==='week'&&effectiveTarget(g,profile.weight)>0).slice(0,10).map(g=>h('div',{key:g.id,className:'goalStatus'},h('span',null,g.name),h(Progress,{value:valueForGoal(g,weekTotals),goal:effectiveTarget(g,profile.weight),unit:g.unit,kind:g.kind}))),!goals.some(g=>g.period==='week'&&effectiveTarget(g,profile.weight)>0)&&h('p',{className:'empty'},'Nessun target settimanale attivo.'))
      ),
      h('article',{className:'card'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,'Micronutrienti e componenti'),h('p',null,'Target assoluto oppure per kg di peso; raggruppati per rendere l’elenco gestibile.')),h('button',{className:'ghost',onClick:()=>setGoals([...goals,{id:newId(),name:'Nuovo nutriente',form:'*',unit:'mg',target:0,perKg:0,targetMode:'absolute',period:'day',kind:'minimum',group:'Personalizzati'}])},'+ Nutriente')),
        [...new Set(goals.filter(g=>g.group!=='Energia e macro').map(g=>g.group||'Personalizzati'))].map(group=>h('details',{className:'goalGroup',key:group,open:group==='Vitamine'||group==='Minerali e oligoelementi'},h('summary',null,h('b',null,group),h('span',null,`${goals.filter(g=>(g.group||'Personalizzati')===group).length} voci`)),h('div',{className:'goalRows'},goals.map((g,i)=>(g.group||'Personalizzati')===group?h(GoalRow,{key:g.id,g,index:i,goals,setGoals,weight:profile.weight,current:valueForGoal(g,g.period==='week'?weekTotals:totals)}):null))))
      )
    ),

    tab==='analisi'&&h('section',null,
      h('div',{className:'sectionHead'},h('div',null,h('h2',null,'Analisi e cronologia'),h('p',null,'Report ricalcolati dal diario: giorno, settimana, mese, anno o intervallo personalizzato. N/D non viene mai trattato come zero.'))),
      h('article',{className:'card reportControls'},
        h('div',{className:'reportModeButtons'},...['day','week','month','year','custom'].map(mode=>h('button',{className:reportMode===mode?'cta':'ghost',key:mode,onClick:()=>setReportMode(mode)},({day:'Giorno',week:'Settimana',month:'Mese',year:'Anno',custom:'Intervallo'}[mode])))),
        reportMode==='custom'?h('div',{className:'reportCustomRange'},h('label',null,'Dal',h('input',{type:'date',value:reportFrom,onChange:e=>setReportFrom(e.target.value)})),h('label',null,'Al',h('input',{type:'date',value:reportTo,onChange:e=>setReportTo(e.target.value)}))):h('label',{className:'reportAnchor'},'Periodo di riferimento',h('input',{type:'date',value:reportAnchor,onChange:e=>setReportAnchor(e.target.value)})),
        h('div',{className:'reportRangeLabel'},h('b',null,`${dayLabel(reportRange[0],deviceToday)}${reportRange[0]!==reportRange[1]?` → ${dayLabel(reportRange[1],deviceToday)}`:''}`),h('small',null,`${reportTrackedDays} giorni registrati su ${daysInclusive(reportRange[0],reportRange[1])}`))
      ),
      h('div',{className:'reportMetricGrid'},
        [['kcal','kcal/die'],['protein','g proteine/die'],['carbs','g carboidrati/die'],['fat','g grassi/die'],['fiber','g fibre/die']].map(([k,label])=>h('article',{className:'metric',key:k},h('span',null,label),h('div',{className:'reportMetricValue'},h('strong',null,fmt(reportAvg[k],1))),h('small',null,previousTrackedDays?`Periodo precedente: ${fmt(previousAvg[k],1)}${previousAvg[k]?` · ${reportAvg[k]>=previousAvg[k]?'+':''}${fmt((reportAvg[k]-previousAvg[k])/previousAvg[k]*100,0)}%`:''}`:'Nessun confronto precedente')))
      ),
      h('div',{className:'twoCol reportColumns'},
        h('article',{className:'card'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,'Micronutrienti e obiettivi'),h('p',null,'Valutazione basata solo sui giorni registrati e sui dati strutturati con copertura sufficiente.'))),
          !reportTrackedDays?h('p',{className:'empty'},'Nessun giorno registrato nel periodo.'):
          h('div',{className:'reportGoalList'},...reportGoalStats.map(x=>h('div',{className:`reportGoalRow ${x.status}`,key:x.g.id},
            h('div',null,h('b',null,x.g.name),h('small',null,`Copertura ${fmt(x.coverage*100,0)}%${x.g.components?.length?` · ${x.g.components.join(' + ')}`:''}`)),
            h('div',{className:'reportGoalNumbers'},h('span',null,`${fmt(x.current,3)} / ${fmt(x.target,3)} ${x.g.unit}`),h('strong',null,x.status==='insufficient'?'Dati insufficienti':x.status==='high'?'Alto':x.status==='low'?'Basso':'Adeguato'))
          )))
        ),
        h('article',{className:'card reportHistory'},h('h2',null,'Cronologia'),h('p',{className:'muted'},'Apri qualsiasi periodo passato: il report viene ricalcolato dai dati reali del diario.'),
          h('details',{open:true},h('summary',null,`Settimane · ${reportHistory.weeks.length}`),h('div',{className:'historyList'},...reportHistory.weeks.map(x=>h('button',{className:'historyRow',key:x.from,onClick:()=>{setReportMode('week');setReportAnchor(x.from);}},h('span',null,`${shortDate(x.from)} – ${shortDate(x.to)}`),h('small',null,`${x.trackedDays}/7 giorni · ${x.count} registrazioni`))))),
          h('details',null,h('summary',null,`Mesi · ${reportHistory.months.length}`),h('div',{className:'historyList'},...reportHistory.months.map(x=>h('button',{className:'historyRow',key:x.from,onClick:()=>{setReportMode('month');setReportAnchor(x.from);}},h('span',null,parseDateKey(x.from).toLocaleDateString('it-IT',{month:'long',year:'numeric'})),h('small',null,`${x.trackedDays} giorni · ${x.count} registrazioni`))))),
          h('details',null,h('summary',null,`Anni · ${reportHistory.years.length}`),h('div',{className:'historyList'},...reportHistory.years.map(x=>h('button',{className:'historyRow',key:x.from,onClick:()=>{setReportMode('year');setReportAnchor(x.from);}},h('span',null,x.from.slice(0,4)),h('small',null,`${x.trackedDays} giorni · ${x.count} registrazioni`)))))
        )
      )
    ),

    tab==='dati'&&h('section',null,
      h('article',{className:'card masterCard'},
        h('div',{className:'cardTitle'},h('div',null,h('span',{className:'eyebrow'},'DATABASE INTEGRATO'),h('h2',null,`NutriTrace Runtime DB ${masterManifest?.runtime_version||'v1'}`),h('p',null,'Fonte primaria dell’app: valori normalizzati per 100 g, provenance conservata, fusioni conservative e N/D espliciti.')),h('span',{className:`masterBadge ${masterManifest?'ok':'loading'}`},masterStatus)),
        masterManifest&&h('div',{className:'masterStats'},
          h('div',null,h('small',null,'Alimenti canonici'),h('strong',null,Number(masterManifest.food_count||0).toLocaleString('it-IT'))),
          h('div',null,h('small',null,'Valori numerici'),h('strong',null,Number(masterManifest.numeric_values||0).toLocaleString('it-IT'))),
          h('div',null,h('small',null,'Alimenti multi-fonte'),h('strong',null,Number(masterManifest.multisource_foods||0).toLocaleString('it-IT'))),
          h('div',null,h('small',null,'N/D espliciti'),h('strong',null,Number(masterManifest.explicit_nd_values||0).toLocaleString('it-IT')))
        ),
        h('div',{className:'inlineActions'},h('button',{className:'cta',onClick:downloadMasterOffline,disabled:!masterManifest},'Scarica Master completo offline'),masterOfflineMsg&&h('small',{className:masterOfflineMsg.startsWith('Download offline incompleto')?'errorText':'muted'},masterOfflineMsg)),
        h('p',{className:'muted tiny'},`Runtime derivato dal Master POST-AUDIT (${masterManifest?.source_master?.audit_test_suite||'audit completato'}). Grade A/B usati normalmente; C ammesso nelle carenze solo con copertura dati ≥65%; D resta informativo ma viene escluso dalla classifica. N/D non è mai zero. Il pulsante sopra forza il caching locale di tutti i chunk.`),
        masterManifest&&h('div',{className:'sourceGroups'},
          h('details',{open:true},h('summary',null,h('b',null,`Sorgenti incluse · ${includedMasterSources.length}`)),h('div',{className:'sourcePills'},includedMasterSources.map(x=>h('span',{key:x.code,title:x.licence_note||''},`${x.country} · ${x.version||'versione n/d'}`)))),
          validationOnlySources.length?h('details',null,h('summary',null,h('b',null,'Solo validazione / non fuse')),h('div',{className:'sourcePills'},validationOnlySources.map(x=>h('span',{key:x.code,title:x.licence_note||''},`${x.country} · ${x.name}`)))):null,
          missingMasterSources.length?h('details',null,h('summary',null,h('b',null,'Sorgenti predisposte da integrare')),h('div',{className:'sourcePills'},missingMasterSources.map(x=>h('span',{key:x.code},`${x.country} · file non presente in v1`)))):null
        ),
        h('div',{className:'qualityNotice'},h('b',null,'Policy qualità: '),'assenza = N/D; uno zero a bassa affidabilità proveniente da una sola fonte non viene mostrato come assenza biologica certa; nessun valore AI è incorporato nel Master.')
      ),
      h('div',{className:'twoCol'},
        h('article',{className:'card'},h('h2',null,'Database personali aggiuntivi'),!datasetMeta.length?h('p',{className:'empty'},'Nessun database aggiuntivo installato. Il Master integrato rimane sempre disponibile.'):h('div',{className:'localDbList'},datasetMeta.map(m=>h('div',{className:'localDbRow',key:m.id},h('div',null,h('b',null,m.name),h('small',null,`${datasets[m.id]?.length||m.count||0} alimenti · ${m.fileName||'file locale'}`)),h('button',{className:'ghost danger',onClick:()=>removeDataset(m.id)},'Rimuovi'))))),
        h('article',{className:'card'},h('h2',null,'Backup diario'),h('button',{className:'cta',onClick:exportData},'Esporta JSON'),h('label',{className:'importLabel'},'Importa backup',h('input',{type:'file',accept:'application/json',onChange:importBackup})),h('p',{className:'muted tiny'},'Il Master DB è distribuito con l’app e non viene duplicato nel backup. I database personali voluminosi restano in IndexedDB.'))
      ),
      h('article',{className:'card addDbCard'},h('div',{className:'cardTitle'},h('div',null,h('h2',null,'Aggiungi un tuo database'),h('p',null,'Nome libero e possibilità di rimozione. Il database viene aggiunto come fonte complementare, non sostituisce automaticamente il Master.'))),h('div',{className:'addDbGrid'},h('label',null,'Nome database',h('input',{value:newDatasetName,onChange:e=>setNewDatasetName(e.target.value),placeholder:'es. CREA Italia'})),h('label',null,'File',h('input',{type:'file',accept:'.csv,.xlsx,.xls,.ods,.json,.jsonl',onChange:e=>setNewDatasetFile(e.target.files?.[0]||null)})),h('button',{className:'cta',onClick:importCustomDataset,disabled:!newDatasetFile},'+ Aggiungi')),datasetMsg&&h('p',{className:'statusMsg'},datasetMsg),h('p',{className:'muted tiny'},'Per import CREA: macro a zero restano validi; gli zero nei campi di dettaglio/micronutrienti sono trattati conservativamente come N/D quando non è possibile distinguerli da “non disponibile”. Percentuali di acidi grassi e aminoacidi vengono convertite sulla quantità reale di lipidi/proteine.')),
      h('article',{className:'card notice'},h('h3',null,'Ruolo dell’AI dopo il Master DB'),h('p',null,'OpenRouter serve soprattutto a interpretare testo libero, ricette e ambiguità. La stima numerica AI è l’ultima risorsa: non sovrascrive dati strutturati, non usa 0 per “sconosciuto”, impone unità lato codice e rifiuta stime a bassa confidenza o nutrienti ad alto rischio. OPENROUTER_API_KEY resta esclusivamente nella Vercel Function.'))
    ),

    showAllDeficits&&h('div',{className:'modalBackdrop'},h('div',{className:'modal allDeficits'},
      h('div',{className:'modalHead'},h('div',null,h('span',{className:'eyebrow'},'SETTIMANA SELEZIONATA'),h('h2',null,'Micronutrienti ordinati per carenza'),h('p',{className:'muted'},`${shortDate(weekStart)} – ${shortDate(weekEnd)}`)),h('button',{className:'close',onClick:()=>setShowAllDeficits(false)},'×')),
      h('p',{className:'qualityNotice'},'Un nutriente entra nella classifica di carenza solo con almeno il 65% di copertura ponderata degli alimenti registrati. Copertura inferiore = dati insufficienti, non assunzione zero.'),
      h('div',{className:'deficitList'},weeklyDeficits.map(x=>h('div',{className:`deficitRow ${x.dataSufficient?'':'insufficient'}`,key:x.g.id},
        h('div',null,h('b',null,x.g.name),h('small',null,`Copertura dati ${fmt(x.coverage*100,0)}% · ${x.g.period==='week'?'target settimanale':'target giornaliero × 7'}`)),
        h('div',{className:'deficitNumbers'},h('span',null,`${fmt(x.current,3)} / ${fmt(x.target,3)} ${x.g.unit}`),h('strong',null,!x.dataSufficient?'Dati insufficienti':x.deficit>0?`−${fmt(x.deficit*100,0)}%`:'Target raggiunto'))
      ))),
      h('div',{className:'modalActions'},h('button',{className:'cta',onClick:()=>setShowAllDeficits(false)},'Chiudi'))
    )),

    candidatePreview&&h(CandidatePreviewModal,{food:candidatePreview,onClose:()=>setCandidatePreview(null)}),

    foodDraft&&h('div',{className:'modalBackdrop'},h('div',{className:'modal'},
      h('div',{className:'modalHead'},h('div',null,h('span',{className:'eyebrow'},'SCHEDA ALIMENTO'),h('h2',null,foodDraft.name||'Nuovo alimento')),h('button',{className:'close',onClick:()=>setFoodDraft(null)},'×')),
      foodDraft.mergeMeta?.mode==='review'&&h('div',{className:'mergeWarning'},h('b',null,'Possibile corrispondenza con un alimento già presente. '),'Controlla i dati prima di salvare.'),
      h('div',{className:'formGrid'},h('label',null,'Nome rapido',h('input',{value:foodDraft.name,onChange:e=>setFoodDraft({...foodDraft,name:e.target.value})})),h('label',null,'Marca (opzionale)',h('input',{value:foodDraft.brand||'',onChange:e=>setFoodDraft({...foodDraft,brand:e.target.value})})),h('label',null,'Valori riferiti a (g)',h('input',{type:'number',value:foodDraft.servingGrams,onChange:e=>setFoodDraft({...foodDraft,servingGrams:e.target.value})}))),
      foodDraft.officialName&&foodDraft.officialName!==foodDraft.name&&h('p',{className:'officialName'},h('b',null,'Voce ufficiale: '),foodDraft.officialName),
      h('label',null,'Alias di ricerca (separati da virgola)',h('input',{value:(foodDraft.aliases||[]).join(', '),onChange:e=>setFoodDraft({...foodDraft,aliases:e.target.value.split(',').map(x=>x.trim()).filter(Boolean)})})),
      h('div',{className:'cardTitle aiTitle'},h('h3',null,'Etichetta / macro'),h('button',{className:'ghost',disabled:aiBusy==='draft',onClick:enrichDraft},aiBusy==='draft'?'Completamento…':'Completa macro / N/D selezionati')),
      aiMsg&&h('p',{className:'errorText'},aiMsg),
      h('div',{className:'formGrid'},Object.entries(MACROS).map(([k,l])=>h('label',{key:k},l,h('input',{type:'number',step:'any',value:foodDraft.label?.[k]??'',onChange:e=>setFoodDraft({...foodDraft,label:{...foodDraft.label,[k]:e.target.value}})})))),
      draftNdRows.length?h('div',{className:'ndPanel'},h('div',{className:'cardTitle'},h('div',null,h('h3',null,'Campi N/D'),h('p',null,'N/D significa dato non disponibile, non zero. Puoi selezionare tutte le voci desiderate: l’app le completa in blocchi controllati. I nutrienti ad alto rischio mostrano un errore esplicito invece di una falsa stima.')),h('span',{className:'coverageTag'},`${(foodDraft.aiRequested||[]).length} selezionati`)),h('div',{className:'ndList'},draftNdRows.map(([name,st])=>h('label',{className:`ndItem ${st?.status==='blocked_high_risk'||st?.status==='ai_error'?'ndProblem':''}`,key:name},h('input',{type:'checkbox',checked:(foodDraft.aiRequested||[]).includes(name),onChange:()=>toggleAiRequest(name)}),h('span',null,h('b',null,name),h('small',null,st?.reason||'Dato non disponibile')),h('strong',null,st?.status==='blocked_high_risk'?'ALTO RISCHIO':st?.status==='ai_error'?'ERRORE':'N/D'))))):null,
      h('h3',null,'Ingredienti completi'),h('label',null,'Lista come in etichetta',h('textarea',{rows:4,value:foodDraft.ingredients||'',onChange:e=>setFoodDraft({...foodDraft,ingredients:e.target.value})})),
      parseAdditives(foodDraft.ingredients).length>0&&h('div',{className:'chips'},parseAdditives(foodDraft.ingredients).map(a=>h('span',{key:a},a))),
      h('div',{className:'cardTitle'},h('div',null,h('h3',null,'Nutrienti specifici / forme'),h('p',null,'Quantità riferite alla base indicata sopra.')),h('button',{className:'ghost',onClick:addNutrient},'+ Aggiungi')),
      (foodDraft.nutrients||[]).map((n,i)=>h('div',{className:'nutrientAdvanced',key:n.id},h('div',{className:'nutrientMain'},h('input',{placeholder:'Magnesio / EPA / Leucina',value:n.name,onChange:e=>editNutrient(i,{name:e.target.value})}),h('input',{placeholder:'forma / nota',value:n.form||'',onChange:e=>editNutrient(i,{form:e.target.value})}),h('input',{type:'number',step:'any',placeholder:'quantità',value:n.amount,onChange:e=>editNutrient(i,{amount:e.target.value})}),h('select',{value:n.unit,onChange:e=>editNutrient(i,{unit:e.target.value})},h('option',null,'mg'),h('option',null,'µg'),h('option',null,'g')),h('button',{className:'ghost danger',onClick:()=>setFoodDraft({...foodDraft,nutrients:foodDraft.nutrients.filter(x=>x.id!==n.id)})},'×')),h('div',{className:'bioEdit'},h('label',null,'Quantità elementare (opz.)',h('input',{type:'number',step:'any',value:n.elementalAmount??'',onChange:e=>editNutrient(i,{elementalAmount:e.target.value})})),h('label',null,'Assorbimento minimo %',h('input',{type:'number',min:0,max:100,step:'any',value:n.bio?.min??'',onChange:e=>editNutrient(i,{bio:{...(n.bio||{}),mode:'range',min:e.target.value}})})),h('label',null,'Assorbimento massimo %',h('input',{type:'number',min:0,max:100,step:'any',value:n.bio?.max??'',onChange:e=>editNutrient(i,{bio:{...(n.bio||{}),mode:'range',max:e.target.value}})})),h('label',null,'Fonte stima',h('input',{value:n.bio?.source??'',onChange:e=>editNutrient(i,{bio:{...(n.bio||{}),source:e.target.value}})})),h('label',null,'Fonte composizione',h('input',{value:n.source||'',onChange:e=>editNutrient(i,{source:e.target.value})}))))),
      h('div',{className:'cardTitle'},h('h3',null,'Fonti'),h('button',{className:'ghost',onClick:()=>setFoodDraft({...foodDraft,sources:[...(foodDraft.sources||[]),{id:newId(),name:'',reference:'',quality:'primaria'}]})},'+ Fonte')),
      (foodDraft.sources||[]).map((s,i)=>h('div',{className:'sourceEdit',key:s?.id||i},h('input',{value:s?.name||'',placeholder:'Fonte',onChange:e=>{const x=[...foodDraft.sources];x[i]={...s,name:e.target.value};setFoodDraft({...foodDraft,sources:x})}}),h('input',{value:s?.reference||'',placeholder:'Riferimento',onChange:e=>{const x=[...foodDraft.sources];x[i]={...s,reference:e.target.value};setFoodDraft({...foodDraft,sources:x})}}),h('select',{value:s?.quality||'primaria',onChange:e=>{const x=[...foodDraft.sources];x[i]={...s,quality:e.target.value};setFoodDraft({...foodDraft,sources:x})}},h('option',{value:'primaria'},'Primaria'),h('option',{value:'secondaria'},'Secondaria'),h('option',{value:'stimata'},'Stimata')),h('button',{className:'ghost danger',onClick:()=>setFoodDraft({...foodDraft,sources:foodDraft.sources.filter((_,j)=>j!==i)})},'×'))),
      h('label',null,'Note',h('textarea',{rows:3,value:foodDraft.notes||'',onChange:e=>setFoodDraft({...foodDraft,notes:e.target.value})})),
      h('div',{className:'modalActions'},h('button',{className:'ghost',onClick:()=>setFoodDraft(null)},'Annulla'),h('button',{className:'cta',onClick:saveFood},'Salva alimento'))
    ))
  );
}
const root=ReactDOM.createRoot(document.getElementById('root'));
root.render(h(Home));
