import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Mic, Square, Volume2, VolumeX, X } from "lucide-react";
import { setVoiceSounds, type VoiceSession, type VoiceState } from "../voice.ts";
import { cn } from "../cn.ts";
import "../../styles/voix.css";
import { t } from "../../lib/i18n.ts";

const LABEL: Record<VoiceState, string> = {
  starting: t("Ouverture du micro…"),
  listening: t("Je t'écoute"),
  hearing: t("Je t'entends…"),
  transcribing: t("C'est noté…"),
  thinking: t("Je réfléchis…"),
  speaking: t("Je te réponds"),
  stopped: t("Micro coupé"),
};

const HELP: Partial<Record<VoiceState, string>> = {
  listening: t("Parle normalement : je réponds quand tu t'arrêtes. Dis « au revoir » pour terminer."),
  hearing: t("Je réponds dès que tu t'arrêtes."),
  transcribing: t("Ta question est prise en compte."),
  thinking: t("Je cherche dans tes données, un instant."),
  speaking: t("Touche le rond pour m'interrompre."),
};

/**
 * Conversation mains libres avec l'assistant : on parle, il répond à voix haute, puis il réécoute.
 * La session (micro, détection de la parole, lecture, sons) est ouverte par le bouton micro, dans le geste ;
 * cet écran ne fait que l'afficher et lui confier chaque tour de parole. Le pourtour de l'écran s'illumine
 * selon l'étape (`voix.css`) ; le niveau sonore est posé dans --voice-level sans nouveau rendu.
 */
export function VoiceMode({
  session,
  onTurn,
  onClose,
  hint,
  fixed,
}: {
  session: VoiceSession;
  onTurn: (spoken: string, say: (part: string) => void) => Promise<string | null>;
  onClose: () => void;
  hint?: string | null;
  fixed: boolean;
}) {
  const [state, setState] = useState<VoiceState>(session.state);
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sounds, setSounds] = useState(session.sounds);
  const root = useRef<HTMLDivElement>(null);
  const orb = useRef<HTMLSpanElement>(null);
  // Toujours la dernière version du tour de parole (elle dépend de la conversation en cours).
  const turn = useRef(onTurn);
  useEffect(() => {
    turn.current = onTurn;
  }, [onTurn]);

  useEffect(() => {
    const add = (part: string) => setSaid((s) => (s ? `${s} ${part}` : part));
    session.handlers = {
      onState: (s) => {
        setState(s);
        if (s === "hearing") setError(null);
      },
      onLevel: (level) => {
        const l = Math.min(1, level * 6);
        root.current?.style.setProperty("--voice-level", l.toFixed(3));
        if (orb.current) orb.current.style.transform = `scale(${1 + l * 0.45})`;
      },
      onHeard: (text) => {
        setHeard(text);
        setSaid("");
      },
      // Le texte s'affiche au fur et à mesure qu'il est confié à la voix.
      turn: async (text, say) => {
        const rest = await turn.current(text, (part) => {
          add(part);
          say(part);
        });
        if (rest) add(rest);
        return rest;
      },
      onError: setError,
    };
    setState(session.state);
    return () => {
      session.handlers = null;
    };
  }, [session]);

  const speaking = state === "speaking";
  const waiting = state === "transcribing" || state === "thinking";
  const screen = (
    <div
      ref={root}
      className={cn("flex flex-col items-center overflow-hidden bg-bg/95 px-6 pb-8 pt-4 backdrop-blur-md", fixed ? "safe-top fixed inset-0 z-[90]" : "absolute inset-0 z-40")}
      role="dialog"
      aria-label={t("Mode vocal de l'assistant")}
    >
      <div className="voice-edge" data-state={state} aria-hidden>
        <i />
      </div>
      <div className="relative flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-muted">{t("Mode vocal")}</span>
        <span className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => {
              session.sounds = !sounds;
              setVoiceSounds(!sounds);
              setSounds(!sounds);
            }}
            aria-pressed={sounds}
            aria-label={sounds ? t("Couper les sons du mode vocal") : t("Remettre les sons du mode vocal")}
            title={sounds ? t("Couper les sons (écoute, question prise, réflexion)") : t("Remettre les sons")}
            className="press grid size-10 place-items-center rounded-full text-muted hover:bg-line/50"
          >
            {sounds ? <Volume2 size={19} /> : <VolumeX size={19} />}
          </button>
          <button type="button" onClick={onClose} aria-label={t("Quitter le mode vocal")} className="press grid size-10 place-items-center rounded-full text-muted hover:bg-line/50">
            <X size={20} />
          </button>
        </span>
      </div>
      <div className="relative flex min-h-0 w-full max-w-md flex-1 flex-col items-center justify-center gap-6 text-center">
        <button
          type="button"
          onClick={() => session.interrupt()}
          disabled={!speaking}
          aria-label={speaking ? t("Interrompre la réponse") : LABEL[state]}
          className="relative grid size-40 shrink-0 place-items-center rounded-full disabled:cursor-default"
        >
          {/* Halo qui suit la voix (la tienne à l'écoute, celle de l'assistant pendant la réponse) ; anneau qui tourne pendant la réflexion. */}
          <span ref={orb} aria-hidden className="absolute inset-3 rounded-full bg-accent/25 transition-transform duration-75" />
          {waiting && <span aria-hidden className="voice-ring" />}
          <span aria-hidden className={cn("relative grid size-24 place-items-center rounded-full text-white shadow-lg transition-colors", state === "stopped" ? "bg-muted" : "bg-accent")}>
            {speaking ? <Square size={26} fill="currentColor" /> : <Mic size={32} />}
          </span>
        </button>
        <p className="text-lg font-semibold" aria-live="polite">
          {state === "thinking" && hint ? hint : LABEL[state]}
        </p>
        <div className="min-h-24 w-full space-y-3 overflow-y-auto">
          {heard && <p className="text-sm text-muted">« {heard} »</p>}
          {said && <p className="text-[15px] leading-relaxed">{said}</p>}
          {error && <p className="text-sm text-neg">{error}</p>}
        </div>
      </div>
      <p className="relative mb-4 min-h-8 text-center text-xs text-muted">{HELP[state] ?? ""}</p>
      <button type="button" onClick={onClose} className="press card relative w-full max-w-xs py-3.5 font-medium">
        {t("Terminer")}
      </button>
    </div>
  );
  // Plein écran (page de l'assistant) : en portail, au-dessus de l'en-tête et du menu ; dans le panneau latéral, il ne couvre que le panneau.
  return fixed ? createPortal(screen, document.body) : screen;
}
