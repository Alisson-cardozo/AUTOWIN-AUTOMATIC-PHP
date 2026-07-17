const DEFAULT_NOTIFICATION_TITLE = "Autowin";
const DEFAULT_NOTIFICATION_BODY = "Você tem uma nova notificação.";
const NOTIFICATION_ICON = "/logo.jpg";
const NOTIFICATION_BADGE = "/logo.jpg";
const NOTIFICATION_CLICK_URL = "/inicio";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener("push", (event) => {
  let payload = { title: DEFAULT_NOTIFICATION_TITLE, body: DEFAULT_NOTIFICATION_BODY };
  try {
    if (event.data) payload = event.data.json();
  } catch {
    // payload não é JSON válido — mantém o padrão
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || DEFAULT_NOTIFICATION_TITLE, {
      body: payload.body || "",
      icon: NOTIFICATION_ICON,
      badge: NOTIFICATION_BADGE,
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(NOTIFICATION_CLICK_URL);
    })
  );
});
