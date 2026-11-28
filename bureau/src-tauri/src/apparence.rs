// Ce que la fenêtre retient et montre d'elle-même : la taille de l'affichage, gardée d'une ouverture à l'autre dans
// le dossier des données, et l'icône du Dock, que l'écran de Pécule laisse choisir. L'écran n'a aucune API de la
// coque : il demande par une adresse à elle (« pecule-action://zoom », « pecule-action://icone »), depuis une page
// de Pécule seulement.
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url};

use crate::Coque;

/// Les tailles par lesquelles passe le menu « Présentation » ; celles que proposent les réglages de Pécule en sont
/// (`ZOOM_LEVELS`, `src/lib/desktop.ts`).
pub const PALIERS: [f64; 11] = [0.5, 0.67, 0.75, 0.8, 0.9, 1.0, 1.1, 1.25, 1.5, 1.75, 2.0];
/// Bornes de la taille de l'affichage.
pub const ZOOM_MIN: f64 = PALIERS[0];
pub const ZOOM_MAX: f64 = PALIERS[PALIERS.len() - 1];

/// La taille au-dessus (ou au-dessous) de celle en cours.
pub fn palier_voisin(zoom: f64, plus_grand: bool) -> f64 {
    let voisin = if plus_grand { PALIERS.iter().find(|p| **p > zoom + 0.005) } else { PALIERS.iter().rev().find(|p| **p < zoom - 0.005) };
    voisin.copied().unwrap_or(if plus_grand { ZOOM_MAX } else { ZOOM_MIN })
}

/// Ce que la fenêtre écrit sur une page de Pécule pour lui dire la taille en cours : la page n'a pas d'autre moyen
/// de la connaître, et ses réglages la montrent.
pub fn dire_zoom(zoom: f64) -> String {
    format!("document.documentElement.dataset.peculeZoom = '{}'; window.dispatchEvent(new Event('pecule-zoom'));", (zoom * 100.0).round())
}

const FICHIER: &str = "fenetre.json";

/// Taille au-delà de laquelle une réponse du serveur n'est pas lue comme un logo.
const LOGO_MAX: u64 = 4 * 1024 * 1024;

/// Le logo d'origine de Pécule : c'est l'icône de l'appli elle-même, que le Dock sait déjà montrer.
const LOGO_D_ORIGINE: &str = "sable";

/// La taille de l'affichage gardée dans le dossier des données ; 1 (taille réelle) s'il n'y en a pas.
pub fn zoom_garde(dossier: &Path) -> f64 {
    std::fs::read_to_string(dossier.join(FICHIER))
        .ok()
        .and_then(|texte| serde_json::from_str::<Value>(&texte).ok())
        .and_then(|v| v["zoom"].as_f64())
        .filter(|z| (ZOOM_MIN..=ZOOM_MAX).contains(z))
        .unwrap_or(1.0)
}

pub fn garder_zoom(dossier: &Path, zoom: f64) {
    let _ = std::fs::write(dossier.join(FICHIER), format!("{}\n", json!({ "zoom": zoom })));
}

/// Un identifiant de logo, tel que Pécule les nomme (« sable », « 14-juillet ») : rien d'autre n'entre dans une adresse.
pub fn identifiant_de_logo(texte: &str) -> Option<String> {
    let propre = !texte.is_empty() && texte.len() <= 40 && texte.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
    propre.then(|| texte.to_string())
}

/// Le logo que la page annonce pour l'écran d'accueil (« /icons/coffre/<logo>-180.png ») : c'est celui du Dock.
pub fn logo_de_la_page(lien: &str) -> Option<String> {
    let nom = lien.rsplit('/').next()?.strip_suffix("-180.png")?;
    lien.contains("/icons/coffre/").then(|| identifiant_de_logo(nom)).flatten()
}

/// Lit une image de Pécule sur son serveur, qui est sur la machine : une requête, sa réponse, rien de plus.
fn lire_image(origine: &Url, chemin: &str) -> Option<Vec<u8>> {
    let (hote, port) = (origine.host_str()?, origine.port()?);
    let mut flux = TcpStream::connect((hote, port)).ok()?;
    flux.set_read_timeout(Some(Duration::from_secs(5))).ok()?;
    write!(flux, "GET {chemin} HTTP/1.0\r\nHost: {hote}:{port}\r\nConnection: close\r\n\r\n").ok()?;
    // Un logo pèse quelques dizaines de kilo-octets : au-delà de la borne, ce n'en est pas un.
    let mut reponse = Vec::new();
    flux.take(LOGO_MAX).read_to_end(&mut reponse).ok()?;
    if reponse.len() as u64 >= LOGO_MAX {
        return None;
    }
    let fin = reponse.windows(4).position(|w| w == b"\r\n\r\n")?;
    let entete = String::from_utf8_lossy(&reponse[..fin]);
    (entete.starts_with("HTTP/1.1 200") || entete.starts_with("HTTP/1.0 200")).then(|| reponse[fin + 4..].to_vec())
}

