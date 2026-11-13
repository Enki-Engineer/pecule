import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Play, Square } from "lucide-react";
import { api } from "../api.ts";
import { cn } from "../cn.ts";
import { Card } from "./ui.tsx";
import { voiceFor, voicesOf, type VoiceId } from "../../lib/voice.ts";
import { chosenVoice, fetchSpeech, playCue, setChosenVoice, setVoiceSounds, voiceSounds, voiceSupported } from "../voice.ts";
import { t } from "../../lib/i18n.ts";
import { appLang } from "../i18n.ts";

/** iPhone ou iPad (qui se présente comme un Mac) : là où l'accord du micro n'est pas gardé. */
const isApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

// Extrait dit dans la langue de l'appli (traduit comme le reste).
const SAMPLE = t("Bonjour, c'est Pécule. En octobre, vous avez dépensé 612 euros en courses, surtout chez Carrefour Market et Grand Frais.");

/** Mode vocal de l'assistant (réglages de l'appareil) : la voix qui répond, avec un extrait à écouter, et les sons d'étape. */
export function VoiceSettings() {
  const status = useQuery({ queryKey: ["voice-status"], queryFn: () => api<{ enabled: boolean; voice?: string }>("/voice/status"), staleTime: Infinity });
  const [voice, setVoice] = useState<VoiceId | null>(chosenVoice);
  const [sounds, setSounds] = useState(voiceSounds);
  const [playing, setPlaying] = useState<VoiceId | null>(null);
  const audio = useRef<{ ctx: AudioContext; id: number } | null>(null);
  if (!status.data?.enabled || !voiceSupported()) return null;
  // Voix de la langue de l'appli seulement : la voix choisie ici, sinon celle que le serveur prendrait.
  const voices = voicesOf(appLang());
  const current = voiceFor(appLang(), voice ?? status.data.voice);

  function stop() {
    void audio.current?.ctx.close().catch(() => undefined);
    audio.current = null;
    setPlaying(null);
  }

  /** Extrait : le contexte audio est ouvert dans le geste (exigence de l'iPhone), la voix arrive ensuite. */
  async function listen(id: VoiceId) {
    const was = playing;
    stop();
    if (was === id) return;
    const me = { ctx: new AudioContext(), id: Date.now() };
    audio.current = me;
    setPlaying(id);
    try {
      await me.ctx.resume();
      const buffer = await me.ctx.decodeAudioData(await fetchSpeech(SAMPLE, id));
      if (audio.current !== me) return;
      const source = me.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(me.ctx.destination);
      source.onended = () => {
        if (audio.current === me) stop();
      };
      source.start();
    } catch (e) {
      if (audio.current !== me) return;
      stop();
      toast.error(e instanceof Error ? e.message : t("Extrait indisponible"));
    }
  }

  return (
    <section id="voix" className="scroll-mt-20">
      <h2 className="mb-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted">{t("Mode vocal")}</h2>
      <Card className="divide-y divide-line">
        {voices.map((v) => (
          <div key={v.id} className="flex items-center gap-3 px-4 py-2.5">
            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
              <input
                type="radio"
                name="voix"
                checked={current === v.id}
                onChange={() => {
                  setChosenVoice(v.id);
                  setVoice(v.id);
                }}
                className="size-4.5 shrink-0 accent-[var(--color-accent)]"
              />
              <span className="min-w-0">
                <span className="block text-[15px] font-medium">{v.label}</span>
                <span className="block text-xs text-muted">{t(v.hint)}</span>
              </span>
            </label>
            <button
              type="button"
              onClick={() => void listen(v.id)}
              aria-label={playing === v.id ? t("Arrêter l'extrait de {nom}", { nom: v.label }) : t("Écouter {nom}", { nom: v.label })}
              className={cn("press flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium", playing === v.id ? "bg-accent text-white" : "bg-line/60")}
            >
              {playing === v.id ? <Square size={12} fill="currentColor" /> : <Play size={13} fill="currentColor" />}
              {playing === v.id ? t("Arrêter") : t("Écouter")}
            </button>
          </div>
        ))}
        <label className="flex items-center justify-between gap-3 px-4 py-3">
          <span>
            <span className="block text-[15px] font-medium">{t("Sons de la conversation")}</span>
            <span className="block text-xs text-muted">{t("Deux notes quand l'écoute s'ouvre, deux autres quand ta question est prise, un battement discret quand la réflexion dure.")}</span>
          </span>
          <input
            type="checkbox"
            checked={sounds}
            onChange={(e) => {
              setVoiceSounds(e.target.checked);
              setSounds(e.target.checked);
              if (e.target.checked) {
                // Aperçu : le son d'ouverture de l'écoute.
                const ctx = new AudioContext();
                void ctx.resume().then(() => playCue(ctx, "ecoute"));
                window.setTimeout(() => void ctx.close().catch(() => undefined), 800);
              }
            }}
            className="size-5 shrink-0 accent-[var(--color-accent)]"
          />
        </label>
      </Card>
      <p className="mt-2 px-1 text-xs text-muted">
        {t("Réglages propres à cet appareil. La voix parle la langue de Pécule quel que soit le texte ; rien n'est gardé, ni ce que tu dis ni ce qui est lu. Le mode vocal s'ouvre dans l'assistant, avec le bouton à la place d'« Envoyer » quand le champ est vide.")}
      </p>
      {isApple() && (
        <p className="mt-2 px-1 text-xs text-muted">
          {t("L'iPhone te redemande le micro à chaque conversation ? Il ne garde pas cet accord pour une appli de l'écran d'accueil. Pour ne plus avoir la question : Réglages de l'iPhone → Apps → Safari → Micro → Autoriser. Ce choix vaut pour tous les sites ouverts dans Safari ; le témoin orange s'allume toujours quand le micro sert.")}
        </p>
      )}
    </section>
  );
}
