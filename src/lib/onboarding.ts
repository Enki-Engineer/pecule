import { DEFAULT_REGION, isFrance, regionOf, type Region } from "./countries.ts";
import { FRENCH_MODULES, MODULES, type ModuleId } from "./modules.ts";

/*
 * Bienvenue : la présentation que voit un membre à sa première connexion (écran /bienvenue,
 * src/client/pages/Onboarding.tsx). Règles pures : l'ordre des étapes selon le membre, les réglages du foyer
 * proposés à l'administrateur d'une installation neuve, et l'avancement du guide Enable Banking d'après ce que
 * Pécule sait lire. Aucun accès au réseau ni au stockage.
 */

/** Étapes de la présentation, dans l'ordre. « banque » prolonge « comptes » : c'est le guide Enable Banking. */
export const WELCOME_STEPS = ["bienvenue", "foyer", "reperes", "comptes", "banque", "pret"] as const;
export type WelcomeStep = (typeof WELCOME_STEPS)[number];

/** Parcours d'un membre : « Ton foyer » ne se règle que par l'administrateur. */
export const welcomeFlow = (member: { admin: boolean }): WelcomeStep[] => WELCOME_STEPS.filter((s) => s !== "foyer" || member.admin);

/** Une étape lue dans l'adresse ou gardée par l'appareil, si elle fait partie du parcours de ce membre. */
export const asWelcomeStep = (value: unknown, flow: readonly WelcomeStep[]): WelcomeStep | null => flow.find((s) => s === value) ?? null;

/** Avancement affiché : le guide de la banque compte avec « Tes comptes ». */
export function welcomeProgress(step: WelcomeStep, flow: readonly WelcomeStep[]): { index: number; total: number } {
  const main = flow.filter((s) => s !== "banque");
  return { index: Math.max(0, main.indexOf(step === "banque" ? "comptes" : step)), total: main.length };
}

/** Étape suivante. Après « Tes comptes » : le guide de la banque si le membre a choisi de la relier, sinon la fin. */
export function nextWelcomeStep(step: WelcomeStep, flow: readonly WelcomeStep[], opts: { bank?: boolean } = {}): WelcomeStep | null {
  if (step === "comptes") return opts.bank ? "banque" : "pret";
  const i = flow.indexOf(step);
  return i < 0 ? null : (flow[i + 1] ?? null);
}

/** Étape d'avant, quand on ne sait pas par où le membre est passé (présentation reprise en cours de route). */
export function previousWelcomeStep(step: WelcomeStep, flow: readonly WelcomeStep[]): WelcomeStep | null {
  if (step === "pret") return "comptes";
  const i = flow.indexOf(step);
  return i > 0 ? flow[i - 1] : null;
}

/* ---------- Ton foyer : pays, devise, fuseau, écrans gardés ---------- */

export type HouseholdDraft = Region & { modulesOff: ModuleId[] };

/** Écrans retirés, dans l'ordre du référentiel et sans doublon (deux listes égales s'écrivent pareil). */
const ordered = (off: readonly ModuleId[]): ModuleId[] => MODULES.filter((m) => off.includes(m));

/**
 * Réglages proposés à l'administrateur. Une installation neuve, encore réglée sur les valeurs d'origine, prend ce
 * que dit le navigateur (pays, devise, fuseau) ; hors de France, les écrans qui lisent des documents français
 * sortent du menu. Un foyer déjà réglé, ou qui a déjà des comptes, garde ce qu'il a : rien n'est proposé à sa place.
 */
export function proposedHousehold(current: HouseholdDraft, guess: Region, fresh: boolean): HouseholdDraft {
  const untouched = current.country === DEFAULT_REGION.country && current.currency === DEFAULT_REGION.currency && current.timeZone === DEFAULT_REGION.timeZone;
  if (!fresh || !untouched) return { ...current, modulesOff: ordered(current.modulesOff) };
  return { ...guess, modulesOff: ordered(isFrance(guess.country) ? current.modulesOff : [...current.modulesOff, ...FRENCH_MODULES]) };
}

/**
 * Un autre pays choisi dans la présentation : sa devise et son fuseau suivent (le fuseau du navigateur, s'il est
 * bien dans ce pays) ; les écrans propres à la France sortent du menu hors de France, et y reviennent en France.
 */
