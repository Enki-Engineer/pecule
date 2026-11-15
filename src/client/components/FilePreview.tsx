import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useMedia } from "../useMedia.ts";
import { t } from "../../lib/i18n.ts";

/**
 * Aperçu d'un fichier (PDF ou image) dans le tiroir de détail, sur ordinateur. Repliable ; le choix
 * est mémorisé. Sur l'iPhone, on garde le bouton « Ouvrir le fichier ».
 */
const KEY = "pecule.apercu";

export function FilePreview({ url, mime }: { url: string; mime: string }) {
  const desktop = useMedia("(min-width: 768px)");
  const [open, setOpen] = useState(() => localStorage.getItem(KEY) !== "0");
  if (!desktop || !(mime === "application/pdf" || mime.startsWith("image/") || mime.startsWith("text/"))) return null;
  const toggle = () => {
    localStorage.setItem(KEY, open ? "0" : "1");
    setOpen(!open);
  };
  return (
    <section className="mb-4">
      <button type="button" onClick={toggle} className="mb-1.5 flex items-center gap-1.5 px-1 text-[12.5px] font-medium text-muted hover:text-ink">
        {open ? <EyeOff size={12} /> : <Eye size={12} />} {t("Aperçu")}
      </button>
      {open &&
        (mime.startsWith("image/") ? (
          <img src={url} alt="" className="card max-h-[520px] w-full object-contain" />
        ) : (
          <iframe src={url} title={t("Aperçu")} className="card h-[520px] w-full bg-white" />
        ))}
    </section>
  );
}
