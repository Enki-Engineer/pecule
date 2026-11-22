import { z } from "zod";
import { one } from "../db.ts";
import { accountSettings, saveAccountSettings } from "../actions.ts";
import { isDemo, runReal } from "../demo-context.ts";
import { funEnabled, setFunEnabled } from "../fun.ts";
import { householdSettings, saveHouseholdSettings } from "../household.ts";
import { memberLang, setMemberLang } from "../lang.ts";
import { NOTIF_TYPES, listDevices, setDeviceTypes, type NotifDevice, type NotifType } from "../notify.ts";
import { dateBasis, setDateBasis } from "../stat-dates.ts";
import { aiEnabled } from "../ai.ts";
import { MAX_BUDGET, aiBudget, saveAiBudget } from "../ai-cost.ts";
import { usageReport } from "../ai-usage.ts";
import { dashLayout, saveDashLayout } from "../dashboard.ts";
import { DASH_CARDS, DASH_KPIS, DASH_TEMPLATES, DASH_TEMPLATE_IDS, defaultLayout, templateLayout, templateOf } from "../../lib/dashboard.ts";
import { kick as kickImports } from "../imports/batches.ts";
import { ACCENTS } from "../../lib/seasons.ts";
import { ACCENT_IDS, DENSITIES, DENSITY_LABELS, SEASON_MODES, SEASON_MODE_LABELS, THEME_LABELS, THEME_PREFS } from "../../lib/device-settings.ts";
import { LANGS, LANG_IDS, currentLang, langInfo, locale, t as tr, tk } from "../../lib/i18n.ts";
import { MANUAL, articleMarkdown, findArticle, manualOutline, manualText, searchManual } from "../../lib/manual.ts";
import { fold } from "../../lib/markdown.ts";
import { MODULES, MODULE_INFO, type ModuleId } from "../../lib/modules.ts";
import { ToolError, change, field, month, readTool, writeTool, type Tool } from "./registry.ts";
import { updateStatus } from "../updates.ts";
import { VERSION } from "../version.ts";
import { backupSettings, backupState, lastBackupAt } from "../auto-backup.ts";
import { destination, encryptionKey } from "../offsite.ts";
import { audience } from "../sharing.ts";

/*
 * Aide et réglages : le manuel de Pécule (src/lib/manual.ts), que l'assistant lit avant d'expliquer un écran ou
 * un réglage, et les réglages qu'il peut changer à la demande — ceux du membre et du foyer, gardés par le serveur,
 * et ceux de l'appareil, que l'écran applique une fois l'action confirmée (`effect`).
 * Ce qui touche à la sécurité ou à un service extérieur (clés d'accès, membres, banques, fournisseur d'IA,
 * sauvegarde, devise du foyer) ne se règle qu'à l'écran : l'assistant y renvoie.
 */

/** Articles rendus en entier par une recherche ; les suivants ne donnent que leur titre. */
const FULL_HITS = 3;

