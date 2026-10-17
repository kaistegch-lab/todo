// 日めくりTodo service worker: app works offline
const VERSION="v3";
const SHELL=["./","./index.html","./app.js","./config.js","./manifest.webmanifest",
  "./vendor/firebase-app-compat.js","./vendor/firebase-auth-compat.js","./vendor/firebase-firestore-compat.js",
  "./icons/icon-192.png","./icons/icon-512.png","./icons/apple-touch-icon.png"];
const FONT_HOSTS=["fonts.googleapis.com","fonts.gstatic.com"];

self.addEventListener("install",e=>{
  e.waitUntil(caches.open(VERSION).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",e=>{
  const req=e.request;if(req.method!=="GET")return;
  const url=new URL(req.url);
  const same=url.origin===self.location.origin;
  if(!same&&!FONT_HOSTS.includes(url.hostname))return; // sync traffic goes straight to the network
  if(req.mode==="navigate"){
    // newest page when online, cached page when offline
    e.respondWith(fetch(req).then(res=>{const copy=res.clone();caches.open(VERSION).then(c=>c.put("./index.html",copy));return res})
      .catch(()=>caches.match("./index.html")));
    return;
  }
  // cached copy right away, refreshed in the background
  e.respondWith(caches.open(VERSION).then(async c=>{
    const hit=await c.match(req);
    const net=fetch(req).then(res=>{if(res&&(res.ok||res.type==="opaque"))c.put(req,res.clone());return res}).catch(()=>hit);
    return hit||net;
  }));
});
