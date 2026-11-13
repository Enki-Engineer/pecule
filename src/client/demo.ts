import type { QueryClient } from "@tanstack/react-query";
import { startAuthentication } from "@simplewebauthn/browser";
import { api } from "./api.ts";
import { clearOfflineCache } from "./offline.tsx";

/*
 * Mode démo (côté écran) : entrer = la session passe sur les données fictives ; sortir = se
 * reconnecter avec sa clé d'accès (Face ID / Touch ID), ce qui ouvre une nouvelle session normale.
 * Dans les deux cas, tout ce qui est gardé à l'écran ou sur l'appareil est effacé, puis l'appli
 * repart de l'accueil : jamais un chiffre réel affiché en démo, ni l'inverse.
 */

function restart(qc: QueryClient) {
  qc.clear();
  clearOfflineCache();
  localStorage.removeItem("pecule.assistant.thread"); // conversation de l'autre monde (réelle ou fictive)
  window.location.assign("/");
}

export async function enterDemo(qc: QueryClient) {
  await api("/auth/demo", { method: "POST" });
  restart(qc);
}

export async function leaveDemo(qc: QueryClient) {
  const { options } = await api<{ options: Parameters<typeof startAuthentication>[0]["optionsJSON"] }>("/auth/login/options", { method: "POST" });
  const response = await startAuthentication({ optionsJSON: options });
  await api("/auth/login/verify", { method: "POST", json: { response } });
  restart(qc);
}