const readManual = readTool({
  name: "read_manual",
  progress: tk("Lecture du manuel…"),
  description:
    "Manuel de Pécule : comment faire quelque chose dans l'appli, où se trouve un écran, un bouton ou un réglage, ce que veut dire un chiffre. `query` : recherche par mots-clés (rend le texte des articles les plus proches et le titre des suivants) ; `articles` : identifiants du sommaire, pour lire des articles précis ; sans paramètre : le sommaire (thèmes, identifiant et titre de chaque article). " +
    "Le texte est rendu dans la langue de l'utilisateur, avec les noms de boutons et de menus tels que son écran les affiche (en gras) et des liens vers les écrans ([nom](/adresse)) à reprendre tels quels dans ta réponse. À appeler avant d'expliquer une fonction de Pécule : ne décris jamais un menu ou un bouton de mémoire.",
  input: z.object({
    query: z.string().max(200).optional().describe("Mots-clés ou question (« changer la couleur », « relier ma banque »)"),
    articles: z.array(z.string().max(80)).max(4).optional().describe("Identifiants d'articles du sommaire (un identifiant de thème rend la liste de ses articles)"),
  }),
  async run(_ctx, i) {
    if (!i.query?.trim() && !i.articles?.length) return { outline: manualOutline(), usage: "Lire un article : articles: [identifiant] ; chercher : query." };
    const lang = currentLang();
    const full = (id: string) => {
      const e = findArticle(id);
      if (!e) throw new ToolError(`Article inconnu : ${id} (voir le sommaire du manuel dans tes consignes)`);
      return { id, theme: manualText(e.theme.title, lang, false), address: `/manuel/${id}`, module: e.article.module, text: articleMarkdown(e.article, lang) };
    };
    // Un identifiant de thème (la page d'aide d'un écran peut en être un) : la liste de ses articles, à lire ensuite.
    const themes = (i.articles ?? [])
      .map((id) => MANUAL.find((th) => th.id === id))
      .filter((th) => !!th)
      .map((th) => ({ theme: th.id, title: manualText(th.title, lang, false), address: `/manuel/${th.id}`, articles: th.articles.map((a) => ({ id: a.id, title: manualText(a.title, lang, false), summary: manualText(a.summary, lang, false) })) }));
    const asked = (i.articles ?? []).filter((id) => !themes.some((th) => th.theme === id)).map(full);
    // L'assistant formule sa recherche en français ou dans la langue du membre : on cherche dans les deux.
    const hits = i.query?.trim() ? searchManual(i.query, { limit: 8, langs: [lang, "fr"] }).filter((h) => !asked.some((a) => a.id === h.article.id)) : [];
    return {
      articles: [...asked, ...hits.slice(0, FULL_HITS).map((h) => full(h.article.id))],
      ...(themes.length ? { themes } : {}),
      other_matches: hits.slice(FULL_HITS).map((h) => ({ id: h.article.id, title: manualText(h.article.title, lang, false), summary: manualText(h.article.summary, lang, false) })),
      ...(i.query?.trim() && !hits.length && !asked.length ? { note: "Aucun article ne correspond : reformule avec d'autres mots-clés, ou lis un article du sommaire. Si le manuel n'en parle pas, dis-le au lieu d'inventer." } : {}),
    };
  },
});

/** Administrateur du foyer (jamais en démo) : les membres vivent dans la vraie base. */
async function isAdmin(userId: number): Promise<boolean> {
  if (isDemo()) return false;
  const row = await runReal(() => one<{ role: string }>("SELECT role FROM users WHERE id = ?", [userId]));
  return row?.role === "admin";
}

const moduleName = (m: ModuleId) => tr(MODULE_INFO[m].label);
const DATE_BASIS_LABELS = { achat: tk("Jour d'achat"), debit: tk("Jour du débit") } as const;

