// Les fenêtres de dialogue de la coque. WebKit laisse à l'appli le soin d'afficher les `confirm()` et les `alert()`
// d'une page, et la bibliothèque qui tient la fenêtre ne le fait pas : sans ce module, chaque confirmation de Pécule
// (« Supprimer ce document ? ») répondrait « non » sans rien montrer. La coque s'en sert aussi pour ses propres
// questions (mise à jour).
//
// En recette, personne n'est là pour fermer une fenêtre de dialogue : la question est notée, et la réponse est celle
// que la recette a réglée.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::channel;
use std::sync::OnceLock;

use serde_json::json;
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::Coque;

static APPLI: OnceLock<AppHandle> = OnceLock::new();
/// La réponse rendue aux questions pendant une recette.
pub static REPONSE_RECETTE: AtomicBool = AtomicBool::new(true);

pub fn preparer(app: &AppHandle) {
    let _ = APPLI.set(app.clone());
}

/// Pose une question dans une fenêtre du système, sur le fil principal. `annuler` absent : une simple annonce.
pub fn demander(titre: &str, message: &str, valider: &str, annuler: Option<&str>) -> bool {
    if let Some(app) = APPLI.get() {
        let coque = app.state::<Coque>();
        if coque.recette {
            let reponse = annuler.is_none() || REPONSE_RECETTE.load(Ordering::SeqCst);
            coque.noter(json!({ "dialogue": message, "titre": titre, "reponse": reponse }));
            return reponse;
        }
    }
    montrer(titre, message, valider, annuler)
}

/// La même question, posée depuis un autre fil que le principal (la mise à jour).
pub fn demander_depuis(app: &AppHandle, titre: String, message: String, valider: String, annuler: Option<String>) -> bool {
    let (envoi, reception) = channel();
    let pose = app.run_on_main_thread(move || {
        let _ = envoi.send(demander(&titre, &message, &valider, annuler.as_deref()));
    });
    pose.is_ok() && reception.recv().unwrap_or(false)
}

#[cfg(target_os = "macos")]
fn montrer(titre: &str, message: &str, valider: &str, annuler: Option<&str>) -> bool {
    use objc2::MainThreadMarker;
    use objc2_app_kit::{NSAlert, NSAlertFirstButtonReturn};
    use objc2_foundation::NSString;

    let Some(fil) = MainThreadMarker::new() else { return false };
    let alerte = NSAlert::new(fil);
    alerte.setMessageText(&NSString::from_str(titre));
    alerte.setInformativeText(&NSString::from_str(message));
    alerte.addButtonWithTitle(&NSString::from_str(valider));
    if let Some(a) = annuler {
        alerte.addButtonWithTitle(&NSString::from_str(a));
    }
    alerte.runModal() == NSAlertFirstButtonReturn
}
#[cfg(not(target_os = "macos"))]
fn montrer(_: &str, _: &str, _: &str, _: Option<&str>) -> bool {
    false
}

/// Donne aux pages de cette fenêtre leurs `confirm()` et leurs `alert()`.
#[cfg(target_os = "macos")]
pub fn pour_les_pages(fenetre: &WebviewWindow) {
    use objc2::ffi::{class_addMethod, object_getClass};
    use objc2::runtime::{AnyObject, Bool, Imp, Sel};
    use objc2::sel;
    use objc2_foundation::NSString;
    use objc2_web_kit::WKWebView;

    /// De qui vient la question : « Pécule », ou le site que la fenêtre affiche (la banque).
    fn titre_de(vue: &WKWebView) -> String {
        let hote = unsafe { vue.URL() }.and_then(|u| u.host()).map(|h| h.to_string()).unwrap_or_default();
        let chez_nous = APPLI.get().and_then(|app| app.state::<Coque>().origine()).and_then(|o| o.host_str().map(str::to_string)).is_some_and(|o| o == hote);
        if chez_nous || hote.is_empty() {
            "Pécule".to_string()
        } else {
            hote
        }
    }
    fn mots() -> (String, String) {
        let annuler = APPLI.get().map(|app| app.state::<Coque>().texte("cancel")).unwrap_or_else(|| "Annuler".to_string());
        ("OK".to_string(), annuler)
    }
    unsafe extern "C-unwind" fn alerte(_moi: &AnyObject, _sel: Sel, vue: &WKWebView, message: &NSString, _cadre: &AnyObject, fin: &block2::Block<dyn Fn()>) {
        demander(&titre_de(vue), &message.to_string(), &mots().0, None);
        fin.call(());
    }
    unsafe extern "C-unwind" fn confirmation(_moi: &AnyObject, _sel: Sel, vue: &WKWebView, message: &NSString, _cadre: &AnyObject, fin: &block2::Block<dyn Fn(Bool)>) {
        let (valider, annuler) = mots();
        let oui = demander(&titre_de(vue), &message.to_string(), &valider, Some(&annuler));
        fin.call((Bool::new(oui),));
    }

    let _ = fenetre.with_webview(|webview| unsafe {
        let vue: &WKWebView = &*webview.inner().cast();
        let Some(delegue) = vue.UIDelegate() else { return };
        // Le délégué de la fenêtre appartient à la bibliothèque : on ajoute à sa classe les deux réponses qui lui manquent.
        let classe = object_getClass((&*delegue as *const _ as *const AnyObject).cast()).cast_mut();
        let types = c"v@:@@@@?".as_ptr();
        class_addMethod(classe.cast(), sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:), std::mem::transmute::<unsafe extern "C-unwind" fn(&AnyObject, Sel, &WKWebView, &NSString, &AnyObject, &block2::Block<dyn Fn()>), Imp>(alerte), types);
        class_addMethod(classe.cast(), sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:), std::mem::transmute::<unsafe extern "C-unwind" fn(&AnyObject, Sel, &WKWebView, &NSString, &AnyObject, &block2::Block<dyn Fn(Bool)>), Imp>(confirmation), types);
        // WebKit retient ce que sait faire un délégué au moment où on le lui donne : on le lui redonne.
        vue.setUIDelegate(None);
        vue.setUIDelegate(Some(&delegue));
    });
}
#[cfg(not(target_os = "macos"))]
pub fn pour_les_pages(_: &WebviewWindow) {}
