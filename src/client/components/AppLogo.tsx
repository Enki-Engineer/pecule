import { logoSrc } from "../../lib/logo.ts";
import { useLogoId } from "../theme.ts";

/** Logo de Pécule : le coffre du moment (thème de l'année, sinon le fond choisi). L'image est carrée : donner l'arrondi par `className`. */
export function AppLogo({ className }: { className?: string }) {
  const id = useLogoId();
  return <img src={logoSrc(id)} alt="" className={className} />;
}