const getSettings = readTool({
  name: "get_settings",
  progress: tk("Lecture des réglages…"),
  description:
    "Réglages de Pécule que tu peux lire : la version de Pécule en service (et, pour l'administrateur, la version plus récente publiée s'il y en a une, la date de la dernière sauvegarde et le réglage des sauvegardes automatiques), ceux du membre (langue, équivalences amusantes, partage de ses revenus avec le foyer, agencement de son tableau de bord, s'il est administrateur) et ceux du foyer (pays, devise, fuseau horaire, jour retenu pour les achats par carte, écrans facultatifs affichés ou retirés, personnes sans connexion, banques professionnelles), avec l'adresse de l'écran où chacun se règle. " +
    "Les réglages gardés par l'appareil (clair ou sombre, couleur, thèmes de l'année, densité, montants masqués, ouverture instantanée, notifications) ne se lisent pas d'ici. Alerte de solde bas : get_balance_alert ; comptes masqués ou hors statistiques : list_accounts.",
  input: z.object({}),
  async run({ userId }) {
    const [household, basis, lang, fun, admin, budget, dash, who] = await Promise.all([householdSettings(), dateBasis(), memberLang(userId), funEnabled(userId), isAdmin(userId), aiBudget(), dashLayout(userId), audience(userId, "foyer")]);
    const layout = dash ?? defaultLayout();
    return {
      member: {
        administrator: admin,
        language: { value: lang, name: langInfo(lang).label, choices: LANGS.map((l) => l.id), where: "/reglages/apparence", change_with: "update_settings" },
        fun_equivalences: { value: fun, where: "/reglages/apparence", change_with: "update_settings" },
        // Partage des revenus : un choix de vie privée, que chaque membre fait lui-même à l'écran.
        income_sharing: {
          value: who.sharing,
          meaning: who.sharing
            ? "ses bulletins de paie (montants seuls) et ses déclarations d'impôt personnelles comptent dans la vue « Foyer » des écrans Revenus et Impôts des autres membres"
            : "ses bulletins de paie et ses déclarations d'impôt personnelles ne sont vus que de lui",
          other_members_not_sharing: who.withheld.map((m) => m.name),
          where: "/reglages/compte#partage",
          change_with: "écran seulement : chaque membre décide pour lui-même",
        },
        // Tableau de bord de l'ordinateur ; l'accueil du téléphone a son propre réglage, gardé par l'appareil.
        dashboard: {
          template: templateOf(layout) ?? "personnalisé",
          key_figures: layout.kpis.map((id) => tr(DASH_KPIS.find((k) => k.id === id)!.label)),
          cards: layout.cards.map((c) => tr(DASH_CARDS.find((x) => x.id === c.id)!.label)),
          templates: DASH_TEMPLATES.map((m) => ({ id: m.id, name: tr(m.label), for: m.hint })),
          where: "/",
          change_with: "update_settings (dashboard_template : repartir d'un modèle) ; déplacer, élargir, ajouter ou retirer une carte, ou la réduire à l'essentiel, se fait à l'écran, bouton « Modifier le tableau de bord »",
        },
      },
      household: {
        country: { value: household.country, where: "/reglages/foyer", change_with: "écran seulement (administrateur)" },
        currency: { value: household.currency, where: "/reglages/foyer", change_with: "écran seulement (administrateur) : changer de devise recalcule opérations et soldes" },
        time_zone: { value: household.timeZone, where: "/reglages/foyer", change_with: "écran seulement (administrateur)" },
        card_purchase_day: {
          value: basis,
          meaning: basis === "achat" ? "les achats par carte comptent au jour de l'achat" : "les achats par carte comptent au jour où la banque les prélève",
          where: "/reglages/foyer",
          change_with: "update_settings (administrateur ; libre en mode démo)",
        },
        optional_screens: MODULES.map((m) => ({ id: m, name: MODULE_INFO[m].label, shown: !household.modulesOff.includes(m) })),
        optional_screens_where: "/reglages/foyer",
        optional_screens_change_with: "update_settings (administrateur)",
        people_without_login: household.people,
        professional_banks: household.proInstitutions,
      },
      demo_mode: isDemo(),
      ai_configured: aiEnabled(),
      ai_cost: {
        monthly_budget_eur: isDemo() ? null : budget.monthly,
        pause_background_when_reached: isDemo() ? false : budget.pauseBackground,
        read_with: "get_ai_usage",
        where: "/reglages/cout-ia",
        change_with: "update_settings (administrateur) pour le plafond du mois ; le tarif d'un modèle se saisit à l'écran",
      },
      device: {
        note: "Réglages gardés par l'appareil, non lisibles d'ici : apparence (auto, clair, sombre), couleur, thèmes de l'année, densité (ordinateur), montants masqués (mode discret), ouverture instantanée.",
        where: "/reglages/apparence et /reglages/notifications",
        change_with: "set_device_settings",
      },
      notifications: isDemo()
        ? { note: "Indisponibles en mode démo." }
        : {
            devices: (await listDevices(userId)).map((d) => ({ device: deviceName(d), since: d.createdAt, receives: NOTIF_IDS.filter((k) => d.prefs[k] !== false), muted: NOTIF_IDS.filter((k) => d.prefs[k] === false) })),
            note: "Un appareil ne figure ici qu'une fois les notifications activées dessus : cela demande l'accord de l'utilisateur sur l'appareil, à l'écran (sur iPhone, depuis l'appli installée sur l'écran d'accueil).",
            where: "/reglages/notifications#notifications",
            change_with: "set_notification_types (types reçus, sur les appareils déjà abonnés)",
          },
      low_balance_alert: { read_with: "get_balance_alert", change_with: "set_balance_alert", where: "/reglages/notifications#solde" },
      accounts: { read_with: "list_accounts", change_with: "update_account", where: "/reglages/connexions" },
      pecule: await peculeVersion(admin),
      backup: await backupInfo(admin),
    };
  },
});

/** Version en service et, pour l'administrateur, version plus récente publiée. Les notes de version, écrites ailleurs, ne sont pas données à lire. */
async function peculeVersion(admin: boolean) {
  if (isDemo()) return { note: "Indisponible en mode démo." };
  // La version en service ne se dit qu'à l'administrateur (comme `GET /api/updates`) : elle renseigne sur ce qui n'est pas corrigé.
  if (!admin) return { where: "/reglages/suivi#version", note: "Seul l'administrateur voit la version en service et si une plus récente est publiée ; c'est lui qui met Pécule à jour." };
  const base = { version: VERSION, where: "/reglages/suivi#version" };
  const u = await updateStatus();
  return {
    ...base,
    newer_version: u.state.kind === "a-jour" ? null : u.state.version,
    ...(u.state.kind === "palier" ? { install_first: u.state.palier, why: "la dernière version ne reprend pas une base aussi ancienne : passer d'abord par celle-ci" } : {}),
    checked: u.enabled ? (u.checkedAt ?? "pas encore") : "jamais : la vérification est coupée sur ce serveur (UPDATE_CHECK=0)",
    how: `Rien ne s'installe depuis l'appli ni par l'assistant : la mise à jour se lance sur le serveur, dans le dossier de Pécule, par \`${u.commandPalier ?? u.command}\` (une sauvegarde complète est prise avant que la base ne soit modifiée). Article du manuel : mise-a-jour.`,
  };
}

