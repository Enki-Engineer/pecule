import { useEffect, useState } from "react";
import { logoSrc } from "../../lib/logo.ts";
import { cn } from "../cn.ts";
import { useLogoId } from "../theme.ts";
import "../../styles/coffre.css";

const drawings = new Map<string, string>();

/** Durée de l'ouverture du coffre, à attendre avant de quitter l'écran (rien si l'appareil réduit les animations). */
export const chestOpeningMs = () => (window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 950);

/**
 * Le logo dessiné en ligne pour pouvoir l'animer : coffre fermé, qui s'ouvre quand `open` passe à vrai
 * (écrans de connexion et d'inscription). Le dessin est le fichier du logo lui-même (nos propres fichiers
 * de /icons/coffre) ; tant qu'il n'est pas là, la place reste vide, et s'il est introuvable on montre l'image.
 */
export function ChestLogo({ open, className }: { open: boolean; className?: string }) {
  const id = useLogoId();
  const [svg, setSvg] = useState<string | null>(() => drawings.get(id) ?? null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const known = drawings.get(id);
    if (known) {
      setSvg(known);
      return;
    }
    let alive = true;
    fetch(logoSrc(id))
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error("logo"))))
      .then((text) => {
        if (!text.startsWith("<svg")) throw new Error("logo");
        drawings.set(id, text);
        if (alive) setSvg(text);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  if (failed) return <img src={logoSrc(id)} alt="" className={className} />;
  if (!svg) return <div aria-hidden className={className} />;
  return <div aria-hidden className={cn("chest overflow-hidden", open ? "chest--opening" : "chest--closed", className)} dangerouslySetInnerHTML={{ __html: svg }} />;
}
