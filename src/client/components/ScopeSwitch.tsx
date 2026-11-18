import { Link } from "react-router";
import { useScope } from "../shell.ts";
import { cn } from "../cn.ts";
import { t } from "../../lib/i18n.ts";

/**
 * Bascule Foyer / Moi dans l'écran lui-même, pour le téléphone : sur ordinateur, c'est la barre du haut qui la
 * porte. Même réglage que partout ailleurs (useScope). À ne montrer que s'il y a un choix à faire.
 */
export function ScopeSwitch() {
  const [scope, setScope] = useScope();
  return (
    <div className="flex shrink-0 rounded-full bg-line/70 p-0.5 text-[13px] font-semibold md:hidden">
      {(["foyer", "moi"] as const).map((s) => (
        <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)} className={cn("press rounded-full px-3 py-1.5", scope === s ? "bg-card text-ink shadow-sm" : "text-muted")}>
          {s === "foyer" ? t("Foyer") : t("Moi")}
        </button>
      ))}
    </div>
  );
}

/**
 * Ce que la vue du foyer ne compte pas, et pourquoi : les membres qui ne partagent pas leurs revenus, et — si
 * c'est le cas — que les siens ne sont pas vus des autres. Rien à dire dans la vue « Moi », ni dans un foyer d'un
 * seul membre.
 */
export function SharingNote({ what, several, sharing, withheld, scope }: { what: "revenus" | "impots"; several: boolean; sharing: boolean; withheld: string[]; scope: "foyer" | "moi" }) {
  if (!several || scope !== "foyer") return null;
  const noms = withheld.join(", ");
  const lines = [
    !withheld.length ? null : what === "revenus" ? t("Non comptés ici, faute de partage : les revenus de {noms}.", { noms }) : t("Non comptées ici, faute de partage : les déclarations personnelles de {noms}.", { noms }),
    sharing ? null : t("Tu ne partages pas tes revenus : les autres membres ne les voient pas."),
  ].filter((x): x is string => !!x);
  if (!lines.length) return null;
  return (
    <p className="mb-4 px-1 text-[13px] text-muted">
      {lines.join(" ")}{" "}
      <Link to="/reglages/compte#partage" className="font-medium text-accent">
        {t("Régler le partage")}
      </Link>
    </p>
  );
}
