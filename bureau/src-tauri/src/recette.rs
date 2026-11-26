// La recette de l'appli de bureau, rejouable sans personne devant l'écran. Lancée avec « --recette <socket> », la
// coque écoute sur ce socket (un fichier que seul le compte peut ouvrir) et fait ce qu'on lui demande, une ligne JSON
// par demande : exécuter du JavaScript dans une fenêtre et rendre sa valeur, dire où en sont ses fenêtres, jouer un
// élément de menu, naviguer, quitter. Dans ce mode, rien ne sort de l'appli : un lien extérieur ou un dossier à
// ouvrir sont notés (`journal`), pas ouverts.
//
// Sans cette option, rien de tout cela n'existe : la coque n'écoute nulle part.
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, Url, WebviewWindow};

use crate::Coque;

pub fn ecouter(app: &AppHandle, socket: PathBuf) {
    let _ = std::fs::remove_file(&socket);
    let Ok(ecoute) = UnixListener::bind(&socket) else {
        eprintln!("recette : le socket {} ne se laisse pas ouvrir", socket.display());
        return;
    };
    let _ = std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600));
    let app = app.clone();
    std::thread::spawn(move || {
        for connexion in ecoute.incoming().flatten() {
            let app = app.clone();
            std::thread::spawn(move || servir(&app, connexion));
        }
    });
}

fn servir(app: &AppHandle, connexion: UnixStream) {
    let Ok(mut sortie) = connexion.try_clone() else { return };
    for ligne in BufReader::new(connexion).lines().map_while(Result::ok) {
        let demande: Value = serde_json::from_str(&ligne).unwrap_or(json!({}));
        let mut reponse = repondre(app, &demande);
        reponse["id"] = demande["id"].clone();
        if writeln!(sortie, "{reponse}").is_err() {
            break;
        }
    }
}

fn repondre(app: &AppHandle, demande: &Value) -> Value {
    let coque = app.state::<Coque>();
    let label = demande["fenetre"].as_str().unwrap_or(crate::PRINCIPALE);

    // { "js": "…" } : la valeur de l'expression, telle que la page la rend en JSON.
    if let Some(js) = demande["js"].as_str() {
        let Some(fenetre) = app.get_webview_window(label) else { return json!({ "erreur": format!("pas de fenêtre « {label} »") }) };
        let (envoi, reception) = channel();
        let lance = fenetre.eval_with_callback(js, move |valeur| {
            let _ = envoi.send(valeur);
        });
        if let Err(e) = lance {
            return json!({ "erreur": e.to_string() });
        }
        return match reception.recv_timeout(Duration::from_secs(15)) {
            Ok(valeur) => json!({ "valeur": serde_json::from_str::<Value>(&valeur).unwrap_or(Value::String(valeur)) }),
            Err(_) => json!({ "erreur": "la page n'a pas répondu" }),
        };
    }

    // { "etat": true } : où en est la coque.
    if demande["etat"] == json!(true) {
        let fenetres: Vec<Value> = app
            .webview_windows()
            .into_iter()
            .map(|(label, f)| json!({ "label": label, "url": f.url().map(|u| u.to_string()).unwrap_or_default(), "titre": f.title().unwrap_or_default(), "visible": f.is_visible().unwrap_or(false) }))
            .collect();
        return json!({ "version": app.package_info().version.to_string(), "origine": coque.origine().map(|o| o.to_string()), "statut": coque.statut(), "fenetres": fenetres, "journal": coque.journal.lock().unwrap().clone() });
    }

    // { "menu": "oubli" } : l'élément de menu, comme si on l'avait choisi.
    if let Some(id) = demande["menu"].as_str() {
        let (pour_menu, id) = (app.clone(), id.to_string());
        let lance = app.run_on_main_thread(move || crate::action_menu(&pour_menu, &id));
        return json!({ "ok": lance.is_ok() });
    }

    // { "naviguer": "http://…" } : la fenêtre y va, si la coque l'y autorise.
    if let Some(adresse) = demande["naviguer"].as_str() {
        let (Some(fenetre), Ok(url)) = (app.get_webview_window(label), Url::parse(adresse)) else { return json!({ "erreur": "fenêtre ou adresse illisible" }) };
        return json!({ "ok": fenetre.navigate(url).is_ok() });
    }

    // { "fermer": true } : la fenêtre se ferme, comme par son bouton rouge.
    if demande["fermer"] == json!(true) {
        let Some(fenetre) = app.get_webview_window(label) else { return json!({ "erreur": format!("pas de fenêtre « {label} »") }) };
        return json!({ "ok": fenetre.close().is_ok() });
    }

    // { "capture": "/chemin.png" } : l'image de la page, telle que la fenêtre la montre.
    if let Some(fichier) = demande["capture"].as_str() {
        let Some(fenetre) = app.get_webview_window(label) else { return json!({ "erreur": format!("pas de fenêtre « {label} »") }) };
        return match capturer(&fenetre, PathBuf::from(fichier)) {
            Ok(()) => json!({ "ok": true }),
            Err(e) => json!({ "erreur": e }),
        };
    }

    // { "dialogues": false } : la réponse rendue aux prochaines questions (`confirm` d'une page, question de la coque).
    if let Some(reponse) = demande["dialogues"].as_bool() {
        crate::dialogues::REPONSE_RECETTE.store(reponse, std::sync::atomic::Ordering::SeqCst);
        return json!({ "ok": true });
    }

    if demande["quitter"] == json!(true) {
        crate::quitter(app);
        return json!({ "ok": true });
    }
    json!({ "erreur": "demande inconnue" })
}

