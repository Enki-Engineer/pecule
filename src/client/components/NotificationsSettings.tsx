import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellOff, Send } from "lucide-react";
import { toast } from "sonner";
import { api } from "../api.ts";
import { useDesktop } from "../desktop.ts";
import { Card } from "./ui.tsx";
import { dateFr } from "../format.ts";
import { t } from "../../lib/i18n.ts";

/*
 * Notifications de cet appareil : activation (permission + abonnement Web Push), choix des alertes,
 * seuil de solde bas, essai, dernières notifications envoyées. Sur l'iPhone, il faut l'appli
 * installée sur l'écran d'accueil (iOS 16.4 ou plus).
 */

type Prefs = Record<string, boolean | number | undefined> & { lowBalance?: number };
const supported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const b64 = (s: string) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const deviceName = () => (isIos() ? "iPhone" : /Mac/.test(navigator.userAgent) ? "Mac" : /Android/.test(navigator.userAgent) ? "Android" : t("Ordinateur"));

export function NotificationsSettings() {
  const key = useQuery({ queryKey: ["push-key"], queryFn: () => api<{ publicKey: string; types: Record<string, string> }>("/push/key"), staleTime: Infinity });
  const recent = useQuery({ queryKey: ["push-recent"], queryFn: () => api<{ notifications: { title: string; body: string; sent_at: string }[] }>("/push/recent") });
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const desktop = useDesktop();

  // Abonnement déjà présent sur cet appareil ?
  useEffect(() => {
    if (!supported()) return;
    navigator.serviceWorker.ready
      .then((reg) => reg.pushManager.getSubscription())
      .then(async (sub) => {
        if (!sub) return;
        const r = await api<{ subscription: { prefs: Prefs } | null }>("/push/status", { method: "POST", json: { endpoint: sub.endpoint } });
        if (r.subscription) {
          setEndpoint(sub.endpoint);
          setPrefs(r.subscription.prefs);
        }
      })
      .catch(() => {});
  }, []);

  async function enable() {
    if (!key.data) return;
    setBusy(true);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") throw new Error(t("Autorisation refusée : active les notifications de Pécule dans les réglages de l'appareil."));
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(key.data.publicKey) }));
      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      const r = await api<{ subscription: { prefs: Prefs } }>("/push/subscribe", { method: "POST", json: { subscription: json, device: deviceName() } });
      setEndpoint(json.endpoint);
      setPrefs(r.subscription.prefs);
      toast.success(t("Notifications activées sur cet appareil"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("Activation impossible"));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    if (!endpoint) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    await api("/push/unsubscribe", { method: "POST", json: { endpoint } });
    await sub?.unsubscribe().catch(() => {});
    setEndpoint(null);
    setPrefs(null);
    toast.success(t("Notifications désactivées sur cet appareil"));
  }

  async function save(next: Prefs) {
    setPrefs(next);
    if (endpoint) await api("/push/prefs", { method: "PATCH", json: { endpoint, prefs: next } }).catch(() => toast.error(t("Réglage non enregistré")));
  }

  // La fenêtre de l'appli de bureau a de quoi s'abonner, mais aucun service ne lui porte les notifications.
  if (desktop) return <Card className="p-4 text-sm text-muted">{t("L'appli de bureau n'envoie pas encore de notifications.")}</Card>;
  if (!supported())
    return (
      <Card className="p-4 text-sm text-muted">
        {isIos() && !standalone()
          ? t("Pour recevoir les notifications sur l'iPhone, installe d'abord Pécule sur l'écran d'accueil (Partager → Sur l'écran d'accueil), puis ouvre l'appli depuis son icône et reviens ici.")
          : t("Ce navigateur ne gère pas les notifications.")}
      </Card>
    );

  return (
    <Card className="divide-y divide-line">
      {!endpoint ? (
        <div className="space-y-3 px-4 py-3">
          <p className="text-sm text-muted">
            {t("Reçois sur cet appareil les alertes utiles : opérations à classer, prélèvement nouveau ou inhabituel, solde bas, loyer non reçu, échéances, garanties, enveloppes, et le résumé de la semaine.")}
          </p>
          <button type="button" disabled={busy || !key.data} onClick={enable} className="press flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-[14px] font-semibold text-white disabled:opacity-50">
            <Bell size={16} /> {t("Activer sur cet appareil")}
          </button>
        </div>
      ) : (
        <>
          {Object.entries(key.data?.types ?? {}).map(([k, label]) => (
            <label key={k} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[14px]">
              <span>{label}</span>
              <input type="checkbox" checked={prefs?.[k] !== false} onChange={(e) => save({ ...prefs, [k]: e.target.checked })} className="size-5 shrink-0 accent-[var(--color-accent)]" />
            </label>
          ))}
          <div className="flex flex-wrap gap-2 px-4 py-3">
            <button
              type="button"
              onClick={() => api<{ sent: number }>("/push/test", { method: "POST" }).then((r) => toast.success(r.sent ? t("Notification d'essai envoyée") : t("Aucun appareil n'a reçu l'essai")))}
              className="press flex items-center gap-1.5 rounded-lg bg-card px-3 py-2 text-[13px] font-semibold ring-1 ring-line"
            >
              <Send size={14} /> {t("Essai")}
            </button>
            <button type="button" onClick={disable} className="press flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px] font-semibold text-neg">
              <BellOff size={14} /> {t("Désactiver sur cet appareil")}
            </button>
          </div>
        </>
      )}
      {(recent.data?.notifications.length ?? 0) > 0 && (
        <div className="px-4 py-3">
          <div className="mb-1 text-[12.5px] font-medium text-muted">{t("Dernières notifications")}</div>
          {recent.data!.notifications.slice(0, 6).map((n, i) => (
            <div key={i} className="flex justify-between gap-3 py-1 text-[13px]">
              <span className="min-w-0 truncate">
                <b>{n.title}</b> · <span className="text-muted">{n.body}</span>
              </span>
              <span className="shrink-0 text-[12px] text-muted">{dateFr(n.sent_at.slice(0, 10))}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
