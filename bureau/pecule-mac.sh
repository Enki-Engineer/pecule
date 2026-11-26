#!/bin/sh
# Installe (ou réinstalle) l'appli de bureau de Pécule sur un Mac à puce Apple.
#
#   curl -fsSL https://github.com/Enki-Engineer/pecule/releases/latest/download/pecule-mac.sh | sh
#
# Télécharge l'appli de la dernière version publiée, contrôle son empreinte, la pose dans Applications et l'ouvre.
# Installée ainsi, elle se lance sans que macOS ne s'y oppose : elle n'est pas signée par un compte Apple payant, et
# une appli téléchargée par un navigateur demanderait un détour par Réglages Système → Confidentialité et sécurité.
# Tes données ne sont pas touchées : elles vivent dans ~/Library/Application Support/Pecule.
#
#   PECULE_VERSION=1.50.0   cette version plutôt que la dernière
#   PECULE_DOSSIER=~/Apps   où poser l'appli (défaut : /Applications, sinon ~/Applications)
#   PECULE_DEPOT=moi/pecule les versions d'une copie du projet
#   PECULE_SOURCE=https://… un miroir : l'appli et ses empreintes y sont prises telles quelles
#   PECULE_OUVRIR=0         ne pas ouvrir l'appli à la fin
#
# English: installs the Pécule desktop app on an Apple-silicon Mac (latest published release, checksum verified).
set -eu

# Tout le script est dans une fonction, appelée à la dernière ligne : un téléchargement coupé en route (« curl | sh »)
# n'exécute rien, au lieu de s'arrêter au milieu d'une installation.
principal() {

DEPOT="${PECULE_DEPOT:-Enki-Engineer/pecule}"
dire() { printf '%s\n' "$*"; }
echec() { printf '✗ %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || echec "Cette appli est pour macOS. Sur un autre système : Docker, ou l'archive prête à l'emploi (voir le dépôt)."
[ "$(uname -m)" = "arm64" ] || echec "Cette appli demande un Mac à puce Apple (M1 ou plus récent). Sur un Mac Intel : Docker (voir le dépôt)."
majeure="$(sw_vers -productVersion | cut -d. -f1)"
[ "$majeure" -ge 14 ] || echec "Cette appli demande macOS 14 ou plus récent (ici : $(sw_vers -productVersion))."

# La version : celle qu'on demande, sinon la dernière publiée — son étiquette d'abord, pour que l'appli et son
# empreinte soient celles de la même version.
if [ -n "${PECULE_SOURCE:-}" ]; then
  # Un miroir se joint en https : en clair, l'appli et ses empreintes pourraient être remplacées ensemble en chemin.
  case "$PECULE_SOURCE" in
    https://* | http://127.0.0.1:* | http://localhost:*) ;;
    *) echec "PECULE_SOURCE : il faut une adresse en https (ici : $PECULE_SOURCE)." ;;
  esac
  etiquette="${PECULE_VERSION:-miroir}"
elif [ -n "${PECULE_VERSION:-}" ]; then
  etiquette="v${PECULE_VERSION#v}"
else
  etiquette="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/$DEPOT/releases/latest" | sed -n 's|.*/releases/tag/||p')"
  [ -n "$etiquette" ] || echec "La dernière version de Pécule ne se laisse pas lire (https://github.com/$DEPOT/releases)."
fi
base="${PECULE_SOURCE:-https://github.com/$DEPOT/releases/download/$etiquette}"
base="${base%/}"

travail="$(mktemp -d)"
trap 'rm -rf "$travail"' EXIT INT TERM

dire "Téléchargement de Pécule pour Mac (${etiquette#v})…"
curl -fSL --progress-bar -o "$travail/Pecule-mac.zip" "$base/Pecule-mac.zip" || echec "L'appli de la version ${etiquette#v} ne se télécharge pas ($base/Pecule-mac.zip) : cette version n'a peut-être pas d'appli de bureau."
curl -fsSL -o "$travail/SHA256SUMS-mac" "$base/SHA256SUMS-mac" || echec "Les empreintes de la version ne se téléchargent pas : rien n'a été installé."
attendue="$(awk '$2 == "Pecule-mac.zip" { print $1 }' "$travail/SHA256SUMS-mac")"
obtenue="$(shasum -a 256 "$travail/Pecule-mac.zip" | awk '{ print $1 }')"
[ -n "$attendue" ] && [ "$attendue" = "$obtenue" ] || echec "L'empreinte de l'appli téléchargée n'est pas celle de la version : rien n'a été installé."
dire "✓ Appli arrivée intacte (empreinte contrôlée)"

ditto -x -k "$travail/Pecule-mac.zip" "$travail/appli" || echec "L'archive ne se déplie pas : rien n'a été installé."
[ -x "$travail/appli/Pécule.app/Contents/MacOS/pecule" ] || echec "L'archive ne porte pas l'appli attendue : rien n'a été installé."

dossier="${PECULE_DOSSIER:-/Applications}"
if [ -z "${PECULE_DOSSIER:-}" ] && [ ! -w "$dossier" ]; then dossier="$HOME/Applications"; fi
mkdir -p "$dossier" || echec "Le dossier $dossier ne peut pas être créé."
[ -w "$dossier" ] || echec "Le dossier $dossier n'est pas inscriptible : donne-en un autre (PECULE_DOSSIER)."

if [ -d "$dossier/Pécule.app" ]; then
  # Une appli déjà là laisse la place : elle se ferme d'abord, pour arrêter sa base proprement.
  osascript -e 'tell application id "org.pecule.bureau" to quit' >/dev/null 2>&1 || true
  # Tout ce qui tourne depuis l'appli — sa fenêtre, son serveur, sa base — doit avoir rendu la main avant qu'on la retire.
  n=0
  while pgrep -f "$dossier/Pécule.app/Contents/" >/dev/null 2>&1 && [ "$n" -lt 450 ]; do sleep 0.2; n=$((n + 1)); done
  if pgrep -f "$dossier/Pécule.app/Contents/" >/dev/null 2>&1; then echec "Pécule tourne encore : quitte l'appli (menu Pécule → Quitter), puis relance cette commande. Rien n'a été remplacé."; fi
  rm -rf "$dossier/Pécule.app"
fi
mv "$travail/appli/Pécule.app" "$dossier/" || echec "L'appli n'a pas pu être posée dans $dossier."
version="$(plutil -extract CFBundleShortVersionString raw "$dossier/Pécule.app/Contents/Info.plist" 2>/dev/null || echo "${etiquette#v}")"
dire "✓ Pécule $version est dans $dossier"

if [ "${PECULE_OUVRIR:-1}" != "0" ]; then
  open "$dossier/Pécule.app"
  dire "L'appli s'ouvre : à la première ouverture, elle te demande ton prénom."
fi
dire "Tes données : ~/Library/Application Support/Pecule (à inclure dans tes sauvegardes)."
}

principal "$@"
