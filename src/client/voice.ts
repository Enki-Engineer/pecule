import { VoiceGate, isVoiceId, voiceFor, type VoiceId } from "../lib/voice.ts";
import { t } from "../lib/i18n.ts";
import { appLang } from "./i18n.ts";

/*
 * Mode vocal de l'assistant, côté appareil : micro, détection de la parole, envoi de l'enregistrement à la
 * transcription, lecture de la réponse, puis réécoute — sans toucher l'écran. Le son passe par l'API Web Audio
 * (pas de balise audio : la politique de sécurité de contenu n'autorise pas les médias en mémoire, et l'iPhone
 * exige un contexte audio ouvert par un geste). `start()` doit donc être appelé dans le geste qui ouvre le mode.
 *
 * La réponse est dite au fil de son écriture : chaque morceau confié par le tour de parole (`say`) est demandé
 * tout de suite à la synthèse et joué à la suite des précédents. Des sons brefs marquent les étapes (écoute
 * ouverte, question prise, réflexion qui dure, erreur, fin), sauf si l'appareil les a coupés.
 */

export type VoiceState = "starting" | "listening" | "hearing" | "transcribing" | "thinking" | "speaking" | "stopped";

export type VoiceHandlers = {
  onState(state: VoiceState): void;
  /** Niveau sonore du micro (0 à 1), pour l'animation. */
  onLevel(level: number): void;
  /** Phrase comprise. */
  onHeard(text: string): void;
  /**
   * Tour de parole : `say` dit un morceau de la réponse dès qu'il est prêt (au fil de son écriture) ;
   * la valeur rendue est dite à la suite (fin de réponse, demande de confirmation), null s'il n'y a rien à ajouter.
   */
  turn(text: string, say: (part: string) => void): Promise<string | null>;
  onError(message: string): void;
};

const TICK_MS = 50;
/** Après le son d'ouverture de l'écoute, le micro n'est pas écouté un court instant : le son ne doit pas passer pour une voix. */
const DEAF_MS = 300;
/** Réflexion qui dure : premier battement après ce délai, puis à intervalles réguliers. */
const PULSE_AFTER_MS = 2500;
const PULSE_EVERY_MS = 2200;

/* ---------- Réglages de l'appareil ---------- */

const SOUNDS_KEY = "pecule.voice.sons";
const VOICE_KEY = "pecule.voice.voix";
/** Sons du mode vocal (activés par défaut). */
export const voiceSounds = () => localStorage.getItem(SOUNDS_KEY) !== "0";
export function setVoiceSounds(on: boolean) {
  if (on) localStorage.removeItem(SOUNDS_KEY);
  else localStorage.setItem(SOUNDS_KEY, "0");
}
/** Voix choisie sur cet appareil pour la langue de l'appli (une par langue) ; null = celle du serveur. */
const voiceKey = () => (appLang() === "fr" ? VOICE_KEY : `${VOICE_KEY}.${appLang()}`);
export function chosenVoice(): VoiceId | null {
  const v = localStorage.getItem(voiceKey());
  return isVoiceId(v) && voiceFor(appLang(), v) === v ? v : null;
}
export const setChosenVoice = (v: VoiceId) => localStorage.setItem(voiceKey(), v);

/* ---------- Sons ---------- */

export type Cue = "ecoute" | "pris" | "attente" | "erreur" | "fin";
/** Notes de chaque son : fréquence (Hz), départ et durée (s), volume. Doux et brefs : ils accompagnent, ils n'alertent pas. */
const CUES: Record<Cue, { f: number; at: number; len: number; gain: number }[]> = {
  // Deux notes qui montent : « à toi ».
  ecoute: [
    { f: 659, at: 0, len: 0.11, gain: 0.13 },
    { f: 988, at: 0.09, len: 0.17, gain: 0.13 },
  ],
  // Deux notes qui descendent : « c'est pris ».
  pris: [
    { f: 880, at: 0, len: 0.09, gain: 0.11 },
    { f: 587, at: 0.075, len: 0.16, gain: 0.11 },
  ],
  // Battement discret pendant la réflexion.
  attente: [{ f: 440, at: 0, len: 0.16, gain: 0.035 }],
  erreur: [
    { f: 330, at: 0, len: 0.14, gain: 0.11 },
    { f: 247, at: 0.13, len: 0.24, gain: 0.11 },
  ],
  fin: [
    { f: 784, at: 0, len: 0.12, gain: 0.1 },
    { f: 523, at: 0.11, len: 0.3, gain: 0.1 },
  ],
};

