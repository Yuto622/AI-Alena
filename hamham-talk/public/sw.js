// 通知用の Service Worker（本文なしの push を受けて、決まった文面を出す）
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    self.registration.showNotification("ハムハムトーク 🐹", {
      body: "新しいメッセージがとどいたはむ💕",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: "hamham",
      renotify: true, // 2 通目以降も毎回ちゃんと鳴らす
      silent: false,
      vibrate: [200, 100, 200, 100, 400], // Android のバイブ（iPhone は本体の設定どおりに振動）
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => "focus" in c);
      return open ? open.focus() : self.clients.openWindow("/");
    })
  );
});
