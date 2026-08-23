const CACHE='nutrichat-v231-runtime';
const CORE=[
  './','./index.html','./app.js','./style.css','./manifest.webmanifest','./icon-192.png','./icon-512.png',
  './config/ui.it.json','./config/search-policy.json','./config/standard-portions.json',
  './data/master/manifest.json','./data/master/index.json'
];
const VENDOR=[
  'https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js',
  'https://cdn.sheetjs.com/xlsx-0.18.5/package/dist/xlsx.full.min.js'
];
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(VENDOR.map(async url=>{try{const response=await fetch(url,{mode:'no-cors'});await cache.put(url,response);}catch{}}));
  })());
  self.skipWaiting();
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  event.respondWith((async()=>{
    const url=new URL(event.request.url);
    const sameOrigin=url.origin===self.location.origin;
    const isMaster=sameOrigin&&url.pathname.includes('/data/master/');
    const isAppAsset=sameOrigin && (/\/(?:app\.js|style\.css|index\.html|sw\.js)$/.test(url.pathname)||url.pathname.endsWith('/'));

    // V2.3.1: network-first for app + Master assets. A redeploy must never be masked by an
    // older service-worker response; cached data remains the offline fallback.
    if(isMaster||isAppAsset){
      try{
        const response=await fetch(event.request,{cache:'no-store'});
        if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
        return response;
      }catch{
        return (await caches.match(event.request))||(await caches.match('./index.html'))||Response.error();
      }
    }

    const cached=await caches.match(event.request);
    if(cached) return cached;
    try{
      const response=await fetch(event.request);
      if(response.ok&&sameOrigin){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(event.request,copy)).catch(()=>{});}
      return response;
    }catch{
      if(sameOrigin) return (await caches.match('./index.html'))||Response.error();
      return Response.error();
    }
  })());
});
