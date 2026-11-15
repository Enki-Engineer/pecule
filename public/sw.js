// Service worker : met en cache l'interface (fichiers statiques) pour un
// démarrage instantané depuis l'écran d'accueil. Les réponses /api ne passent jamais par ce cache ;
// les données de synthèse gardées sur l'appareil le sont par l'appli (src/client/offline.tsx, liste
// fermée, 7 jours, effacées à la déconnexion, désactivables).
// Changer ce nom vide l'ancien cache : à faire quand un fichier de /icons est redessiné sans changer de nom, ou quand
// des réponses gardées à tort doivent partir (v4 : une page avait pu être gardée à la place d'un fichier disparu).
const CACHE = "pecule-v5";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  // Fichiers versionnés : cache d'abord. Pages : réseau d'abord, cache en secours hors ligne.
  if (url.pathname.startsWith("/assets/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(event.request).then(
        (hit) => hit || fetch(event.request).then((res) => {
          // Jamais une page à la place d'un fichier : un fichier disparu (ancienne version) ne doit pas rester en cache.
          if (res.ok && !(res.headers.get("content-type") || "").includes("text/html")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
      ),
    );
  } else if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request)
        .then((res) => {
          // Seule une vraie page de l'appli sert de secours hors ligne : ni page d'erreur, ni calendrier, ni OAuth.
          const html = (res.headers.get("content-type") || "").includes("text/html");
          if (res.ok && res.type === "basic" && html && !url.pathname.startsWith("/ical/") && !url.pathname.startsWith("/oauth/")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/", copy));
          }
          return res;
        })
        .catch(() => caches.match("/")),
    );
  }
});

// Notifications push (Réglages → Notifications) : affichage, puis ouverture de l'écran concerné.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: "Pécule", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "Pécule", {
      body: data.body || "",
      icon: "/icons/coffre/petrole-192.png",
      badge: "/icons/coffre/petrole-192.png",
      tag: data.tag,
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const wanted = (event.notification.data && event.notification.data.url) || "/";
  // Seulement un chemin de l'appli : jamais une adresse extérieure portée par une notification.
  const url = typeof wanted === "string" && wanted.startsWith("/") && !wanted.startsWith("//") ? wanted : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if ("focus" in w) {
          w.navigate(url).catch(() => {});
          return w.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