/** Coût de l'IA : en euros (la facture du fournisseur), au format de la langue du membre. */
const aiEur = (n: number) => new Intl.NumberFormat(locale(), { style: "currency", currency: "EUR" }).format(n);

const getAiUsage = readTool({
  name: "get_ai_usage",
  progress: tk("Lecture du coût de l'IA…"),
  description:
    "Ce que l'IA de Pécule a coûté, en euros, pour tout le foyer — une estimation : le décompte du fournisseur (jetons, caractères lus, audio transcrit) au tarif public du modèle. " +
    "`current` : le mois en cours (dépense, `projection` de fin de mois au rythme constaté, mois précédent entier et `previousToDate` à la même date, part des sessions de démo) ; `months` : les douze derniers mois ; " +
    "`selected` : le détail d'un mois (`month` AAAA-MM, par défaut le mois en cours) par usage (`kinds` : assistant, import = import de dossier, facture = lecture de factures, classement = classement d'articles, document = rangement de documents, bulletin = lecture de bulletins de paie, voix = mode vocal, traduction = noms de catégories, test = essai d'un fournisseur, demo = sessions de démo) avec le coût moyen d'une unité (`unitCost` par conversation ou par appel), par membre, par modèle (`source` « estime » : tarif inconnu, compté à celui du modèle de référence), effet du cache (`cache.share` : part de l'entrée relue en cache, `cache.saved` : euros économisés), conversations et imports les plus coûteux de l'utilisateur ; " +
    "`budget` : plafond du mois, état (ok, alerte à 80 %, depasse) et lectures de fond en pause ou non ; `prices` : tarif de chaque modèle en dollars par million de jetons. " +
    "L'usage de Pécule depuis l'appli Claude (serveur MCP) n'y figure pas : il est facturé par l'abonnement Claude de l'utilisateur. Le plafond se change par update_settings (administrateur) ; le tarif d'un modèle se saisit à l'écran.",
  input: z.object({ month: month.optional().describe("Mois détaillé dans `selected` (douze derniers mois)") }),
  run: async ({ userId }, i) => ({ ...(await usageReport(userId, i.month)), currency: "EUR", where: "/reglages/cout-ia" }),
});

const screens = z.array(z.enum(MODULES)).max(MODULES.length);

