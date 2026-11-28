// La coque de l'appli de bureau de Pécule : une fenêtre, rien de plus. Tout le reste — dossier des données, réglages,
// base MySQL, serveur — est le travail du superviseur (`scripts/bureau.mjs`), que la coque lance et dont elle charge
// l'adresse. Elle porte le menu, ouvre les liens extérieurs dans le navigateur, garde la banque dans une fenêtre à
// part, et arrête le superviseur en quittant. Si elle disparaît, le superviseur le voit (son entrée se ferme) et
// arrête tout de lui-même.
//
// La page de Pécule ne reçoit aucun pouvoir de la coque : pas de commande, pas d'API. La coque ne fait que regarder
// où la fenêtre veut aller (`on_navigation`, `on_new_window`).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod apparence;
mod dialogues;
mod recette;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::menu::{AboutMetadata, Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionKind, PermissionResponse};
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_updater::UpdaterExt;

/// Fenêtre de l'appli.
const PRINCIPALE: &str = "main";
/// Fenêtre où se fait l'accord chez la banque, puis qui se referme.
const BANQUE: &str = "banque";
/// Magasin de données web de la recette (macOS) : à part de celui de l'appli.
const MAGASIN_RECETTE: [u8; 16] = *b"pecule-recette-1";
/// Magasin de données web de la fenêtre de la banque : elle n'a jamais le témoin de session de Pécule, où qu'on l'emmène.
const MAGASIN_BANQUE: [u8; 16] = *b"pecule-banque-01";
/// Le seul chemin de Pécule où une banque ramène (`ebRedirectUrl`, src/server/enable-banking.ts).
const RETOUR_BANQUE: &str = "/reglages/comptes";
/// Ce par quoi Pécule demande à la coque d'ouvrir l'accord d'une banque (`bankAuthLink`, src/lib/desktop.ts).
const SCHEMA_BANQUE: &str = "pecule-banque";
/// Site de Pécule (menu Aide).
const SITE: &str = "https://pecule.org";

/// Le superviseur lancé par la coque, et son entrée : la fermer, c'est lui dire de tout arrêter.
struct Superviseur {
    enfant: Child,
    entree: ChildStdin,
}

/// Ce que la coque sait, partagé entre ses fils d'exécution.
pub struct Coque {
    /// Les mots de la coque, dans la langue du système (`textes.json`).
    textes: HashMap<String, String>,
    langue: String,
    /// Node, MySQL et Pécule : dans l'appli, ou donnés pour un essai.
    node: PathBuf,
    mysql: PathBuf,
    pecule: PathBuf,
    /// Dossier des données demandé au lancement (sinon celui du système, choisi par le superviseur).
    donnees: Option<PathBuf>,
    /// Lancée pour une recette : rien ne sort de l'appli (ni navigateur, ni Finder), tout est noté, et ce qu'elle
    /// télécharge va dans ce dossier (celui de son socket).
    pub recette: bool,
    dossier_recette: Option<PathBuf>,
    superviseur: Mutex<Option<Superviseur>>,
    /// Adresse de Pécule une fois prêt (http://127.0.0.1:<port>), et dossier des données annoncé.
    origine: Mutex<Option<Url>>,
    dossier: Mutex<Option<PathBuf>>,
    /// Adresse de l'écran de démarrage, et ce qu'il montre.
    accueil: Mutex<Option<Url>>,
    statut: Mutex<Value>,
    /// Demandes faites au superviseur, en attente de leur réponse.
    attentes: Mutex<HashMap<u64, Sender<Value>>>,
    numero: AtomicU64,
    zoom: Mutex<f64>,
    /// Le logo posé dans le Dock (identifiant de Pécule), pour ne le redessiner que s'il change.
    icone: Mutex<String>,
    quitte: AtomicBool,
    /// Un Pécule tournait déjà sur ce dossier de données (lancé à la main) : la fenêtre s'y est branchée, il n'est pas à elle.
    adopte: AtomicBool,
    /// Ce que la coque a fait vers l'extérieur (liens ouverts, téléchargements) : lu par la recette.
    pub journal: Mutex<Vec<Value>>,
    /// Où va chaque téléchargement en cours.
    telechargements: Mutex<HashMap<String, PathBuf>>,
}

impl Coque {
    pub fn texte(&self, id: &str) -> String {
        self.textes.get(id).cloned().unwrap_or_else(|| id.to_string())
    }
    pub fn origine(&self) -> Option<Url> {
        self.origine.lock().unwrap().clone()
    }
    pub fn statut(&self) -> Value {
        self.statut.lock().unwrap().clone()
    }
    /// Ce que la coque fait vers l'extérieur, noté pour la recette seulement : hors d'elle, rien n'est gardé (ces
    /// adresses portent parfois un code de retour de la banque).
    pub fn noter(&self, quoi: Value) {
        if self.recette {
            self.journal.lock().unwrap().push(quoi);
        }
    }
}

/// Les mots de la coque dans la langue du système ; le français quand Pécule ne parle pas cette langue.
fn charger_textes() -> (String, HashMap<String, String>) {
    let tous: HashMap<String, HashMap<String, String>> = serde_json::from_str(include_str!("../textes.json")).unwrap_or_default();
    let voulue = sys_locale::get_locale().unwrap_or_default().to_lowercase();
    let langue = voulue.split(['-', '_']).next().unwrap_or("fr").to_string();
    let langue = if tous.contains_key(&langue) { langue } else { "fr".to_string() };
    let textes = tous.get(&langue).cloned().unwrap_or_default();
    (langue, textes)
}

