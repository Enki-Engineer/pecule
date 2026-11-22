import clsx from "clsx";
import { LOGO_FONDS, LOGO_THEMES, logoSrc, type LogoId } from "../../lib/logo.ts";
import { SEASONS } from "../../lib/seasons.ts";
import { useAppearance, useLogo, useSeason } from "../theme.ts";
import { t } from "../../lib/i18n.ts";

function Choice({ id, label, selected, onSelect }: { id: LogoId; label: string; selected: boolean; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} aria-pressed={selected} className="press flex flex-col items-center gap-1.5 text-center md:w-[68px]">
      <img src={logoSrc(id)} alt="" className={clsx("size-14 rounded-[13px] ring-offset-2 ring-offset-bg", selected ? "ring-2 ring-ink" : "ring-1 ring-line")} />
      <span className={clsx("text-[11.5px] leading-tight", selected ? "font-semibold" : "text-muted")}>{label}</span>
    </button>
  );
}

/** Logo (réglages de l'appareil) : fond du coffre de tous les jours, et icône de l'appli installée — figée à l'installation, sur l'iPhone comme dans le Dock du Mac. */
export function LogoSettings() {
  const { fond, setFond, home, setHome } = useLogo();
  const season = useSeason();
  const { seasons } = useAppearance();
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
  return (
    <>
      <div>
        <div className="mb-2 px-1 text-[13px] font-medium">{t("Logo")}</div>
        <div className="grid grid-cols-5 gap-x-2 gap-y-3 md:flex md:flex-wrap">
          {LOGO_FONDS.map((f) => (
            <Choice key={f.id} id={f.id} label={f.label} selected={fond === f.id} onSelect={() => setFond(f.id)} />
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          {season
            ? t("Le coffre de tous les jours, sur le fond de ton choix. Dans l'appli et dans l'onglet du navigateur, il prend tout seul le décor du thème du moment (en ce moment : {theme}).", { theme: SEASONS[season].label })
            : seasons === "aucun"
              ? t("Le coffre de tous les jours, sur le fond de ton choix. Si tu actives les thèmes de l'année, il prend dans l'appli et dans l'onglet du navigateur le décor du thème du moment.")
              : t("Le coffre de tous les jours, sur le fond de ton choix. Dans l'appli et dans l'onglet du navigateur, il prend tout seul le décor du thème du moment.")}
        </p>
      </div>
      <div>
        <div className="mb-2 px-1 text-[13px] font-medium">{t("Icône sur l'écran d'accueil")}</div>
        <div className="grid grid-cols-5 gap-x-2 gap-y-3 md:flex md:flex-wrap">
          <Choice id={fond} label={t("Comme le logo")} selected={home === null} onSelect={() => setHome(null)} />
          {LOGO_THEMES.map((x) => (
            <Choice key={x} id={x} label={SEASONS[x].label} selected={home === x} onSelect={() => setHome(x)} />
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-muted">
          {t("L'iPhone garde l'icône du jour où Pécule a été ajouté à l'écran d'accueil : elle ne peut pas changer toute seule. Pour en changer, ouvre Pécule dans Safari, choisis l'icône ici, supprime l'ancienne de l'écran d'accueil, puis Partager → « Sur l'écran d'accueil ». Il faudra te reconnecter et réactiver les notifications.")}
        </p>
        <p className="mt-1 px-1 text-xs text-muted">{t("Sur Mac, Safari lit l'icône à l'ouverture de la page : après ton choix, recharge la page, puis Fichier → « Ajouter au Dock ». Une icône déjà dans le Dock garde son dessin : supprime-la d'abord.")}</p>
        {installed && <p className="mt-1 px-1 text-xs font-medium text-ink">{t("Tu es dans l'appli installée : fais ce choix depuis Safari, c'est lui qui crée l'icône.")}</p>}
      </div>
    </>
  );
}