const updateSettings = writeTool({
  name: "update_settings",
  description:
    "Change un réglage gardé par Pécule, à la demande de l'utilisateur. Pour lui : `language` (fr, en, de, it, es : la langue de l'appli sur tous ses appareils, réponses de l'assistant et voix comprises ; l'écran se recharge) `fun_equivalences` (équivalences amusantes) et `dashboard_template` (repartir d'un modèle pour son tableau de bord d'ordinateur : ensemble, essentiel — le plus léger, à proposer à qui trouve l'écran trop chargé —, quotidien, budget ou patrimoine ; son agencement actuel est remplacé ; get_settings décrit chaque modèle). " +
    "Pour tout le foyer, administrateur seulement : `card_purchase_day` (« achat » : un achat par carte compte au jour de l'achat ; « debit » : au jour où la banque le prélève — tous les chiffres datés du foyer changent de jour ; libre en mode démo), `show_screens` et `hide_screens` (écrans facultatifs : immobilier, crypto, projections, revenus, impots, retraite ; retirer un écran ne supprime aucune donnée). " +
    "Coût de l'IA, administrateur seulement, indisponible en mode démo : `ai_monthly_budget` (plafond de dépense du mois, en euros ; null pour le retirer — à 80 % puis au plafond, l'administrateur est prévenu par une notification) et `ai_pause_background` (une fois le plafond atteint, mettre en pause les lectures de fond : imports de dossier et traduction des noms ; l'assistant et les fichiers déposés un à un répondent toujours). " +
    "Ne donner que ce qui change. Lire d'abord get_settings pour connaître la valeur actuelle.",
  input: z.object({
    language: z.enum(LANG_IDS).optional(),
    fun_equivalences: z.boolean().optional(),
    dashboard_template: z.enum(DASH_TEMPLATE_IDS).optional(),
    card_purchase_day: z.enum(["achat", "debit"]).optional(),
    show_screens: screens.optional(),
    hide_screens: screens.optional(),
    ai_monthly_budget: z.number().min(0).max(MAX_BUDGET).nullable().optional(),
    ai_pause_background: z.boolean().optional(),
  }),
  async describe({ userId }, i) {
    const details: string[] = [];
    if (i.language) details.push(change(tr("Langue"), langInfo(await memberLang(userId)).label, langInfo(i.language).label), tr("L'appli se recharge dans la nouvelle langue."));
    if (i.fun_equivalences !== undefined) details.push(field(tr("Équivalences amusantes"), i.fun_equivalences ? tr("activées") : tr("désactivées")));
    if (i.dashboard_template) {
      const m = DASH_TEMPLATES.find((x) => x.id === i.dashboard_template)!;
      const now = templateOf((await dashLayout(userId)) ?? defaultLayout());
      details.push(
        change(tr("Tableau de bord"), now ? tr(DASH_TEMPLATES.find((x) => x.id === now)!.label) : tr("Agencement personnalisé"), tr(m.label)),
        field(tr("Cartes"), templateLayout(m.id).cards.map((c) => tr(DASH_CARDS.find((x) => x.id === c.id)!.label)).join(", ")),
        tr("Ton agencement actuel est remplacé ; tu le modifies ensuite à l'écran."),
      );
    }
    const household = i.card_purchase_day || i.show_screens?.length || i.hide_screens?.length;
    const admin = household ? await isAdmin(userId) : false;
    if (i.card_purchase_day) {
      if (!admin && !isDemo()) throw new ToolError("Réservé à l'administrateur du foyer : le jour retenu pour les achats par carte se règle dans Réglages → Foyer (/reglages/foyer)");
      details.push(change(tr("Jour retenu pour les achats par carte"), tr(DATE_BASIS_LABELS[await dateBasis()]), tr(DATE_BASIS_LABELS[i.card_purchase_day])), tr("Réglage du foyer : tous les chiffres datés changent de jour."));
    }
    if (i.show_screens?.length || i.hide_screens?.length) {
      if (!admin) throw new ToolError(isDemo() ? "Indisponible en mode démo : les écrans affichés sont un réglage du vrai foyer" : "Réservé à l'administrateur du foyer : les écrans affichés se règlent dans Réglages → Foyer (/reglages/foyer)");
      const both = i.show_screens?.filter((m) => i.hide_screens?.includes(m)) ?? [];
      if (both.length) throw new ToolError(`Écran à la fois dans show_screens et hide_screens : ${both.join(", ")}`);
      if (i.show_screens?.length) details.push(field(tr("Écrans affichés"), i.show_screens.map(moduleName).join(", ")));
      if (i.hide_screens?.length) details.push(field(tr("Écrans retirés du menu"), i.hide_screens.map(moduleName).join(", ")), tr("Aucune donnée n'est supprimée."));
    }
    if (i.ai_monthly_budget !== undefined || i.ai_pause_background !== undefined) {
      if (isDemo()) throw new ToolError("Indisponible en mode démo : le plafond du coût de l'IA est un réglage du vrai foyer");
      if (!(await isAdmin(userId))) throw new ToolError("Réservé à l'administrateur du foyer : le plafond du coût de l'IA se règle dans Réglages → Coût de l'IA (/reglages/cout-ia)");
      const now = await aiBudget();
      const monthly = i.ai_monthly_budget !== undefined ? i.ai_monthly_budget || null : now.monthly;
      if (i.ai_pause_background && !monthly) throw new ToolError("ai_pause_background demande un plafond : donner aussi ai_monthly_budget");
      const shown = (n: number | null) => (n ? aiEur(n) : tr("aucun"));
      if (i.ai_monthly_budget !== undefined) details.push(change(tr("Plafond du mois pour l'IA"), shown(now.monthly), shown(monthly)));
      if (i.ai_pause_background !== undefined)
        details.push(i.ai_pause_background ? tr("Plafond atteint : les imports de dossier et la traduction des noms attendent.") : tr("Plafond atteint : rien n'est mis en pause, tu es seulement prévenu."));
    }
    if (!details.length) throw new ToolError("Rien à changer : donner language, fun_equivalences, dashboard_template, card_purchase_day, show_screens, hide_screens, ai_monthly_budget ou ai_pause_background");
    return { label: tr("Modifier les réglages"), details };
  },
  async run({ userId }, i) {
    if (i.language) await setMemberLang(userId, i.language);
    if (i.fun_equivalences !== undefined) await setFunEnabled(userId, i.fun_equivalences);
    if (i.dashboard_template) await saveDashLayout(userId, templateLayout(i.dashboard_template));
    if (i.card_purchase_day) await setDateBasis(i.card_purchase_day);
    if (i.show_screens?.length || i.hide_screens?.length) {
      const off = new Set<ModuleId>((await householdSettings()).modulesOff);
      for (const m of i.show_screens ?? []) off.delete(m);
      for (const m of i.hide_screens ?? []) off.add(m);
      await saveHouseholdSettings({ modulesOff: [...off] });
    }
    if (i.ai_monthly_budget !== undefined || i.ai_pause_background !== undefined) {
      await saveAiBudget({ ...(i.ai_monthly_budget !== undefined ? { monthly: i.ai_monthly_budget || null } : {}), ...(i.ai_pause_background !== undefined ? { pauseBackground: i.ai_pause_background } : {}) });
      // Un plafond relevé ou retiré : les imports en attente reprennent.
      kickImports();
    }
    return "Fait : réglages enregistrés." + (i.language ? " L'écran de l'utilisateur se recharge dans la nouvelle langue : réponds désormais dans cette langue." : "");
  },
  // La langue, les écrans affichés et le jour retenu arrivent à l'écran avec l'identité du membre : elle est relue.
  effect: (i) => {
    const member = !!(i.language || i.card_purchase_day || i.show_screens?.length || i.hide_screens?.length);
    return member || i.dashboard_template ? { ...(member ? { refreshMember: true } : {}), ...(i.dashboard_template ? { refreshDashboard: true } : {}) } : undefined;
  },
});