/** Joue un son bref sur le contexte audio donné (sinusoïdes à attaque douce : aucun fichier à charger). */
export function playCue(ctx: AudioContext, cue: Cue) {
  const t0 = ctx.currentTime + 0.01;
  for (const n of CUES[cue]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0.0001, t0 + n.at);
    gain.gain.exponentialRampToValueAtTime(n.gain, t0 + n.at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0 + n.at);
    osc.stop(t0 + n.at + n.len + 0.03);
  }
}

/** Demande la lecture d'un texte ; rend le MP3. */
export async function fetchSpeech(text: string, voice: VoiceId | null = chosenVoice()): Promise<ArrayBuffer> {
  const res = await fetch("/api/voice/speak", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json", "X-Langue": appLang() }, body: JSON.stringify({ text, voice: voice ?? undefined }) });
  if (!res.ok) await fail(res);
  return res.arrayBuffer();
}

const rms = (analyser: AnalyserNode, samples: Float32Array<ArrayBuffer>) => {
  analyser.getFloatTimeDomainData(samples);
  let sum = 0;
  for (const v of samples) sum += v * v;
  return Math.sqrt(sum / samples.length);
};
const MIMES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export const voiceSupported = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined" && typeof AudioContext !== "undefined";

async function fail(res: Response): Promise<never> {
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? t("Le mode vocal ne répond pas"));
}

export class VoiceSession {
  state: VoiceState = "starting";
  handlers: VoiceHandlers | null = null;
  /** Sons d'étape (écoute, question prise, réflexion) : réglage de l'appareil, modifiable en cours de conversation. */
  sounds = voiceSounds();
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  /** Niveau de la voix de l'assistant, pour l'animation pendant la réponse. */
  private output: AnalyserNode | null = null;
  private samples: Float32Array<ArrayBuffer> | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private gate = new VoiceGate({ idleMs: 3000 });
  private timer: number | null = null;
  private playing: AudioBufferSourceNode | null = null;
  private wake: { release(): Promise<void> } | null = null;
  /** Avance à chaque nouvelle phrase, interruption ou arrêt : ce qui reste d'un tour abandonné est ignoré. */
  private epoch = 0;
  /** Morceaux de la réponse en attente de lecture, dans l'ordre. */
  private parts: Promise<AudioBuffer>[] = [];
  /** Lecture en cours de la file (null quand elle est vide). */
  private talking: Promise<void> | null = null;
  private talkingId = 0;
  /** L'assistant écrit encore sa réponse. */
  private turning = false;
  /** Réponse interrompue : la suite n'est plus dite. */
  private cut = false;
  private deaf = 0;
  private waited = 0;
  private nextPulse = PULSE_AFTER_MS;

  /** À appeler dans le geste de l'utilisateur (bouton micro). */
  async start() {
    try {
      this.ctx = new AudioContext();
      await this.ctx.resume();
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      if (this.state === "stopped") return this.release();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.samples = new Float32Array(this.analyser.fftSize);
      this.ctx.createMediaStreamSource(this.stream).connect(this.analyser);
      this.output = this.ctx.createAnalyser();
      this.output.fftSize = 1024;
      this.output.connect(this.ctx.destination);
      await this.keepAwake();
      document.addEventListener("visibilitychange", this.onVisible);
      this.timer = window.setInterval(() => this.tick(), TICK_MS);
      this.listen();
    } catch (e) {
      this.release();
      this.set("stopped");
      this.handlers?.onError(e instanceof Error && (e.name === "NotAllowedError" || e.name === "SecurityError") ? t("Autorise le micro pour parler à l'assistant.") : t("Micro indisponible sur cet appareil."));
    }
  }

