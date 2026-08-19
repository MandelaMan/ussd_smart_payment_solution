/* PWA push handlers imported by the generated Workbox service worker. */
/* global self, clients */

self.addEventListener("push", (event) => {
  let data = {
    title: "SUL Bix",
    body: "You have a new reminder",
    url: "/admin/reminders",
  };
  try {
    if (event.data) {
      data = { ...data, ...event.data.json() };
    }
  } catch {
    /* keep defaults */
  }
  const url = data.url || "/admin/reminders";
  event.waitUntil(
    self.registration.showNotification(data.title || "SUL Bix", {
      body: data.body || "",
      icon: "/admin/pwa-192x192.png",
      badge: "/admin/pwa-192x192.png",
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/admin/reminders";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes("/admin") && "focus" in client) {
          if ("navigate" in client) {
            client.navigate(url);
          }
          return client.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
