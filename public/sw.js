const CACHE='stepflow-v3-shell';
const SHELL=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting();});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
  if(new URL(e.request.url).pathname.startsWith('/api/'))return;
  e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return r;}).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));
});
self.addEventListener('push',e=>{
  let d={title:'STEPFLOW',body:'새 알림이 있습니다.',data:{}};
  try{d={...d,...e.data.json()};}catch(_){try{d.body=e.data.text();}catch(__){}}
  e.waitUntil(self.registration.showNotification(d.title,{body:d.body,icon:'/icon-192.png',badge:'/icon-192.png',data:d.data||{},tag:'stepflow-attendance'}));
});
self.addEventListener('notificationclick',e=>{e.notification.close();e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(ws=>{for(const w of ws){if('focus'in w)return w.focus();}return clients.openWindow('/');}));});