/// Valeur d'une option « --nom valeur » de la ligne de commande.
fn option(nom: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == nom).and_then(|i| args.get(i + 1)).cloned()
}

fn fenetre(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

/// Sort d'un rappel de la fenêtre avant d'agir sur elle : WebKit n'aime pas qu'on le fasse naviguer pendant qu'il demande où aller.
fn plus_tard<F: FnOnce() + Send + 'static>(f: F) {
    std::thread::spawn(f);
}

// ---------- Écran de démarrage ----------

/// L'écran de démarrage, embarqué dans la coque (« tauri://localhost » sur Mac, « http://tauri.localhost » sur Windows).
fn est_accueil(url: &Url) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost")) || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost") && url.port().is_none())
}

/// Montre l'état courant sur l'écran de démarrage, en y ramenant la fenêtre s'il le faut.
fn montrer_demarrage(app: &AppHandle) {
    let coque = app.state::<Coque>();
    let Some(principale) = fenetre(app, PRINCIPALE) else { return };
    let accueil = coque.accueil.lock().unwrap().clone();
    if principale.url().is_ok_and(|u| est_accueil(&u)) {
        let _ = principale.eval(format!("window.afficher && window.afficher({})", coque.statut()));
    } else if let Some(a) = accueil {
        // La page dira son état en finissant de se charger (`page_chargee`).
        let _ = principale.navigate(a);
    }
    let _ = principale.show();
}

fn dire(app: &AppHandle, titre: &str, detail: Option<String>, erreur: bool) {
    let coque = app.state::<Coque>();
    *coque.statut.lock().unwrap() = json!({
        "titre": titre, "detail": detail, "erreur": erreur, "langue": coque.langue,
        "reessayer": coque.texte("retry"), "journaux": coque.texte("logs"),
    });
}

// ---------- Superviseur ----------

/// Lance le superviseur et écoute ce qu'il dit. Rien d'autre ne démarre Pécule.
fn lancer_superviseur(app: &AppHandle) {
    let coque = app.state::<Coque>();
    // Un superviseur vit déjà (« Réessayer » deux fois de suite) : le second fermerait le premier, et sa base avec.
    if coque.superviseur.lock().unwrap().is_some() {
        return;
    }
    *coque.origine.lock().unwrap() = None;
    coque.adopte.store(false, Ordering::SeqCst);
    dire(app, &coque.texte("starting"), None, false);
    montrer_demarrage(app);

    let mut commande = Command::new(&coque.node);
    commande
        .arg(coque.pecule.join("scripts").join("bureau.mjs"))
        .arg("--mysql")
        .arg(&coque.mysql)
        .args(["--json", "--attache", "--coque"]);
    if let Some(d) = &coque.donnees {
        commande.arg("--donnees").arg(d);
    }
    commande.current_dir(&coque.pecule).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    let mut enfant = match commande.spawn() {
        Ok(e) => e,
        Err(e) => {
            dire(app, &coque.texte("failed"), Some(format!("{} : {e}", coque.node.display())), true);
            montrer_demarrage(app);
            return;
        }
    };
    let (Some(entree), Some(sortie)) = (enfant.stdin.take(), enfant.stdout.take()) else { return };
    *coque.superviseur.lock().unwrap() = Some(Superviseur { enfant, entree });

    let app = app.clone();
    std::thread::spawn(move || {
        for ligne in BufReader::new(sortie).lines().map_while(Result::ok) {
            if let Ok(evenement) = serde_json::from_str::<Value>(&ligne) {
                evenement_superviseur(&app, evenement);
            }
        }
        // Le superviseur a rendu la main : voulu (on quitte), ou non (il le dit alors sur l'écran de démarrage).
        let coque = app.state::<Coque>();
        if let Some(mut s) = coque.superviseur.lock().unwrap().take() {
            let _ = s.enfant.wait();
        }
        if coque.quitte.load(Ordering::SeqCst) || coque.adopte.load(Ordering::SeqCst) {
            return;
        }
        *coque.origine.lock().unwrap() = None;
        if coque.statut()["erreur"] != json!(true) {
            dire(&app, &coque.texte("stopped"), None, true);
        }
        montrer_demarrage(&app);
    });
}

fn evenement_superviseur(app: &AppHandle, e: Value) {
    let coque = app.state::<Coque>();
    match e["etat"].as_str().unwrap_or("") {
        "demarrage" => {
            let etape = match e["etape"].as_str().unwrap_or("") {
                "creation" => coque.texte("stepCreate"),
                "base" => coque.texte("stepDatabase"),
                "serveur" => coque.texte("stepServer"),
                _ => String::new(),
            };
            let titre = if etape.is_empty() { coque.texte("starting") } else { etape };
            dire(app, &titre, None, false);
            montrer_demarrage(app);
        }
        "pret" | "deja" => {
            if e["etat"] == json!("deja") {
                coque.adopte.store(true, Ordering::SeqCst);
            }
            let Some(origine) = e["url"].as_str().and_then(|u| Url::parse(u).ok()) else { return };
            *coque.origine.lock().unwrap() = Some(origine.clone());
            if let Some(d) = e["donnees"].as_str() {
                *coque.dossier.lock().unwrap() = Some(PathBuf::from(d));
                // La taille de l'affichage choisie la dernière fois.
                *coque.zoom.lock().unwrap() = apparence::zoom_garde(Path::new(d));
            }
            appliquer_zoom(app);
            // Première ouverture : le lien porte le code d'installation, il n'y a qu'un prénom à donner.
            let ouvrir = e["ouvrir"].as_str().and_then(|u| Url::parse(u).ok()).unwrap_or(origine);
            if let Some(principale) = fenetre(app, PRINCIPALE) {
                let _ = principale.navigate(ouvrir);
            }
        }
        "erreur" => {
            let mut detail = e["message"].as_str().unwrap_or("").to_string();
            if let Some(fix) = e["fix"].as_str() {
                detail.push_str("\n→ ");
                detail.push_str(fix);
            }
            if let Some(j) = e["journaux"].as_str() {
                *coque.dossier.lock().unwrap() = PathBuf::from(j).parent().map(PathBuf::from);
            }
            dire(app, &coque.texte("failed"), Some(detail), true);
            montrer_demarrage(app);
        }
        "reponse" => {
            if let Some(id) = e["id"].as_u64() {
                if let Some(attente) = coque.attentes.lock().unwrap().remove(&id) {
                    let _ = attente.send(e);
                }
            }
        }
        _ => {}
    }
}