  /** Coupe la réponse en cours de lecture et réécoute. */
  interrupt() {
    if (this.state !== "speaking") return;
    this.cut = true;
    this.parts = [];
    this.silence();
    // La réponse s'écrit encore : on attend sa fin sans la dire (elle reste à l'écran), puis on réécoute.
    if (this.turning) return this.set("thinking");
    this.epoch++;
    this.listen();
  }

  stop() {
    const open = this.state !== "stopped" && this.state !== "starting";
    this.epoch++;
    this.set("stopped");
    this.release(open);
  }

  private set(state: VoiceState) {
    const waiting = (s: VoiceState) => s === "transcribing" || s === "thinking";
    if (waiting(state) && !waiting(this.state)) {
      this.waited = 0;
      this.nextPulse = PULSE_AFTER_MS;
    }
    this.state = state;
    this.handlers?.onState(state);
  }

  private cue(cue: Cue) {
    if (this.sounds && this.ctx) playCue(this.ctx, cue);
  }

  /** Écran allumé pendant la conversation, quand l'appareil le permet. */
  private async keepAwake() {
    const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
    this.wake = wl ? await wl.request("screen").catch(() => null) : null;
  }

  /** Retour dans l'appli : l'appareil a pu suspendre le son et rendre la main sur l'écran. */
  private onVisible = () => {
    if (document.visibilityState !== "visible" || this.state === "stopped") return;
    void this.ctx?.resume().catch(() => undefined);
    void this.keepAwake();
  };

  /** `farewell` : son de fin, joué avant de fermer le contexte audio. */
  private release(farewell = false) {
    if (this.timer != null) window.clearInterval(this.timer);
    this.timer = null;
    document.removeEventListener("visibilitychange", this.onVisible);
    this.parts = [];
    this.silence();
    this.discard();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    const ctx = this.ctx;
    this.ctx = null;
    if (ctx) {
      if (farewell && this.sounds) playCue(ctx, "fin");
      window.setTimeout(() => void ctx.close().catch(() => undefined), farewell ? 700 : 0);
    }
    void this.wake?.release().catch(() => undefined);
    this.wake = null;
  }

  private silence() {
    try {
      this.playing?.stop();
    } catch {
      // déjà arrêtée
    }
    this.playing = null;
  }

  /** Ouvre l'écoute ; `quiet` : sans le son « à toi » (après un son d'erreur). */
  private listen(quiet = false) {
    if (!this.stream) return;
    this.gate = new VoiceGate({ idleMs: 3000 });
    this.record();
    if (!quiet) this.cue("ecoute");
    this.deaf = !quiet && this.sounds ? DEAF_MS : 0;
    this.set("listening");
  }

  private record() {
    this.discard();
    this.chunks = [];
    const mimeType = MIMES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => {
      if (e.data.size && this.recorder === rec) this.chunks.push(e.data);
    };
    this.recorder = rec;
    rec.start();
  }

  /** Arrête l'enregistrement sans le garder. */
  private discard() {
    const rec = this.recorder;
    this.recorder = null;
    if (rec && rec.state !== "inactive") rec.stop();
  }

  /** Arrête l'enregistrement et rend la phrase. */
  private finish(): Promise<Blob> {
    const rec = this.recorder;
    return new Promise((resolve) => {
      if (!rec || rec.state === "inactive") return resolve(new Blob(this.chunks));
      rec.onstop = () => {
        const blob = new Blob(this.chunks, { type: rec.mimeType || "audio/webm" });
        if (this.recorder === rec) this.recorder = null;
        resolve(blob);
      };
      rec.stop();
    });
  }

  private tick() {
    if (!this.analyser || !this.output || !this.samples) return;
    const hearing = this.state === "listening" || this.state === "hearing";
    const level = rms(this.analyser, this.samples);
    // Animation : la voix de l'utilisateur pendant l'écoute, celle de l'assistant pendant la réponse, rien sinon.
    this.handlers?.onLevel(hearing ? level : this.state === "speaking" ? rms(this.output, this.samples) : 0);
    if (this.state === "transcribing" || this.state === "thinking") {
      this.waited += TICK_MS;
      if (this.waited >= this.nextPulse) {
        this.nextPulse += PULSE_EVERY_MS;
        this.cue("attente");
      }
    }
    if (!hearing) return;
    if (this.deaf > 0) return void (this.deaf -= TICK_MS);
    const event = this.gate.push(level, TICK_MS);
    if (event === "speech-start") this.set("hearing");
    // Long silence : on repart d'un enregistrement vide, pour ne pas transcrire des secondes de silence.
    else if (event === "timeout") this.record();
    else if (event === "speech-end") void this.utterance();
  }

