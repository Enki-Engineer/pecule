/*
 * Mode vocal de l'assistant : fonctions pures partagées par le serveur et l'écran.
 * - VOICES, speechSsml : les voix proposées et la demande de synthèse (la langue y est imposée) ;
 * - speechText : ce qui est lu à voix haute (une réponse de l'assistant, débarrassée de sa mise en forme) ;
 * - SpeechStream : découpe de la réponse en morceaux à dire, au fil de son écriture ;
 * - spokenDecision : « confirme » / « annule » dit à voix haute quand une action attend une confirmation ;
 * - spokenFarewell : « au revoir » dit à voix haute, qui termine la conversation ;
 * - isPhantom : phrases que la transcription invente sur du bruit ;
 * - VoiceGate : détection de la parole (début, fin de phrase) à partir du niveau sonore du micro.
 */

import { currentLang, langInfo, t, tk, type Lang } from "./i18n.ts";

/**
 * Voix de l'assistant : voix neuronales d'Azure, servies par la même ressource Foundry que Claude, deux
 * naturelles (« Dragon HD ») et deux rapides par langue de Pécule. La langue est celle de la voix (et répétée
 * dans la demande) : elle n'est jamais devinée d'après le texte, ce qui faisait basculer l'ancienne voix en
 * anglais sur un nom de marque ou une longue réponse.
 */
const NATURAL = tk("Naturelle et posée");
const FAST = tk("Claire, la plus rapide");
export const VOICES = [
  { id: "vivienne", lang: "fr", label: "Vivienne", hint: NATURAL, name: "fr-FR-Vivienne:DragonHDLatestNeural" },
  { id: "remy", lang: "fr", label: "Rémy", hint: NATURAL, name: "fr-FR-Remy:DragonHDLatestNeural" },
  { id: "denise", lang: "fr", label: "Denise", hint: FAST, name: "fr-FR-DeniseNeural" },
  { id: "henri", lang: "fr", label: "Henri", hint: FAST, name: "fr-FR-HenriNeural" },
  { id: "ada", lang: "en", label: "Ada", hint: NATURAL, name: "en-GB-Ada:DragonHDLatestNeural" },
  { id: "ollie", lang: "en", label: "Ollie", hint: NATURAL, name: "en-GB-Ollie:DragonHDLatestNeural" },
  { id: "sonia", lang: "en", label: "Sonia", hint: FAST, name: "en-GB-SoniaNeural" },
  { id: "ryan", lang: "en", label: "Ryan", hint: FAST, name: "en-GB-RyanNeural" },
  { id: "seraphina", lang: "de", label: "Seraphina", hint: NATURAL, name: "de-DE-Seraphina:DragonHDLatestNeural" },
  { id: "florian", lang: "de", label: "Florian", hint: NATURAL, name: "de-DE-Florian:DragonHDLatestNeural" },
  { id: "katja", lang: "de", label: "Katja", hint: FAST, name: "de-DE-KatjaNeural" },
  { id: "conrad", lang: "de", label: "Conrad", hint: FAST, name: "de-DE-ConradNeural" },
  { id: "isabella", lang: "it", label: "Isabella", hint: NATURAL, name: "it-IT-Isabella:DragonHDLatestNeural" },
  { id: "alessio", lang: "it", label: "Alessio", hint: NATURAL, name: "it-IT-Alessio:DragonHDLatestNeural" },
  { id: "elsa", lang: "it", label: "Elsa", hint: FAST, name: "it-IT-ElsaNeural" },
  { id: "diego", lang: "it", label: "Diego", hint: FAST, name: "it-IT-DiegoNeural" },
  { id: "ximena", lang: "es", label: "Ximena", hint: NATURAL, name: "es-ES-Ximena:DragonHDLatestNeural" },
  { id: "tristan", lang: "es", label: "Tristán", hint: NATURAL, name: "es-ES-Tristan:DragonHDLatestNeural" },
  { id: "elvira", lang: "es", label: "Elvira", hint: FAST, name: "es-ES-ElviraNeural" },
  { id: "alvaro", lang: "es", label: "Álvaro", hint: FAST, name: "es-ES-AlvaroNeural" },
] as const satisfies readonly { id: string; lang: Lang; label: string; hint: string; name: string }[];
export type VoiceId = (typeof VOICES)[number]["id"];
export const VOICE_IDS = VOICES.map((v) => v.id) as [VoiceId, ...VoiceId[]];
export const DEFAULT_VOICE: VoiceId = "vivienne";
export const isVoiceId = (v: unknown): v is VoiceId => VOICES.some((x) => x.id === v);
/** Voix proposées dans une langue (la première est celle par défaut). */
export const voicesOf = (lang: Lang) => VOICES.filter((v) => v.lang === lang);
/** La voix demandée si elle parle la langue voulue, sinon la première de cette langue : jamais une voix d'une autre langue. */
export function voiceFor(lang: Lang, wanted?: string | null): VoiceId {
  const list = voicesOf(lang);
  return (list.find((v) => v.id === wanted) ?? list[0]).id;
}

