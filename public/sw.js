self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',(e)=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',()=>{}); // network as usual; presence of a fetch handler makes the app installable