  private async utterance() {
    const mine = ++this.epoch;
    this.cut = false;
    this.parts = [];
    this.cue("pris");
    this.set("transcribing");
    try {
      const blob = await this.finish();
      const res = await fetch("/api/voice/transcribe", { method: "POST", credentials: "same-origin", headers: { "Content-Type": blob.type || "audio/webm", "X-Langue": appLang() }, body: blob });
      if (!res.ok) await fail(res);
      const { text } = (await res.json()) as { text: string };
      if (mine !== this.epoch) return;
      // Rien de compris (bruit, souffle) : on réécoute.
      if (text.replace(/[^\p{L}\p{N}]/gu, "").length < 2) return this.listen();
      this.handlers?.onHeard(text);
      this.set("thinking");
      this.turning = true;
      let rest: string | null | undefined;
      try {
        rest = await this.handlers?.turn(text, (part) => this.say(part, mine));
      } finally {
        if (mine === this.epoch) this.turning = false;
      }
      if (mine !== this.epoch) return;
      if (rest) this.say(rest, mine);
      while (this.talking) await this.talking;
      if (mine !== this.epoch) return;
      this.listen();
    } catch (e) {
      if (mine !== this.epoch) return;
      this.turning = false;
      this.handlers?.onError(e instanceof Error ? e.message : t("Le mode vocal ne répond pas"));
      this.cue("erreur");
      this.listen(true);
    }
  }

  /** Ajoute un morceau à dire : la synthèse part tout de suite, la lecture suit l'ordre d'arrivée. */
  private say(text: string, mine: number) {
    const ctx = this.ctx;
    if (mine !== this.epoch || this.cut || !ctx || !text.trim()) return;
    const part = fetchSpeech(text).then((data) => ctx.decodeAudioData(data));
    // Un morceau en échec ne doit pas rester sans gestionnaire pendant que le précédent est lu.
    part.catch(() => undefined);
    this.parts.push(part);
    if (!this.talking) {
      const id = ++this.talkingId;
      this.talking = this.drain(mine, id);
    }
  }

  /** Lit la file jusqu'à ce qu'elle soit vide ; entre deux morceaux d'une réponse qui s'écrit encore, retour à « réflexion ». */
  private async drain(mine: number, id: number) {
    try {
      for (let part = this.parts.shift(); part; part = this.parts.shift()) {
        const buffer = await part;
        if (mine !== this.epoch || this.cut || !this.ctx) return;
        // « Je te réponds » seulement quand la voix démarre vraiment (la synthèse du premier morceau a pris un instant).
        if (this.state !== "speaking") this.set("speaking");
        await this.play(buffer);
        if (mine !== this.epoch || this.cut) return;
      }
    } catch (e) {
      if (mine !== this.epoch || this.cut) return;
      // La voix manque : la réponse reste à l'écran, on n'insiste pas sur la suite.
      this.cut = true;
      this.parts = [];
      this.handlers?.onError(e instanceof Error ? e.message : t("La voix de l'assistant ne répond pas"));
    } finally {
      if (this.talkingId === id) {
        this.talking = null;
        if (mine === this.epoch && this.turning && this.state === "speaking") this.set("thinking");
      }
    }
  }

  /** Joue un morceau ; se termine à la fin de la lecture, ou dès qu'elle est coupée. */
  private play(buffer: AudioBuffer): Promise<void> {
    return new Promise((resolve) => {
      const source = this.ctx!.createBufferSource();
      source.buffer = buffer;
      source.connect(this.output ?? this.ctx!.destination);
      source.onended = () => {
        if (this.playing === source) this.playing = null;
        resolve();
      };
      this.playing = source;
      source.start();
    });
  }
}