export function draftWithCountry(draft: HouseholdDraft, country: string, guess: Region): HouseholdDraft {
  const next = regionOf(country);
  const others = draft.modulesOff.filter((m) => !FRENCH_MODULES.includes(m));
  return {
    country: next.country,
    currency: next.currency,
    timeZone: next.country === guess.country ? guess.timeZone : next.timeZone,
    modulesOff: ordered(isFrance(next.country) ? others : [...others, ...FRENCH_MODULES]),
  };
}

/** Ce qui est à enregistrer : seulement ce qui a changé — une présentation rejouée sans rien toucher n'écrit rien. */
export function householdChanges(before: HouseholdDraft, draft: HouseholdDraft): { settings: Partial<Pick<HouseholdDraft, "country" | "timeZone" | "modulesOff">> | null; currency: string | null } {
  const settings: Partial<Pick<HouseholdDraft, "country" | "timeZone" | "modulesOff">> = {};
  if (draft.country !== before.country) settings.country = draft.country;
  if (draft.timeZone !== before.timeZone) settings.timeZone = draft.timeZone;
  if (ordered(draft.modulesOff).join() !== ordered(before.modulesOff).join()) settings.modulesOff = ordered(draft.modulesOff);
  return { settings: Object.keys(settings).length ? settings : null, currency: draft.currency !== before.currency ? draft.currency : null };
}

/* ---------- Guide Enable Banking ---------- */

/**
 * Les quatre temps pour relier une banque (docs/connecteurs/enable-banking.md) : créer son application chez Enable
 * Banking, l'activer en y reliant ses comptes, donner sa clé à Pécule, puis autoriser Pécule à lire.
 */
export const BANK_GUIDE_STEPS = ["application", "activation", "cle", "accord"] as const;
export type BankGuideStep = (typeof BANK_GUIDE_STEPS)[number];
export type BankGuideState = "fait" | "en_cours" | "a_venir";

export type BankGuideInput = {
  /** Une clé est enregistrée : celle du foyer, ou la clé personnelle du membre. */
  keySaved: boolean;
  /** Elle n'est plus lisible (le secret du serveur a changé) : à ressaisir. */
  keyUnreadable: boolean;
  /** Ce qu'Enable Banking dit de l'application ; null tant que la clé ne lui a pas parlé. */
  application: { active: boolean } | null;
  /** Accords que le membre a donnés à ses banques avec cette application (`consentsWith`). */
  consents: number;
  /** Ce que le membre dit avoir fait chez Enable Banking : rien ne permet de le lire tant que Pécule n'a pas la clé. */
  declared: { application: boolean; activation: boolean };
};

/** Application que suit le guide : celle du foyer, ou celle d'un membre qui a des comptes à son seul nom. */
export type BankScope = "foyer" | "moi";

/**
 * Accords qu'un membre a donnés avec l'application suivie. Un accord donné avec l'autre ne dit rien d'elle : un
 * membre déjà relié par l'application du foyer n'a encore rien autorisé avec la sienne.
 */
export const consentsWith = <S extends { userId: number; own?: boolean }>(sessions: readonly S[], scope: BankScope, userId: number | undefined): S[] =>
  sessions.filter((x) => x.userId === userId && (x.own === true) === (scope === "moi"));

/**
 * État de chaque temps, et celui qui est en cours (le premier qui reste à faire ; null : la banque est reliée).
 * Dès que Pécule a la clé, c'est Enable Banking qui dit si l'application est active : un membre qui avait coché
 * l'activation trop vite y est ramené, même si la clé est déjà donnée.
 */
export function bankGuide(input: BankGuideInput): { states: Record<BankGuideStep, BankGuideState>; current: BankGuideStep | null; done: boolean } {
  const key = input.keySaved && !input.keyUnreadable;
  // Une clé enregistrée, même devenue illisible, dit que l'application existe ; et qu'elle a été active.
  const application = input.keySaved || input.declared.application;
  const made: Record<BankGuideStep, boolean> = {
    application,
    activation: input.application ? input.application.active : application && (input.declared.activation || input.consents > 0 || input.keyUnreadable),
    cle: key,
    accord: input.consents > 0,
  };
  const current = BANK_GUIDE_STEPS.find((s) => !made[s]) ?? null;
  const states = Object.fromEntries(BANK_GUIDE_STEPS.map((s) => [s, made[s] ? "fait" : s === current ? "en_cours" : "a_venir"])) as Record<BankGuideStep, BankGuideState>;
  return { states, current, done: current === null };
}