/// Une page évaluée par la recette n'a fait aucun geste : sans cela, WebKit refuserait qu'elle ouvre une fenêtre
/// (`window.open`, lien « _blank »), et ce que la coque fait de ces fenêtres ne pourrait pas s'essayer.
#[cfg(target_os = "macos")]
pub fn fenetres_sans_geste(fenetre: &WebviewWindow) {
    let _ = fenetre.with_webview(|webview| unsafe {
        let vue: &objc2_web_kit::WKWebView = &*webview.inner().cast();
        vue.configuration().preferences().setJavaScriptCanOpenWindowsAutomatically(true);
    });
}
#[cfg(not(target_os = "macos"))]
pub fn fenetres_sans_geste(_: &WebviewWindow) {}

/// L'image de la page, écrite en PNG : c'est WebKit qui la rend, sans capture d'écran (aucune autorisation à demander).
#[cfg(target_os = "macos")]
fn capturer(fenetre: &WebviewWindow, fichier: PathBuf) -> Result<(), String> {
    use block2::RcBlock;
    use objc2_app_kit::{NSBitmapImageFileType, NSBitmapImageRep, NSImage};
    use objc2_foundation::{NSDictionary, NSError};

    let (envoi, reception) = channel::<Result<Vec<u8>, String>>();
    fenetre
        .with_webview(move |webview| unsafe {
            let vue: &objc2_web_kit::WKWebView = &*webview.inner().cast();
            let bloc = RcBlock::new(move |image: *mut NSImage, _erreur: *mut NSError| {
                let rendu = (|| {
                    let image = image.as_ref().ok_or("WebKit n'a pas rendu d'image")?;
                    let tiff = image.TIFFRepresentation().ok_or("image illisible")?;
                    let points = NSBitmapImageRep::imageRepWithData(&tiff).ok_or("image illisible")?;
                    let png = points.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new()).ok_or("PNG impossible")?;
                    Ok::<Vec<u8>, &str>(png.to_vec())
                })();
                let _ = envoi.send(rendu.map_err(String::from));
            });
            vue.takeSnapshotWithConfiguration_completionHandler(None, &bloc);
        })
        .map_err(|e| e.to_string())?;
    let png = reception.recv_timeout(Duration::from_secs(10)).map_err(|_| "la page ne s'est pas laissé capturer".to_string())??;
    std::fs::write(fichier, png).map_err(|e| e.to_string())
}
#[cfg(not(target_os = "macos"))]
fn capturer(_: &WebviewWindow, _: PathBuf) -> Result<(), String> {
    Err("capture : sur Mac seulement".into())
}