const updateAccount = writeTool({
  name: "update_account",
  description:
    "Règle un compte (account_id de list_accounts) : `display_name` (nom affiché, commun au foyer ; null : reprendre le nom donné par la banque), `hidden` (masqué : retiré de l'accueil de l'utilisateur, ses opérations restent comptées), `excluded` (hors statistiques : exclu de ses totaux et de ses opérations à classer). Masquer et exclure ne valent que pour l'utilisateur, pas pour les autres membres. Ne donner que ce qui change.",
  input: z.object({
    account_id: z.string().max(64),
    display_name: z.string().trim().max(120).nullable().optional(),
    hidden: z.boolean().optional(),
    excluded: z.boolean().optional(),
  }),
  async describe({ userId }, i) {
    const a = await accountSettings(userId, i.account_id);
    if (!a) throw new ToolError(`Compte inconnu : ${i.account_id} (voir list_accounts)`);
    const details = [
      i.display_name !== undefined ? change(tr("Nom affiché"), a.displayName ?? a.name, i.display_name?.trim() || a.name) : null,
      i.hidden !== undefined ? (i.hidden ? tr("Masqué : retiré de ton accueil ; ses opérations restent comptées.") : tr("Affiché de nouveau sur ton accueil.")) : null,
      i.excluded !== undefined ? (i.excluded ? tr("Hors statistiques : exclu de tes totaux et de tes opérations à classer.") : tr("Compté de nouveau dans tes statistiques.")) : null,
    ].filter((x): x is string => !!x);
    if (!details.length) throw new ToolError("Rien à changer : donner display_name, hidden ou excluded");
    return { label: tr("Régler le compte « {nom} »", { nom: a.displayName ?? a.name }), details };
  },
  async run({ userId }, i) {
    await saveAccountSettings(userId, i.account_id, { displayName: i.display_name, hidden: i.hidden, excluded: i.excluded });
    return "Fait : compte réglé.";
  },
});

/* ---------- Notifications : types reçus par les appareils du membre ---------- */

/** Où en sont les sauvegardes (administrateur seulement : l'archive porte les données de tous les membres). */
async function backupInfo(admin: boolean) {
  if (isDemo()) return { note: "Indisponible en mode démo." };
  const where = "/reglages/compte#sauvegarde";
  if (!admin) return { where, note: "La sauvegarde complète est réservée à l'administrateur." };
  const [settings, state, latest, dest, key] = await Promise.all([backupSettings(), backupState(), lastBackupAt(), destination(), encryptionKey()]);
  return {
    where,
    last_backup: latest ? new Date(latest).toISOString() : "aucune",
    automatic: { enabled: settings.auto, frequency: settings.frequence === "semaine" ? "chaque semaine" : "chaque nuit", kept_on_server: settings.garder },
    last_automatic: state.ok ? { at: state.ok.at, megabytes: Math.round(state.ok.octets / 1_048_576) } : null,
    automatic_failure: settings.auto && state.echec ? { at: state.echec.at, reason: state.echec.raison } : null,
    off_server_copy: {
      storage: dest ? (dest.type === "s3" ? "compatible S3" : "WebDAV") : "aucun",
      encryption_key: key ? "créée" : "pas encore créée",
      last_copy: state.dehors.ok?.at ?? null,
      failing: state.dehors.echec ? { at: state.dehors.echec.at, waiting_archive: state.dehors.attente } : null,
    },
    how: "Télécharger une sauvegarde, activer les sauvegardes automatiques, choisir combien en garder, créer la clé de chiffrement et régler le stockage extérieur se font à l'écran, par l'administrateur. Une sauvegarde se restaure dans une installation neuve. Articles du manuel : sauvegarde, sauvegarde-hors-serveur, restaurer.",
  };
}

