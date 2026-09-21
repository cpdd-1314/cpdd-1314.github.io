/*
 * 「全球找对象」通知用 Service Worker
 * ------------------------------------------------------------
 * 为什么需要这个独立文件：
 *   浏览器规范不允许用 blob: URL 注册 Service Worker（会直接抛
 *   "The URL protocol of the script ('blob:...') is not supported"），
 *   因此必须是一个真实的、与本页同源的脚本文件。
 *
 * 它只做一件事：让页面能用 registration.showNotification() 弹系统通知。
 * 为什么不用 new Notification()：页面被切到后台时，构造器会抛
 *   InvalidStateError（Illegal constructor），只有 SW 的通知不受影响。
 *
 * 本文件不缓存任何资源、不拦截任何请求，纯粹用来承载通知。
 */

self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(self.clients.claim());
});

// 点击通知：优先聚焦已打开的页面，没有就新开一个
self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (cs) {
        for (var i = 0; i < cs.length; i++) {
          if (cs[i] && 'focus' in cs[i]) return cs[i].focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow('./');
      })
      .catch(function () { })
  );
});