/// Une demande au superviseur, et sa réponse (ou rien, s'il ne répond pas à temps).
fn demander(app: &AppHandle, mut commande: Value) -> Option<Value> {
    let coque = app.state::<Coque>();
    let id = coque.numero.fetch_add(1, Ordering::SeqCst) + 1;
    commande["id"] = json!(id);
    let (envoi, reception) = channel();
    coque.attentes.lock().unwrap().insert(id, envoi);
    {
        let mut superviseur = coque.superviseur.lock().unwrap();
        let s = superviseur.as_mut()?;
        writeln!(s.entree, "{commande}").ok()?;
        s.entree.flush().ok()?;
    }
    let reponse = reception.recv_timeout(Duration::from_secs(15)).ok();
    coque.attentes.lock().unwrap().remove(&id);
    reponse
}

/// Demande au superviseur de tout arrêter, et attend qu'il l'ait fait : la base écrit ce qu'elle a en mémoire.
fn arreter_superviseur(app: &AppHandle) {
    let coque = app.state::<Coque>();
    coque.quitte.store(true, Ordering::SeqCst);
    let Some(mut s) = coque.superviseur.lock().unwrap().take() else { return };
    let _ = writeln!(s.entree, "{}", json!({ "commande": "arreter" }));
    // L'entrée fermée dit la même chose : le superviseur s'arrête même s'il n'a pas lu la ligne.
    drop(s.entree);
    let limite = Instant::now() + Duration::from_secs(80);
    while Instant::now() < limite {
        if let Ok(Some(_)) = s.enfant.try_wait() {
            return;
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

// ---------- Où la fenêtre a le droit d'aller ----------

fn meme_origine(app: &AppHandle, url: &Url) -> bool {
    app.state::<Coque>().origine().is_some_and(|o| o.origin() == url.origin())
}

/// Le retour de la banque : Enable Banking exige une adresse en https, et l'appli de bureau n'en a pas. L'adresse
/// déclarée chez lui est `https://localhost:<port>/…`, que personne ne sert : la coque la reconnaît avant que la
/// fenêtre n'y aille, et rend le même chemin au serveur local, en http. Aucun certificat, rien sur le réseau.
fn retour_banque(app: &AppHandle, url: &Url) -> Option<Url> {
    let origine = app.state::<Coque>().origine()?;
    // Ce chemin-là, et aucun autre : une page ne fait pas rejouer par la fenêtre de Pécule l'adresse de son choix.
    if url.scheme() != "https" || url.host_str() != Some("localhost") || url.port() != origine.port() || url.path() != RETOUR_BANQUE {
        return None;
    }
    let mut local = origine;
    local.set_path(url.path());
    local.set_query(url.query());
    Some(local)
}

/// Ouvre une adresse hors de l'appli, dans le navigateur ou l'appli que le système lui associe.
/// Une adresse du Web ou un courriel, rien d'autre : une page ne fait pas lancer par la coque l'appli de son choix
/// (partage réseau, prise en main à distance, raccourci) par un lien à son schéma.
fn ouvrir_dehors(app: &AppHandle, url: &Url) {
    let coque = app.state::<Coque>();
    if !matches!(url.scheme(), "https" | "http" | "mailto") {
        coque.noter(json!({ "refuse": url.as_str() }));
        return;
    }
    coque.noter(json!({ "dehors": url.as_str() }));
    if !coque.recette {
        let _ = tauri_plugin_opener::open_url(url.as_str(), None::<&str>);
    }
}

fn ouvrir_dossier(app: &AppHandle, sous_dossier: Option<&str>) {
    let coque = app.state::<Coque>();
    let Some(mut dossier) = coque.dossier.lock().unwrap().clone().or_else(|| coque.donnees.clone()) else { return };
    if let Some(s) = sous_dossier {
        dossier.push(s);
    }
    coque.noter(json!({ "dossier": dossier }));
    if !coque.recette {
        let _ = tauri_plugin_opener::open_path(dossier.to_string_lossy().to_string(), None::<&str>);
    }
}

/// L'accord d'une banque, tel que Pécule le demande à la coque : « pecule-banque://ouvrir?vers=<adresse> ».
fn accord_banque(app: &AppHandle, url: &Url) -> Option<Url> {
    if url.scheme() != SCHEMA_BANQUE {
        return None;
    }
    let vers = url.query_pairs().find(|(nom, _)| nom == "vers").and_then(|(_, valeur)| Url::parse(&valeur).ok())?;
    // Une banque se joint en https. (La fausse banque de la recette est sur la machine, en http.)
    (vers.scheme() == "https" || (vers.scheme() == "http" && app.state::<Coque>().recette)).then_some(vers)
}

/// Ce que décide la fenêtre principale pour une navigation : `true`, elle y va. Elle ne quitte jamais Pécule : un
/// lien vers l'extérieur part dans le navigateur — qu'il demande ou non une nouvelle fenêtre, WebKit pose d'abord la
/// question ici —, et seul l'accord d'une banque, que Pécule demande par son propre schéma, s'ouvre dans l'appli.
fn naviguer_principale(app: &AppHandle, url: &Url) -> bool {
    if est_accueil(url) || meme_origine(app, url) {
        return true;
    }
    // D'où part la demande : les boutons de l'écran de démarrage ne valent que sur lui, l'accord d'une banque que
    // depuis Pécule.
    let ici = fenetre(app, PRINCIPALE).and_then(|f| f.url().ok());
    let sur_accueil = ici.as_ref().is_some_and(est_accueil);
    let sur_pecule = ici.as_ref().is_some_and(|u| meme_origine(app, u));
    match url.scheme() {
        // Contenus que la page fabrique elle-même (aperçu d'un fichier, cadre vide).
        "about" | "blob" | "data" => true,
        // Boutons de l'écran de démarrage.
        "pecule-action" => {
            let (app, quoi) = (app.clone(), url.host_str().unwrap_or("").to_string());
            let demande = |nom: &str| url.query_pairs().find(|(n, _)| n == nom).map(|(_, v)| v.to_string());
            if sur_accueil {
                plus_tard(move || match quoi.as_str() {
                    "reessayer" => lancer_superviseur(&app),
                    "journaux" => ouvrir_dossier(&app, Some("journaux")),
                    _ => {}
                });
            } else if sur_pecule {
                // Ce que l'écran de Pécule demande à sa fenêtre : la taille de l'affichage (en pour cent), le logo du Dock.
                let niveau = demande("niveau").and_then(|n| n.parse::<f64>().ok());
                let logo = demande("id").and_then(|i| apparence::identifiant_de_logo(&i));
                plus_tard(move || match (quoi.as_str(), niveau, logo) {
                    ("zoom", Some(n), _) => regler_zoom(&app, n / 100.0),
                    ("icone", _, Some(l)) => apparence::poser_icone(&app, l),
                    _ => {}
                });
            }
            false
        }
        SCHEMA_BANQUE => {
            if let (true, Some(vers)) = (sur_pecule, accord_banque(app, url)) {
                let app = app.clone();
                plus_tard(move || ouvrir_banque(&app, vers));
            }
            false
        }
        _ => {
            if let Some(local) = retour_banque(app, url) {
                let app = app.clone();
                plus_tard(move || rendre_a_pecule(&app, local));
            } else if sur_pecule {
                ouvrir_dehors(app, url);
            }
            false
        }
    }
}

/// Un lien qui demande une nouvelle fenêtre : un fichier de Pécule (document, facture) s'ouvre dans une fenêtre de
/// l'appli, tout le reste dans le navigateur.
fn nouvelle_fenetre(app: &AppHandle, url: Url) {
    if !meme_origine(app, &url) {
        // En principe déjà parti dans le navigateur (`naviguer_principale`).
        ouvrir_dehors(app, &url);
        return;
    }
    let app = app.clone();
    plus_tard(move || {
        let coque = app.state::<Coque>();
        let label = format!("document-{}", coque.numero.fetch_add(1, Ordering::SeqCst) + 1);
        let (pour_navigation, pour_telechargement) = (app.clone(), app.clone());
        let mut constructeur = WebviewWindowBuilder::new(&app, label, WebviewUrl::External(url));
        if coque.recette {
            constructeur = constructeur.data_store_identifier(MAGASIN_RECETTE);
        }
        let document = constructeur
            .title("Pécule")
            .inner_size(900.0, 1000.0)
            .on_navigation(move |u| {
                if meme_origine(&pour_navigation, u) || matches!(u.scheme(), "about" | "blob" | "data") {
                    return true;
                }
                // Un lien dans un document : il part dans le navigateur.
                ouvrir_dehors(&pour_navigation, u);
                false
            })
            .on_download(move |_, evenement| telechargement(&pour_telechargement, evenement))
            .on_permission_request(|_, _| PermissionResponse::Deny)
            .build();
        if let Ok(document) = document {
            dialogues::pour_les_pages(&document);
            let _ = document.set_zoom(*coque.zoom.lock().unwrap());
        }
    });
}

/// La fenêtre de la banque : elle va où la banque l'envoie, et se referme au retour vers Pécule. Son titre dit
/// toujours chez qui l'on est — elle n'a pas de barre d'adresse.
fn ouvrir_banque(app: &AppHandle, url: Url) {
    app.state::<Coque>().noter(json!({ "banque": url.as_str() }));
    if let Some(deja) = fenetre(app, BANQUE) {
        let _ = deja.navigate(url);
        let _ = deja.set_focus();
        return;
    }
    let (pour_navigation, pour_fenetres, pour_titre) = (app.clone(), app.clone(), app.clone());
    let recette = app.state::<Coque>().recette;
    let banque = WebviewWindowBuilder::new(app, BANQUE, WebviewUrl::External(url))
        .data_store_identifier(MAGASIN_BANQUE)
        .title(app.state::<Coque>().texte("bank"))
        .inner_size(980.0, 820.0)
        .on_navigation(move |u| {
            let app = pour_navigation.clone();
            // Le seul retour vers Pécule : son adresse de retour, que la fenêtre principale reprend. Toute autre
            // adresse de Pécule est refusée — la banque ne fait rien rejouer par la fenêtre qui a la session.
            if let Some(local) = retour_banque(&app, u) {
                plus_tard(move || rendre_a_pecule(&app, local));
                return false;
            }
            if meme_origine(&app, u) {
                return false;
            }
            match u.scheme() {
                // Une banque se joint en https. (La fausse banque de la recette est sur la machine, en http.)
                "https" | "about" | "blob" | "data" => true,
                "http" => recette,
                // Aucun autre schéma : la fenêtre d'une banque ne fait lancer aucune appli.
                _ => {
                    app.state::<Coque>().noter(json!({ "refuse": u.as_str() }));
                    false
                }
            }
        })
        // Une banque qui ouvre une fenêtre de plus : elle continue dans celle-ci.
        .on_new_window(move |u, _| {
            let app = pour_fenetres.clone();
            plus_tard(move || {
                if let Some(banque) = fenetre(&app, BANQUE) {
                    let _ = banque.navigate(u);
                }
            });
            NewWindowResponse::Deny
        })
        // Ni micro, ni caméra, ni position pour le site d'une banque.
        .on_permission_request(|_, _| PermissionResponse::Deny)
        // Le titre suit la fenêtre dès qu'elle change d'adresse, sans attendre la fin du chargement.
        .on_page_load(move |window, charge| {
            let hote = charge.url().host_str().unwrap_or("").to_string();
            let _ = window.set_title(&format!("{hote} — {}", pour_titre.state::<Coque>().texte("bank")));
        })
        .build();
    if let Ok(banque) = banque {
        dialogues::pour_les_pages(&banque);
    }
}

/// La banque a rendu la main : la fenêtre principale reprend à l'adresse du retour, celle de la banque se ferme.
fn rendre_a_pecule(app: &AppHandle, local: Url) {
    app.state::<Coque>().noter(json!({ "retour": local.as_str() }));
    if let Some(principale) = fenetre(app, PRINCIPALE) {
        let _ = principale.navigate(local);
        let _ = principale.show();
        let _ = principale.set_focus();
    }
    if let Some(banque) = fenetre(app, BANQUE) {
        let _ = banque.close();
    }
}

/// Un téléchargement part dans le dossier Téléchargements ; une fois fini, le Finder le montre (la fenêtre n'a pas
/// de barre de téléchargements).
fn telechargement(app: &AppHandle, evenement: DownloadEvent<'_>) -> bool {
    let coque = app.state::<Coque>();
    match evenement {
        DownloadEvent::Requested { url, destination } => {
            // Le nom vient de la page ; le dossier, jamais : Téléchargements (celui de la recette, en recette).
            let dossier = coque.dossier_recette.clone().or_else(|| app.path().download_dir().ok());
            let (Some(dossier), Some(nom)) = (dossier, destination.file_name().map(|n| n.to_os_string())) else { return false };
            *destination = dossier.join(nom);
            coque.telechargements.lock().unwrap().insert(url.to_string(), destination.clone());
            coque.noter(json!({ "telechargement": url.as_str(), "vers": destination }));
        }
        DownloadEvent::Finished { url, success, .. } => {
            let vers = coque.telechargements.lock().unwrap().remove(url.as_str());
            coque.noter(json!({ "telecharge": url.as_str(), "ok": success, "vers": vers }));
            if let (true, Some(fichier), false) = (success, vers, coque.recette) {
                let _ = tauri_plugin_opener::reveal_item_in_dir(fichier);
            }
        }
        _ => {}
    }
    true
}

fn page_chargee(app: &AppHandle, window: &WebviewWindow, url: &Url) {
    let coque = app.state::<Coque>();
    // Ni l'écran de démarrage, ni Pécule : la fenêtre principale n'a rien à faire là (une adresse que la coque n'a
    // pas su lire, par exemple). Elle revient.
    if !est_accueil(url) && !meme_origine(app, url) && !matches!(url.scheme(), "about" | "blob" | "data") {
        let retour = coque.origine().or_else(|| coque.accueil.lock().unwrap().clone());
        if let Some(retour) = retour {
            let _ = window.navigate(retour);
        }
        return;
    }
    if est_accueil(url) {
        let _ = window.eval(format!("window.afficher && window.afficher({})", coque.statut()));
    }
    if meme_origine(app, url) {
        let zoom = *coque.zoom.lock().unwrap();
        let _ = window.set_zoom(zoom);
        let _ = window.eval(apparence::dire_zoom(zoom));
        // Le logo que la page annonce pour l'écran d'accueil est celui que la personne a choisi : c'est celui du Dock.
        let pour_icone = app.clone();
        let _ = window.eval_with_callback("(document.querySelector('link[rel=\"apple-touch-icon\"]') || {}).href || ''", move |lien| {
            // La fenêtre rend la valeur écrite en JSON.
            if let Some(logo) = serde_json::from_str::<String>(&lien).ok().and_then(|adresse| apparence::logo_de_la_page(&adresse)) {
                apparence::poser_icone(&pour_icone, logo);
            }
        });
    }
}

// ---------- Taille de l'affichage ----------

/// Toutes les fenêtres de Pécule à la taille choisie (celle de la banque garde la sienne).
fn appliquer_zoom(app: &AppHandle) {
    let zoom = *app.state::<Coque>().zoom.lock().unwrap();
    for (label, f) in app.webview_windows() {
        if label != BANQUE {
            let _ = f.set_zoom(zoom);
            if f.url().is_ok_and(|u| meme_origine(app, &u)) {
                let _ = f.eval(apparence::dire_zoom(zoom));
            }
        }
    }
}

/// Change la taille de l'affichage, et la garde pour la prochaine ouverture.
fn regler_zoom(app: &AppHandle, voulu: f64) {
    let coque = app.state::<Coque>();
    let zoom = (voulu.clamp(apparence::ZOOM_MIN, apparence::ZOOM_MAX) * 100.0).round() / 100.0;
    *coque.zoom.lock().unwrap() = zoom;
    appliquer_zoom(app);
    if let Some(dossier) = coque.dossier.lock().unwrap().clone() {
        apparence::garder_zoom(&dossier, zoom);
    }
    coque.noter(json!({ "zoom": zoom }));
}

// ---------- Menu ----------

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let coque = app.state::<Coque>();
    let t = |id: &str| coque.texte(id);
    let element = |id: &str, texte: String, raccourci: Option<&str>| {
        let mut e = MenuItemBuilder::with_id(id, texte);
        if let Some(r) = raccourci {
            e = e.accelerator(r);
        }
        e.build(app)
    };
    let a_propos = AboutMetadata { name: Some("Pécule".into()), version: Some(app.package_info().version.to_string()), website: Some(SITE.into()), ..Default::default() };
    let appli = SubmenuBuilder::new(app, "Pécule")
        .about_with_text(t("about"), Some(a_propos))
        .separator()
        .item(&element("maj", t("update"), None)?)
        .separator()
        .hide_with_text(t("hide"))
        .hide_others_with_text(t("hideOthers"))
        .show_all_with_text(t("showAll"))
        .separator()
        // « Quitter » est un élément de la coque, pas celui du système : c'est lui qui arrête la base proprement.
        .item(&element("quitter", t("quit"), Some("CmdOrCtrl+Q"))?)
        .build()?;
    let edition = SubmenuBuilder::new(app, t("edit"))
        .undo_with_text(t("undo"))
        .redo_with_text(t("redo"))
        .separator()
        .cut_with_text(t("cut"))
        .copy_with_text(t("copy"))
        .paste_with_text(t("paste"))
        .select_all_with_text(t("selectAll"))
        .build()?;
    let presentation = SubmenuBuilder::new(app, t("view"))
        .item(&element("recharger", t("reload"), Some("CmdOrCtrl+R"))?)
        .item(&element("precedente", t("back"), Some("CmdOrCtrl+["))?)
        .item(&element("suivante", t("forward"), Some("CmdOrCtrl+]"))?)
        .separator()
        .item(&element("zoom-reel", t("zoomReset"), Some("CmdOrCtrl+0"))?)
        .item(&element("zoom-plus", t("zoomIn"), Some("CmdOrCtrl+="))?)
        .item(&element("zoom-moins", t("zoomOut"), Some("CmdOrCtrl+-"))?)
        .separator()
        .fullscreen_with_text(t("fullscreen"))
        .build()?;
    let fenetres = SubmenuBuilder::new(app, t("window")).minimize_with_text(t("minimize")).close_window_with_text(t("close")).build()?;
    let aide = SubmenuBuilder::new(app, t("help"))
        .item(&element("manuel", t("manual"), None)?)
        .item(&element("oubli", t("forgot"), None)?)
        .separator()
        .item(&element("donnees", t("dataFolder"), None)?)
        .item(&element("journaux", t("logs"), None)?)
        .separator()
        .item(&element("site", t("site"), None)?)
        .build()?;
    MenuBuilder::new(app).items(&[&appli, &edition, &presentation, &fenetres, &aide]).build()
}

/// La fenêtre que la personne regarde (celle de Pécule, à défaut).
fn fenetre_active(app: &AppHandle) -> Option<WebviewWindow> {
    app.webview_windows().into_values().find(|w| w.is_focused().unwrap_or(false)).or_else(|| fenetre(app, PRINCIPALE))
}

/// Ramène la fenêtre principale sur un écran de Pécule.
fn aller(app: &AppHandle, chemin: &str) {
    let Some(origine) = app.state::<Coque>().origine() else { return };
    if let (Some(principale), Ok(url)) = (fenetre(app, PRINCIPALE), origine.join(chemin)) {
        let _ = principale.navigate(url);
        let _ = principale.show();
        let _ = principale.set_focus();
    }
}

/// « Mot de passe oublié… » : le superviseur donne un lien d'inscription, où le membre choisit un nouveau mot de
/// passe. Plusieurs membres : un menu demande lequel.
fn mot_de_passe_oublie(app: &AppHandle, membre: Option<String>) {
    let app = app.clone();
    plus_tard(move || {
        let coque = app.state::<Coque>();
        let Some(reponse) = demander(&app, json!({ "commande": "lien", "membre": membre })) else {
            // Pécule démarre encore, ou ne répond pas : on le dit, plutôt que de ne rien faire.
            coque.noter(json!({ "oubli": "sans réponse" }));
            dialogues::demander_depuis(&app, "Pécule".to_string(), coque.texte("busy"), "OK".to_string(), None);
            return;
        };
        if let Some(erreur) = reponse["erreur"].as_str() {
            coque.noter(json!({ "oubli": "erreur", "detail": erreur }));
            dialogues::demander_depuis(&app, "Pécule".to_string(), erreur.to_string(), "OK".to_string(), None);
            return;
        }
        if let Some(lien) = reponse["lien"].as_str().and_then(|l| Url::parse(l).ok()) {
            if let Some(principale) = fenetre(&app, PRINCIPALE) {
                let _ = principale.navigate(lien);
                let _ = principale.show();
                let _ = principale.set_focus();
            }
            return;
        }
        let Some(membres) = reponse["membres"].as_array().cloned() else { return };
        let pour_menu = app.clone();
        let _ = app.run_on_main_thread(move || {
            let app = pour_menu;
            let titre = app.state::<Coque>().texte("whichMember");
            let Ok(entete) = MenuItemBuilder::with_id("membre-titre", titre).enabled(false).build(&app) else { return };
            let mut choix = MenuBuilder::new(&app).item(&entete).separator();
            for nom in membres.iter().filter_map(|m| m.as_str()) {
                if let Ok(e) = MenuItemBuilder::with_id(format!("membre:{nom}"), nom).build(&app) {
                    choix = choix.item(&e);
                }
            }
            if let (Ok(choix), Some(principale)) = (choix.build(), fenetre(&app, PRINCIPALE)) {
                let _ = principale.popup_menu(&choix);
            }
        });
    });
}

pub fn action_menu(app: &AppHandle, id: &str) {
    let coque = app.state::<Coque>();
    coque.noter(json!({ "menu": id }));
    let zoomer = |plus_grand: Option<bool>| {
        let voulu = plus_grand.map_or(1.0, |sens| apparence::palier_voisin(*coque.zoom.lock().unwrap(), sens));
        regler_zoom(app, voulu);
    };
    match id {
        "quitter" => quitter(app),
        "maj" => mise_a_jour(app),
        "recharger" => {
            if let Some(w) = fenetre_active(app) {
                let _ = w.eval("window.location.reload()");
            }
        }
        "precedente" | "suivante" => {
            if let Some(w) = fenetre_active(app) {
                let _ = w.eval(if id == "precedente" { "window.history.back()" } else { "window.history.forward()" });
            }
        }
        "zoom-reel" => zoomer(None),
        "zoom-plus" => zoomer(Some(true)),
        "zoom-moins" => zoomer(Some(false)),
        "manuel" => aller(app, "/manuel"),
        "oubli" => mot_de_passe_oublie(app, None),
        "donnees" => ouvrir_dossier(app, None),
        "journaux" => ouvrir_dossier(app, Some("journaux")),
        "site" => {
            if let Ok(site) = Url::parse(SITE) {
                ouvrir_dehors(app, &site);
            }
        }
        _ => {
            if let Some(nom) = id.strip_prefix("membre:") {
                mot_de_passe_oublie(app, Some(nom.to_string()));
            }
        }
    }
}

// ---------- Mise à jour ----------

/// Dit quelque chose dans une fenêtre du système (en recette : c'est noté, personne n'est là pour la fermer).
fn annoncer(app: &AppHandle, quoi: &str, texte: String) {
    app.state::<Coque>().noter(json!({ "maj": quoi, "texte": texte }));
    dialogues::demander_depuis(app, "Pécule".to_string(), texte, "OK".to_string(), None);
}

/// « Rechercher une mise à jour… » : l'appli demande à la page des versions s'il y en a une plus récente. Si oui, et
/// si la personne le veut, elle arrête Pécule proprement, télécharge l'appli, vérifie sa signature (la clé publique
/// est dans la coque), la met à la place de celle-ci et se rouvre. Rien ne s'installe sans ce « oui ».
fn mise_a_jour(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let coque = app.state::<Coque>();
        let trouve = match app.updater() {
            Ok(m) => m.check().await,
            Err(e) => Err(e),
        };
        let nouvelle = match trouve {
            Ok(Some(n)) => n,
            Ok(None) => return annoncer(&app, "a-jour", format!("{} ({})", coque.texte("upToDate"), app.package_info().version)),
            Err(e) => {
                coque.noter(json!({ "maj": "erreur", "detail": e.to_string() }));
                return annoncer(&app, "injoignable", coque.texte("updateUnreachable"));
            }
        };
        // Une version trop ancienne ne passe pas d'un coup à la dernière : celle-ci dit depuis laquelle on y vient.
        let palier = nouvelle.raw_json.get("depuis").and_then(|d| d.as_str()).and_then(|d| semver::Version::parse(d).ok());
        if let (Some(palier), Ok(ici)) = (palier, semver::Version::parse(&nouvelle.current_version)) {
            if ici < palier {
                return annoncer(&app, "palier", coque.texte("updateStep").replace("{version}", &nouvelle.version).replace("{palier}", &palier.to_string()));
            }
        }
        let annonce = coque.texte("updateAvailable").replace("{version}", &nouvelle.version);
        coque.noter(json!({ "maj": "disponible", "version": nouvelle.version }));
        let accepte = dialogues::demander_depuis(&app, annonce, coque.texte("updateAsk"), coque.texte("updateInstall"), Some(coque.texte("updateLater")));
        if !accepte {
            return;
        }
        // La base s'arrête avant que l'appli ne soit remplacée : la nouvelle la retrouvera fermée proprement.
        arreter_superviseur(&app);
        dire(&app, &coque.texte("updating"), None, false);
        montrer_demarrage(&app);
        match nouvelle.download_and_install(|_, _| {}, || {}).await {
            Ok(()) => {
                coque.noter(json!({ "maj": "installee", "version": nouvelle.version }));
                app.restart();
            }
            Err(e) => {
                coque.noter(json!({ "maj": "echec", "detail": e.to_string() }));
                // L'appli en place n'a pas été touchée : elle reprend.
                coque.quitte.store(false, Ordering::SeqCst);
                lancer_superviseur(&app);
                annoncer(&app, "echec", coque.texte("updateFailed"));
            }
        }
    });
}

