// 日めくりTodo service worker: app works offline
const VERSION="v47";
const SHELL=["./","./index.html","./app.js","./config.js","./manifest.webmanifest",
  "./vendor/firebase-app-compat.js","./vendor/firebase-auth-compat.js","./vendor/firebase-firestore-compat.js",
  "./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];
const FONT_HOSTS=["fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install",e=>{
  // straight from the server, not from the browser's own short-term cache
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL.map(u=>new Request(u,{cache:"reload"})))).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  const same=url.origin===self.location.origin;
  if(!same&&!FONT_HOSTS.includes(url.hostname))return; // sync traffic goes straight to the network
  if(same){
    // newest files when online, cached copy when offline (only good responses are cached)
    const key=req.mode==="navigate"?"./index.html":req;
    // a page request can't be copied with options, so it is fetched by its address
    const fresh=req.mode==="navigate"?fetch(req.url,{cache:"no-cache",credentials:"same-origin"}):fetch(req,{cache:"no-cache"});
    e.respondWith(fresh.then(res=>{
      if(res&&res.ok){const copy=res.clone();caches.open(VERSION).then(c=>c.put(key,copy))}
      return res;
    }).catch(()=>caches.match(key).then(hit=>hit||caches.match("./index.html"))));
    return;
  }
  // fonts: cached copy right away, refreshed in the background
  e.respondWith(caches.open(VERSION).then(async c=>{
    const hit=await c.match(req);
    const net=fetch(req).then(res=>{if(res&&(res.ok||res.type==="opaque"))c.put(req,res.clone());return res}).catch(()=>hit);
    return hit||net;
  }));
});