const NOTIF_IDS = Object.keys(NOTIF_TYPES) as NotifType[];
/** Ce que chaque type annonce, pour l'IA (les libellés de l'écran, eux, sont traduits pendant la requête). */
const NOTIF_MEANING: Record<NotifType, string> = {
  aclasser: "opérations à classer (le soir)",
  prelevement: "prélèvement nouveau ou inhabituel",
  solde: "solde bas, aujourd'hui ou à venir",
  loyer: "loyer pas encore reçu",
  echeance: "échéances à sept jours et tâches du jour",
  garantie: "garantie qui expire dans 30 jours",
  enveloppe: "enveloppe à son seuil d'alerte ou dépassée",
  resume: "résumé de la semaine (lundi matin)",
  ia: "coût de l'IA à 80 % du plafond du mois ou dépassé (reçu par l'administrateur seulement)",
  maj: "nouvelle version de Pécule publiée (reçu par l'administrateur seulement)",
  sauvegarde: "sauvegarde automatique en échec, ou aucune sauvegarde depuis un mois (reçu par l'administrateur seulement)",
};
/** Nom d'un appareil abonné (« iPhone », « Mac »…), ou « Appareil » s'il n'en a pas donné. */
const deviceName = (d: NotifDevice) => d.device?.trim() || tr("Appareil");
const notifTypes = z.object(Object.fromEntries(NOTIF_IDS.map((k) => [k, z.boolean().optional()])) as Record<NotifType, z.ZodOptional<z.ZodBoolean>>);

/** Appareils visés : tous ceux du membre, ou ceux dont le nom contient `device`. */
async function targetDevices(userId: number, device?: string): Promise<NotifDevice[]> {
  if (isDemo()) throw new ToolError("Indisponible en mode démo : les notifications ne concernent que les vrais appareils.");
  const devices = await listDevices(userId);
  if (!devices.length)
    throw new ToolError(
      "Aucun appareil de l'utilisateur n'a activé les notifications. Les activer demande son accord sur l'appareil : cela se fait à l'écran, dans Réglages → Notifications et appareil (/reglages/notifications#notifications) ; sur iPhone, depuis l'appli installée sur l'écran d'accueil. Lis l'article « notifications » du manuel pour la marche à suivre.",
    );
  if (!device?.trim()) return devices;
  const wanted = fold(device.trim());
  const found = devices.filter((d) => fold(deviceName(d)).includes(wanted));
  if (!found.length) throw new ToolError(`Aucun appareil abonné ne s'appelle « ${device} ». Appareils abonnés : ${devices.map(deviceName).join(", ")}`);
  return found;
}