/// Quitter : les fenêtres disparaissent tout de suite, la base est arrêtée proprement, puis l'appli s'en va.
pub fn quitter(app: &AppHandle) {
    for w in app.webview_windows().into_values() {
        let _ = w.hide();
    }
    let app = app.clone();
    plus_tard(move || {
        arreter_superviseur(&app);
        app.exit(0);
    });
}

// ---------- Lancement ----------

fn creer_fenetre(app: &AppHandle) -> tauri::Result<()> {
    let (a, b, c, d, e) = (app.clone(), app.clone(), app.clone(), app.clone(), app.clone());
    let mut constructeur = WebviewWindowBuilder::new(app, PRINCIPALE, WebviewUrl::App("index.html".into()));
    // En recette, la fenêtre garde ses témoins et ses réglages à part : ceux de la vraie appli ne sont ni lus ni touchés.
    if app.state::<Coque>().recette {
        constructeur = constructeur.data_store_identifier(MAGASIN_RECETTE);
    }
    let principale = constructeur
        .title("Pécule")
        .inner_size(1280.0, 860.0)
        .min_inner_size(380.0, 560.0)
        .on_navigation(move |url| naviguer_principale(&a, url))
        .on_new_window(move |url, _| {
            nouvelle_fenetre(&b, url);
            NewWindowResponse::Deny
        })
        .on_download(move |_, evenement| telechargement(&c, evenement))
        // Le micro, pour le mode vocal de Pécule, et pour lui seul : ni caméra, ni position, ni rien pour une autre page.
        .on_permission_request(move |webview, quoi| {
            let chez_nous = webview.url().is_ok_and(|u| meme_origine(&e, &u));
            if chez_nous && matches!(quoi, PermissionKind::Microphone) {
                PermissionResponse::Allow
            } else {
                PermissionResponse::Deny
            }
        })
        .on_page_load(move |window, charge| {
            if charge.event() == PageLoadEvent::Finished {
                page_chargee(&d, &window, charge.url());
            }
        })
        .build()?;
    dialogues::pour_les_pages(&principale);
    if app.state::<Coque>().recette {
        recette::fenetres_sans_geste(&principale);
    }
    *app.state::<Coque>().accueil.lock().unwrap() = principale.url().ok().filter(est_accueil);
    Ok(())
}