/** Demande de synthèse (SSML) : le texte est lu dans la langue de la voix, quels que soient les mots étrangers qu'il contient. */
export function speechSsml(text: string, voice: VoiceId): string {
  const v = VOICES.find((x) => x.id === voice)!;
  const xmlLang = langInfo(v.lang).locale;
  const safe = text
    // Caractères interdits en XML 1.0.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${xmlLang}"><voice name="${v.name}"><lang xml:lang="${xmlLang}">${safe}</lang></voice></speak>`;
}

/** Longueur maximale lue à voix haute (au-delà, la suite reste à l'écran). */
export const MAX_SPEECH = 1500;

/** Texte à lire : sans Markdown, tableaux, liens ni symboles ; coupé à la fin d'une phrase s'il est trop long. */
export function speechText(markdown: string, max = MAX_SPEECH): string {
  let text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    // Lignes de tableau : on garde le contenu des cellules, pas les barres ni les lignes de séparation.
    .replace(/^[ \t]*\|?[ \t:|-]{3,}\|?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*)\|[ \t]*$/gm, (_m, row: string) => row.split("|").map((c) => c.trim()).filter(Boolean).join(", ") + ".")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/(\*\*|__|\*|_|`|~~)/g, "")
    .replace(/[✦→←↑↓▲▼●■✓✗]/g, " ")
    // Émojis et pictogrammes : la voix les décrirait ou buterait dessus.
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, " ")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "), cut.lastIndexOf("! "));
  text = end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, cut.lastIndexOf(" "));
  return `${text.trim()} ${t("La suite est à l'écran.")}`;
}

/**
 * Lecture au fil de la réponse : reçoit le texte tel qu'il arrive de l'assistant et rend les morceaux prêts à
 * être dits. La première phrase part dès qu'elle est complète (la voix démarre pendant que la suite s'écrit),
 * les suivantes par groupes (moins de demandes, intonation plus naturelle). Au-delà de `max` caractères,
 * la suite reste à l'écran.
 */
export class SpeechStream {
  private buf = "";
  private ready = "";
  private count = 0;
  private full = false;
  /** Vrai dès qu'un morceau a été rendu. */
  spoke = false;
  constructor(private o: { first?: number; group?: number; max?: number } = {}) {}

  /** Ajoute un fragment de texte ; rend les morceaux désormais complets. */
  push(delta: string): string[] {
    this.buf += delta;
    return this.take(false);
  }

  /** Fin de la réponse : rend ce qui reste. */
  flush(): string[] {
    return this.take(true);
  }

  private take(end: boolean): string[] {
    const out: string[] = [];
    // Fin de phrase : ponctuation forte suivie d'un blanc, ou saut de ligne.
    for (let m = SENTENCE_END.exec(this.buf); m; m = SENTENCE_END.exec(this.buf)) {
      const cut = m.index + m[0].length;
      this.ready += this.buf.slice(0, cut);
      this.buf = this.buf.slice(cut);
      this.emit(out, false);
    }
    if (end) {
      this.ready += this.buf;
      this.buf = "";
      this.emit(out, true);
    }
    return out;
  }

  private emit(out: string[], force: boolean) {
    if (this.full) return void (this.ready = "");
    const { first = 8, group = 90, max = MAX_SPEECH } = this.o;
    const text = speechText(this.ready, Infinity);
    // Un fragment trop court (« M. », « 1. ») attend la suite : il n'est pas forcément une phrase.
    if (!force && text.length < (this.spoke ? group : first)) return;
    this.ready = "";
    if (!text) return;
    this.spoke = true;
    if (this.count + text.length > max && this.count > 0) {
      this.full = true;
      out.push(t("La suite est à l'écran."));
      return;
    }
    this.count += text.length;
    out.push(text);
  }
}
const SENTENCE_END = /[.!?…]+["»)\]]*\s+|\n+/;

/** Texte dit, ramené à des mots simples : minuscules, sans accents ni ponctuation. */
const plain = (text: string) =>
  text
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’`´]/g, "'")
    .replace(/[^a-z' ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Mots d'accord et de refus, par langue (texte sans accents). */
const DECISION: Record<Lang, { yes: RegExp; no: RegExp }> = {
  fr: {
    no: /^(non|annule|annuler|stop|laisse tomber|pas maintenant|ne fais rien|surtout pas)\b/,
    yes: /^(oui|ouais|confirme|confirmer|je confirme|vas y|d'accord|ok|okay|c'est bon|valide|valider|fais le|parfait)\b/,
  },
  en: {
    no: /^(no|nope|cancel|stop|don't|do not|never mind|not now|forget it)\b/,
    yes: /^(yes|yeah|yep|confirm|confirmed|i confirm|go ahead|do it|ok|okay|sure|all right|alright|that's fine|perfect|please do)\b/,
  },
  de: {
    no: /^(nein|abbrechen|abbruch|stopp|stop|lass es|nicht jetzt|vergiss es|auf keinen fall)\b/,
    yes: /^(ja|jawohl|bestatige|bestatigen|ich bestatige|mach das|mach es|ok|okay|einverstanden|in ordnung|genau|perfekt|gerne)\b/,
  },
  it: {
    no: /^(no|annulla|annullare|stop|ferma|lascia stare|lascia perdere|non ora|non adesso)\b/,
    yes: /^(si|confermo|conferma|confermare|va bene|d'accordo|ok|okay|certo|fallo|perfetto|procedi)\b/,
  },
  es: {
    no: /^(no|cancela|cancelar|anula|anular|stop|dejalo|ahora no|olvidalo)\b/,
    yes: /^(si|confirmo|confirma|confirmar|vale|de acuerdo|ok|okay|claro|hazlo|perfecto|adelante)\b/,
  },
};

/** Réponse orale à une demande de confirmation : true = confirmer, false = annuler, null = autre chose (nouvelle question). */
export function spokenDecision(text: string, lang: Lang = currentLang()): boolean | null {
  const said = plain(text);
  if (!said || said.split(" ").length > 6) return null;
  if (DECISION[lang].no.test(said)) return false;
  if (DECISION[lang].yes.test(said)) return true;
  return null;
}

/** Façons de terminer la conversation, par langue (texte sans accents) : un remerciement facultatif, puis l'adieu. */
const FAREWELL: Record<Lang, RegExp> = {
  fr: /^((merci|ok|okay|super|parfait|non|bon|allez|bien)( beaucoup| pecule| merci)* )?(c'est tout|ce sera tout|c'est bon merci|au revoir|a plus tard|a plus|a bientot|a demain|bonne (journee|soiree|nuit)|stop|arrete|termine|terminer|fin de la conversation|tu peux (t'arreter|arreter|fermer)|ferme le mode vocal|quitte le mode vocal)\b/,
  en: /^((thanks|thank you|ok|okay|great|perfect|no|well)( very much| a lot| pecule| thanks)* )?(that's all|that is all|that will be all|goodbye|good bye|bye|see you|good night|have a (good|nice) (day|evening|night)|stop|i'm done|we're done|you can stop|close voice mode|end the conversation)\b/,
  de: /^((danke|vielen dank|ok|okay|super|perfekt|nein|gut)( schon| sehr| pecule| danke)* )?(das ist alles|das war's|das wars|das war alles|auf wiedersehen|tschuss|bis spater|bis bald|bis morgen|gute nacht|schonen (tag|abend)|stopp|stop|fertig|beenden|schluss|du kannst aufhoren)\b/,
  it: /^((grazie|ok|okay|perfetto|no|bene)( mille| tante| pecule| grazie)* )?(e tutto|questo e tutto|basta cosi|arrivederci|ciao ciao|a dopo|a presto|a domani|buona (giornata|serata|notte)|stop|fermati|chiudi|ho finito|puoi fermarti)\b/,
  es: /^((gracias|muchas gracias|ok|okay|vale|perfecto|no|bien)( pecule| gracias)* )?(eso es todo|es todo|nada mas|adios|hasta luego|hasta pronto|hasta manana|que tengas (un )?buen dia|stop|detente|termina|terminar|cierra|ya esta|he terminado|puedes parar)\b/,
};

/** « Au revoir », « merci, c'est tout », « stop » : la conversation vocale se termine. Une vraie question n'est jamais prise pour un adieu. */
export function spokenFarewell(text: string, lang: Lang = currentLang()): boolean {
  const said = plain(text);
  if (!said || said.split(" ").length > 6) return false;
  return FAREWELL[lang].test(said);
}

/** Phrases que la transcription invente sur un bruit ou un silence (génériques de sous-titres, dans toutes les langues) : à ignorer. */
export function isPhantom(text: string): boolean {
  return /sous[- ]?titr|amara\.org|soustitreur|merci d'avoir regard|abonnez[- ]vous|radio[- ]canada|thanks? for watching|subtitles? by|untertitel|danke furs zuschauen|sottotitoli|grazie per (aver guardato|la visione)|subtitulos|gracias por ver/.test(plain(text).replace(/ org\b/, ".org"));
}

export type GateEvent = "speech-start" | "speech-end" | "timeout" | null;

/**
 * Détection de la parole sur le niveau sonore (RMS entre 0 et 1), appelée à intervalles réguliers.
 * Le seuil suit le bruit ambiant ; la phrase commence après `startMs` au-dessus du seuil et finit après
 * `endMs` de silence. Sans parole pendant `idleMs`, « timeout » (on vide l'enregistrement et on réécoute).
 */
export class VoiceGate {
  private noise = 0.008;
  private above = 0;
  private below = 0;
  private idle = 0;
  private spoken = 0;
  speaking = false;
  constructor(private o: { startMs?: number; endMs?: number; idleMs?: number; maxMs?: number; floor?: number } = {}) {}

  get threshold() {
    return Math.max(this.o.floor ?? 0.012, this.noise * 3);
  }

  push(level: number, dtMs: number): GateEvent {
    const { startMs = 150, endMs = 1100, idleMs = 8000, maxMs = 30000 } = this.o;
    const loud = level > this.threshold;
    if (!this.speaking) {
      // Le bruit ambiant n'est appris que hors parole, lentement.
      if (!loud) this.noise = this.noise * 0.95 + level * 0.05;
      this.above = loud ? this.above + dtMs : 0;
      this.idle += dtMs;
      if (this.above >= startMs) {
        this.speaking = true;
        this.spoken = this.above;
        this.below = 0;
        this.idle = 0;
        return "speech-start";
      }
      if (this.idle >= idleMs) {
        this.idle = 0;
        return "timeout";
      }
      return null;
    }
    this.spoken += dtMs;
    this.below = loud ? 0 : this.below + dtMs;
    if (this.below >= endMs || this.spoken >= maxMs) {
      this.speaking = false;
      this.above = 0;
      this.below = 0;
      return "speech-end";
    }
    return null;
  }
}