const setNotificationTypes = writeTool({
  name: "set_notification_types",
  description:
    "Choisit les types de notifications que reçoivent les appareils de l'utilisateur déjà abonnés (get_settings les liste) : `types` avec true pour recevoir, false pour ne plus recevoir — " +
    NOTIF_IDS.map((k) => `${k} = ${NOTIF_MEANING[k]}`).join(" ; ") +
    ". Sans `device`, le réglage vaut sur tous ses appareils abonnés ; `device` (« iPhone », « Mac », « Android »…) le limite à ceux de ce nom. Ne donner que les types qui changent. " +
    "Tu ne peux pas activer les notifications sur un appareil qui ne les a pas : cela demande l'accord de l'utilisateur sur l'appareil, à l'écran. Pour le seuil et le délai de l'alerte de solde bas : set_balance_alert.",
  input: z.object({
    types: notifTypes,
    device: z.string().max(60).optional().describe("Nom d'un appareil abonné ; absent : tous les appareils abonnés de l'utilisateur"),
  }),
  async describe({ userId }, i) {
    const devices = await targetDevices(userId, i.device);
    const given = NOTIF_IDS.filter((k) => i.types[k] !== undefined);
    if (!given.length) throw new ToolError(`Rien à changer : donner au moins un type (${NOTIF_IDS.join(", ")})`);
    // Ce qui change vraiment sur au moins un des appareils visés.
    const changing = given.filter((k) => devices.some((d) => (d.prefs[k] !== false) !== i.types[k]));
    if (!changing.length) throw new ToolError("Rien à changer : ces types sont déjà réglés ainsi sur les appareils visés.");
    return {
      label: tr("Régler les notifications"),
      details: [
        ...changing.map((k) => (i.types[k] ? tr("Recevoir : {type}", { type: NOTIF_TYPES[k] }) : tr("Ne plus recevoir : {type}", { type: NOTIF_TYPES[k] }))),
        field(tr("Appareils"), devices.map(deviceName).join(", ")),
      ],
    };
  },
  async run({ userId }, i) {
    const devices = await targetDevices(userId, i.device);
    await setDeviceTypes(userId, devices.map((d) => d.id), Object.fromEntries(NOTIF_IDS.filter((k) => i.types[k] !== undefined).map((k) => [k, i.types[k]])));
    return `Fait : types de notifications réglés sur ${devices.length} appareil${devices.length > 1 ? "s" : ""} (${devices.map(deviceName).join(", ")}).`;
  },
});

const accentName = (id: string) => ACCENTS.find((a) => a.id === id)?.label ?? id;

const setDeviceSettings = writeTool({
  name: "set_device_settings",
  screenOnly: true,
  description:
    "Change un réglage gardé par l'appareil que l'utilisateur a sous les yeux (il ne vaut que sur cet appareil) : `theme` (auto : comme l'appareil ; clair ; sombre), `accent` (couleur de l'appli : " +
    ACCENTS.map((a) => `${a.id} = ${tk(a.label)}`).join(", ") +
    "), `seasons` (thèmes de l'année — tout : fêtes et saisons ; fetes : fêtes seulement ; aucun), `density` (ordinateur — aeree ou compacte : marges et lignes resserrées), `discreet` (true : tous les montants sont remplacés par « ••• » ; false : ils sont affichés), `instant_open` (ouverture instantanée : les dernières données de synthèse sont gardées sur l'appareil ; false les efface). " +
    "Tu ne peux pas lire la valeur actuelle de ces réglages. Les thèmes de l'année sont sur « aucun » tant que l'utilisateur ne les a pas activés ; une fois activés, le thème du moment (une fête, une saison) remplace la couleur choisie jusqu'à sa fin — dis-le quand tu actives les thèmes, ou si l'utilisateur ne voit pas la couleur qu'il a demandée. Ne donner que ce qui change.",
  input: z.object({
    theme: z.enum(THEME_PREFS).optional(),
    accent: z.enum(ACCENT_IDS).optional(),
    seasons: z.enum(SEASON_MODES).optional(),
    density: z.enum(DENSITIES).optional(),
    discreet: z.boolean().optional(),
    instant_open: z.boolean().optional(),
  }),
  async describe(_ctx, i) {
    const details = [
      i.theme ? field(tr("Apparence"), tr(THEME_LABELS[i.theme])) : null,
      i.accent ? field(tr("Couleur"), accentName(i.accent)) : null,
      i.seasons ? field(tr("Thèmes de l'année"), tr(SEASON_MODE_LABELS[i.seasons])) : null,
      i.density ? field(tr("Densité"), tr(DENSITY_LABELS[i.density])) : null,
      i.discreet !== undefined ? (i.discreet ? tr("Masquer les montants") : tr("Afficher les montants")) : null,
      i.instant_open !== undefined ? field(tr("Ouverture instantanée"), i.instant_open ? tr("activée") : tr("désactivée")) : null,
    ].filter((x): x is string => !!x);
    if (!details.length) throw new ToolError("Rien à changer : donner theme, accent, seasons, density, discreet ou instant_open");
    return { label: tr("Régler cet appareil"), details };
  },
  // Rien n'est gardé par le serveur : l'écran applique le réglage (`effect`).
  async run() {
    return "Fait : réglage appliqué sur l'appareil de l'utilisateur.";
  },
  effect: (i) => ({ device: { theme: i.theme, accent: i.accent, seasons: i.seasons, density: i.density, discreet: i.discreet, instantOpen: i.instant_open } }),
});

export const reglagesTools: Tool[] = [readManual, getSettings, getAiUsage, updateSettings, updateAccount, setNotificationTypes, setDeviceSettings];