fn main() {
    let (langue, textes) = charger_textes();
    let recette = option("--recette");
    let pour_recette = recette.clone();

    // Pas d'« instance unique » par un socket du dossier temporaire, que tout compte de la machine peut prendre :
    // macOS ramène de lui-même l'appli déjà ouverte, et un second lancement à la main trouve le superviseur du
    // premier (« déjà en marche ») et se branche sur lui, sans rien lancer.
    let constructeur = tauri::Builder::default();
    let application = constructeur
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, evenement| action_menu(app, evenement.id().as_ref()))
        .on_window_event(|window, evenement| {
            // Fermer la fenêtre de Pécule ne quitte pas : elle se cache, et le Dock la ramène. La base tourne toujours.
            if let (PRINCIPALE, WindowEvent::CloseRequested { api, .. }) = (window.label(), evenement) {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .setup(move |app| {
            // Les ressources de l'appli. Tauri refuse de les situer quand le chemin de l'appli passe par un lien
            // (un dossier temporaire, un disque monté ailleurs) : on les prend alors à côté du binaire, chemin résolu.
            let ressources = app
                .path()
                .resource_dir()
                .ok()
                .or_else(|| std::env::current_exe().ok()?.canonicalize().ok()?.parent()?.parent().map(|contenu| contenu.join("Resources")))
                .unwrap_or_default();
            let chemin = |variable: &str, defaut: PathBuf| std::env::var_os(variable).map(PathBuf::from).unwrap_or(defaut);
            app.manage(Coque {
                textes,
                langue,
                node: chemin("PECULE_COQUE_NODE", ressources.join("node").join("bin").join("node")),
                mysql: chemin("PECULE_COQUE_MYSQL", ressources.join("mysql")),
                pecule: chemin("PECULE_COQUE_PECULE", ressources.join("appli")),
                donnees: option("--donnees").map(PathBuf::from),
                recette: pour_recette.is_some(),
                dossier_recette: pour_recette.as_ref().and_then(|s| PathBuf::from(s).parent().map(PathBuf::from)),
                superviseur: Mutex::new(None),
                origine: Mutex::new(None),
                dossier: Mutex::new(None),
                accueil: Mutex::new(None),
                statut: Mutex::new(json!({})),
                attentes: Mutex::new(HashMap::new()),
                numero: AtomicU64::new(0),
                zoom: Mutex::new(1.0),
                icone: Mutex::new(String::new()),
                quitte: AtomicBool::new(false),
                adopte: AtomicBool::new(false),
                journal: Mutex::new(Vec::new()),
                telechargements: Mutex::new(HashMap::new()),
            });
            let app = app.handle().clone();
            dialogues::preparer(&app);
            app.set_menu(menu(&app)?)?;
            creer_fenetre(&app)?;
            if let Some(socket) = &pour_recette {
                recette::ecouter(&app, PathBuf::from(socket));
            }
            lancer_superviseur(&app);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("la coque de Pécule n'a pas pu se lancer");

    application.run(|app, evenement| match evenement {
        // Le Dock : la fenêtre cachée revient.
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            if let Some(principale) = fenetre(app, PRINCIPALE) {
                let _ = principale.show();
                let _ = principale.set_focus();
            }
        }
        // Tous les chemins de sortie passent ici (menu, Dock, extinction du Mac) : rien ne reste derrière l'appli.
        RunEvent::Exit => arreter_superviseur(app),
        _ => {}
    });
}
