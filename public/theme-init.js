// Apparence avant le premier rendu (pas de flash) : clair / sombre (« auto » suit le système),
// couleur d'accent choisie, thème de l'année automatique (même calcul que src/lib/seasons.ts) et logo du moment.
(function () {
  var root = document.documentElement;
  try {
    var pref = localStorage.getItem("pecule.theme") || "auto";
    var dark = pref === "sombre" || (pref === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    root.dataset.theme = dark ? "dark" : "light";
    var accent = localStorage.getItem("pecule.accent");
    // « encre » est la couleur d'origine ; « indigo » est l'ancien nom de « pas de choix ».
    if (accent && accent !== "encre" && accent !== "indigo") root.dataset.accent = accent;
    // Densité « compacte » (ordinateur) : marges et lignes resserrées, voir src/styles/index.css.
    if (localStorage.getItem("pecule.densite") === "compacte") root.dataset.density = "compact";
    var mode = localStorage.getItem("pecule.seasons");
    mode = mode === "off" || mode === "aucun" ? "aucun" : mode === "fetes" ? "fetes" : "tout";
    // Pays du foyer (recopié sur l'appareil par l'appli) : hors de France, pas de fête propre à la France ;
    // dans l'hémisphère sud, pas de thème de saison.
    var country = localStorage.getItem("pecule.pays") || "FR";
    var s = seasonAt(new Date(), mode, country);
    if (s) root.dataset.season = s;
    // Logo (même calcul que src/lib/logo.ts) : le coffre prend le thème du moment, sinon le fond choisi.
    // L'icône de l'écran d'accueil est celle choisie dans Réglages : l'iPhone la fige à l'installation.
    var FONDS = ["petrole","nuit","foret","sable","corail"];
    var THEMES = ["hiver", "printemps", "ete", "automne", "anniversaire", "nouvel-an", "epiphanie", "chandeleur", "saint-valentin", "saint-patrick", "paques", "14-juillet", "rentree", "halloween", "fete-lumieres", "noel"];
    var fond = localStorage.getItem("pecule.logo.fond");
    if (FONDS.indexOf(fond) < 0) fond = "sable";
    var logo = s || fond;
    root.dataset.logo = logo;
    var home = localStorage.getItem("pecule.logo.icone");
    if (THEMES.indexOf(home) < 0) home = fond;
    link("icon", "/icons/coffre/onglet-" + logo + ".svg");
    link("apple-touch-icon", "/icons/coffre/" + home + "-180.png");
    link("manifest", "/icons/coffre/" + home + ".webmanifest");
    // Recopiée dans un cookie : le serveur écrit la page avec cette icône (Safari, à l'ajout au Dock ou à l'écran
    // d'accueil, lit la page envoyée et non ce qu'un script y change). Même nom que HOME_ICON_COOKIE (src/lib/logo.ts).
    document.cookie = "pecule_icone=" + home + "; path=/; max-age=31536000; samesite=lax" + (location.protocol === "https:" ? "; secure" : "");
  } catch (e) {
    root.dataset.theme = "light";
  }

  function link(rel, href) {
    var l = document.querySelector('link[rel="' + rel + '"]');
    if (l) l.setAttribute("href", href);
  }
  function easter(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
    var g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    var l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    var month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(y, month - 1, day);
  }
  function feteAt(now) {
    var d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var m = d.getMonth() + 1, day = d.getDate();
    if ((m === 12 && day >= 27) || (m === 1 && day <= 3)) return "nouvel-an";
    if (m === 1 && day >= 4 && day <= 10) return "epiphanie";
    if ((m === 1 && day === 31) || (m === 2 && day <= 2)) return "chandeleur";
    if (m === 2 && day >= 8 && day <= 14) return "saint-valentin";
    if (m === 3 && day >= 14 && day <= 17) return "saint-patrick";
    var e = easter(d.getFullYear());
    var from = new Date(e.getFullYear(), e.getMonth(), e.getDate() - 7);
    var to = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
    if (d >= from && d <= to) return "paques";
    if (m === 7 && day >= 12 && day <= 14) return "14-juillet";
    if ((m === 8 && day >= 25) || (m === 9 && day <= 7)) return "rentree";
    if (m === 10 && day >= 24) return "halloween";
    if (m === 12 && day >= 5 && day <= 8) return "fete-lumieres";
    if (m === 12) return "noel";
    return null;
  }
  function saisonAt(now) {
    var md = (now.getMonth() + 1) * 100 + now.getDate();
    if (md >= 320 && md <= 620) return "printemps";
    if (md >= 621 && md <= 922) return "ete";
    if (md >= 923 && md <= 1130) return "automne";
    return "hiver";
  }
  // Anniversaires saisis dans Réglages (recopiés sur l'appareil par l'appli) : le jour J prime sur tout.
  function birthdayAt(now) {
    var list = [];
    try {
      list = JSON.parse(localStorage.getItem("pecule.anniversaires") || "[]");
    } catch (e) {}
    if (!Array.isArray(list)) return false;
    var y = now.getFullYear(), m = now.getMonth() + 1, d = now.getDate();
    var leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    for (var i = 0; i < list.length; i++) {
      var b = list[i] || {};
      if (b.month === m && b.day === d) return true;
      if (b.month === 2 && b.day === 29 && m === 2 && d === 28 && !leap) return true;
    }
    return false;
  }
  function seasonAt(now, mode, country) {
    if (mode === "aucun") return null;
    if (birthdayAt(now)) return "anniversaire";
    var fete = feteAt(now);
    var french = ["epiphanie", "chandeleur", "14-juillet", "rentree", "fete-lumieres"];
    // Une fête propre à la France laisse, ailleurs, la place à celle qu'elle recouvrait (Noël sous la Fête des Lumières).
    if (fete && country !== "FR" && french.indexOf(fete) >= 0) fete = now.getMonth() === 11 ? "noel" : null;
    var south = ["AU", "NZ", "BR", "ZA"].indexOf(country) >= 0;
    return fete || (mode === "tout" && !south ? saisonAt(now) : null);
  }
})();