/// Pose dans le Dock le logo choisi à l'écran. Il y reste tant que l'appli est ouverte : quittée, le Dock montre
/// l'icône de l'appli elle-même — celle du logo d'origine.
pub fn poser_icone(app: &AppHandle, logo: String) {
    let coque = app.state::<Coque>();
    {
        let mut en_place = coque.icone.lock().unwrap();
        if *en_place == logo {
            return;
        }
        *en_place = logo.clone();
    }
    let app = app.clone();
    if logo == LOGO_D_ORIGINE {
        // Rien à dessiner : le Dock reprend l'icône de l'appli.
        let rendue = app.run_on_main_thread(|| dessiner(None)).is_ok();
        coque.noter(json!({ "icone": logo, "ok": rendue }));
        return;
    }
    let Some(origine) = coque.origine() else { return };
    std::thread::spawn(move || {
        let image = lire_image(&origine, &format!("/icons/coffre/{logo}-512.png"));
        let trouvee = image.is_some();
        if let Some(octets) = image {
            let _ = app.run_on_main_thread(move || dessiner(Some(&octets)));
        }
        app.state::<Coque>().noter(json!({ "icone": logo, "ok": trouvee }));
    });
}

/// L'icône d'une appli de Mac laisse une marge autour d'elle et a les coins ronds ; le logo de Pécule est un carré
/// plein, d'un bord à l'autre. Il est redessiné avec la marge et l'arrondi de l'icône de l'appli
/// (`bureau/fabriquer.mjs`, et le « rx » de `public/icons/icon.svg`).
#[cfg(target_os = "macos")]
fn dessiner(octets: Option<&[u8]>) {
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSApplication, NSBezierPath, NSCompositingOperation, NSImage};
    use objc2_foundation::{NSData, NSPoint, NSRect, NSSize};

    let Some(fil) = MainThreadMarker::new() else { return };
    let Some(octets) = octets else {
        // Sans image, le Dock montre l'icône de l'appli.
        unsafe { NSApplication::sharedApplication(fil).setApplicationIconImage(None) };
        return;
    };
    let Some(logo) = NSImage::initWithData(NSImage::alloc(), &NSData::with_bytes(octets)) else { return };
    let cote = 1024.0;
    let icone = NSImage::initWithSize(NSImage::alloc(), NSSize::new(cote, cote));
    #[allow(deprecated)]
    unsafe {
        icone.lockFocus();
        let cadre = NSRect::new(NSPoint::new(100.0, 100.0), NSSize::new(824.0, 824.0));
        let arrondi = 824.0 * 114.0 / 512.0;
        NSBezierPath::bezierPathWithRoundedRect_xRadius_yRadius(cadre, arrondi, arrondi).addClip();
        logo.drawInRect_fromRect_operation_fraction(cadre, NSRect::ZERO, NSCompositingOperation::SourceOver, 1.0);
        icone.unlockFocus();
        NSApplication::sharedApplication(fil).setApplicationIconImage(Some(&icone));
    }
}
#[cfg(not(target_os = "macos"))]
fn dessiner(_: Option<&[u8]>) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ne_retient_qu_un_identifiant_de_logo() {
        assert_eq!(identifiant_de_logo("sable").as_deref(), Some("sable"));
        assert_eq!(identifiant_de_logo("14-juillet").as_deref(), Some("14-juillet"));
        for faux in ["", "../secret", "sable.png", "Sable", "a/b", "sable?x=1", &"a".repeat(41)] {
            assert_eq!(identifiant_de_logo(faux), None, "{faux}");
        }
    }

    #[test]
    fn lit_le_logo_que_la_page_annonce() {
        assert_eq!(logo_de_la_page("/icons/coffre/noel-180.png").as_deref(), Some("noel"));
        assert_eq!(logo_de_la_page("http://127.0.0.1:47800/icons/coffre/sable-180.png").as_deref(), Some("sable"));
        assert_eq!(logo_de_la_page("/apple-touch-icon.png"), None);
        assert_eq!(logo_de_la_page("/ailleurs/sable-180.png"), None);
    }

    #[test]
    fn passe_d_une_taille_a_sa_voisine() {
        assert_eq!(palier_voisin(1.0, true), 1.1);
        assert_eq!(palier_voisin(1.0, false), 0.9);
        assert_eq!(palier_voisin(0.75, true), 0.8);
        assert_eq!(palier_voisin(0.77, false), 0.75);
        assert_eq!(palier_voisin(2.0, true), 2.0);
        assert_eq!(palier_voisin(0.5, false), 0.5);
        assert_eq!(dire_zoom(0.75), "document.documentElement.dataset.peculeZoom = '75'; window.dispatchEvent(new Event('pecule-zoom'));");
    }

    #[test]
    fn garde_la_taille_de_l_affichage() {
        let dossier = std::env::temp_dir().join(format!("pecule-essai-fenetre-{}", std::process::id()));
        std::fs::create_dir_all(&dossier).unwrap();
        assert_eq!(zoom_garde(&dossier), 1.0);
        garder_zoom(&dossier, 0.75);
        assert_eq!(zoom_garde(&dossier), 0.75);
        std::fs::write(dossier.join(FICHIER), "{\"zoom\": 12}").unwrap();
        assert_eq!(zoom_garde(&dossier), 1.0);
        std::fs::remove_dir_all(&dossier).unwrap();
    }
}
