/*
 * Référentiel des marques (banques, plateformes crypto, marchands, créanciers) : nom, domaine
 * officiel (d'où vient le logo, téléchargé une fois par le serveur puis servi par /api/logos) et
 * motif reconnu dans le nom du marchand ou le libellé bancaire (minuscules, sans accents).
 * Un libellé qui ne correspond à aucune marque garde l'icône de son poste.
 */

export type Brand = { domain: string; name: string; match: RegExp };

const b = (domain: string, name: string, match: RegExp): Brand => ({ domain, name, match });

export const BRANDS: Brand[] = [
  // Banques et organismes de crédit
  b("boursobank.com", "BoursoBank", /\bbourso(bank|rama)?\b/),
  b("caisse-epargne.fr", "Caisse d'Épargne", /caisse d.?epargne|\bcaisse epargne\b|\bcerhone/),
  b("credit-agricole.fr", "Crédit Agricole", /credit agricole|\bca centre.?est\b|\bcrca\b/),
  b("banquepopulaire.fr", "Banque Populaire", /banque populaire|\bbpaura\b|\bbp aura\b/),
  b("actionlogement.fr", "Action Logement", /action logement/),
  b("lydia-app.com", "Lydia", /\blydia\b/),
  b("paypal.com", "PayPal", /\bpaypal\b/),
  b("wise.com", "Wise", /\bwise\b|transferwise/),
  b("revolut.com", "Revolut", /\brevolut\b/),
  b("lemonway.com", "Lemonway", /\blemonway\b/),
  // Crypto
  b("binance.com", "Binance", /\bbinance\b/),
  b("kraken.com", "Kraken", /\bkraken\b/),
  b("crypto.com", "Crypto.com", /crypto\.?com/),
  b("coinbase.com", "Coinbase", /\bcoinbase\b/),
  b("bitfinex.com", "Bitfinex", /\bbitfinex\b/),
  b("kiln.fi", "Kiln", /\bkiln\b/),
  b("xportal.com", "xPortal", /\bxportal\b/),
  b("multiversx.com", "MultiversX", /multiversx|\belrond\b|\begld\b/),
  b("ledger.com", "Ledger", /\bledger\b/),
  b("coinstats.app", "CoinStats", /\bcoinstats\b/),
  b("metamask.io", "MetaMask", /\bmetamask\b/),
  // Services que Pécule relie (Réglages → Comptes et connexions)
  b("enablebanking.com", "Enable Banking", /enable ?banking/),
  b("finta.io", "Finta", /\bfinta\b/),
  b("coingecko.com", "CoinGecko", /\bcoingecko\b/),
  // Achats en ligne
  b("amazon.fr", "Amazon", /\bamazon\b|\bamzn\b|\bwww amazon\b/),
  b("cdiscount.com", "Cdiscount", /\bcdiscount\b/),
  b("aliexpress.com", "AliExpress", /\baliexpress/),
  b("fnac.com", "Fnac", /\bfnac\b/),
  b("darty.com", "Darty", /\bdarty\b/),
  b("boulanger.com", "Boulanger", /\bboulanger\b(?! de)/),
  b("backmarket.fr", "Back Market", /back ?market/),
  b("vinted.fr", "Vinted", /\bvinted\b/),
  b("leboncoin.fr", "leboncoin", /leboncoin|le bon coin/),
  b("temu.com", "Temu", /\btemu\b/),
  b("shein.com", "Shein", /\bshein\b/),
  b("hema.fr", "HEMA", /\bhema\b/),
  b("ikea.com", "IKEA", /\bikea\b/),
  b("leroymerlin.fr", "Leroy Merlin", /leroy merlin|\badeo\b/),
  b("castorama.fr", "Castorama", /\bcastorama\b/),
  b("bricodepot.fr", "Brico Dépôt", /brico ?depot/),
  b("decathlon.fr", "Decathlon", /\bdecathlon\b/),
  b("action.com", "Action", /^action\b(?! logement)/),
  b("zara.com", "Zara", /\bzara\b/),
  b("hm.com", "H&M", /\bh ?& ?m\b|\bh et m\b/),
  b("uniqlo.com", "Uniqlo", /\buniqlo\b/),
  b("kiabi.com", "Kiabi", /\bkiabi\b/),
  b("sephora.fr", "Sephora", /\bsephora\b/),
  b("nocibe.fr", "Nocibé", /\bnocibe\b/),
  b("yves-rocher.fr", "Yves Rocher", /yves rocher/),
  b("cultura.com", "Cultura", /\bcultura\b/),
  b("youtube.com", "YouTube", /\byou ?tube\b/),
  b("apple.com", "Apple", /\bapple\b|\bitunes\b/),
  b("google.com", "Google", /\bgoogle\b(?! workspace)/),
  b("google.com", "Google Workspace", /google workspace|\bgsuite\b/),
  b("microsoft.com", "Microsoft", /\bmicrosoft\b|\bmsft\b/),
  // Alimentation, cafés, restauration
  b("nespresso.com", "Nespresso", /\bnespresso\b/),
  b("maxicoffee.com", "MaxiCoffee", /maxi ?coffee/),
  b("carrefour.fr", "Carrefour", /\bcarrefour\b/),
  b("e.leclerc", "E.Leclerc", /\bleclerc\b/),
  b("auchan.fr", "Auchan", /\bauchan\b/),
  b("intermarche.com", "Intermarché", /\bintermarche\b|\bitm\b/),
  b("lidl.fr", "Lidl", /\blidl\b/),
  b("aldi.fr", "Aldi", /\baldi\b/),
  b("monoprix.fr", "Monoprix", /\bmonoprix\b/),
  b("franprix.fr", "Franprix", /\bfranprix\b/),
  b("picard.fr", "Picard", /\bpicard\b/),
  b("grandfrais.com", "Grand Frais", /grand frais/),
  b("biocoop.fr", "Biocoop", /\bbiocoop\b/),
  b("casino.fr", "Casino", /\bgeant casino\b|\bcasino shop\b/),
  b("deliveroo.fr", "Deliveroo", /\bdeliveroo\b/),
  b("ubereats.com", "Uber Eats", /uber ?eats/),
  b("uber.com", "Uber", /\buber\b(?! ?eats)|\bubr\b/),
  b("mcdonalds.fr", "McDonald's", /\bmc ?do(nald)?s?\b/),
  b("burgerking.fr", "Burger King", /burger king/),
  b("kfc.fr", "KFC", /\bkfc\b/),
  b("starbucks.fr", "Starbucks", /\bstarbucks\b/),
  b("paul.fr", "Paul", /^paul\b/),
  b("areas.com", "Areas", /\bareas\b/),
  // Transports, énergie, télécoms
  b("tcl.fr", "TCL", /\btcl\b/),
  b("velov.grandlyon.com", "Vélo'v", /\bvelov\b|\bvelo v\b/),
  b("sncf-connect.com", "SNCF", /\bsncf\b|\boui ?sncf\b/),
  b("blablacar.fr", "BlaBlaCar", /blablacar/),
  b("aprr.fr", "APRR", /\baprr\b|\bautoroute\b/),
  b("vinci-autoroutes.com", "Vinci Autoroutes", /vinci autoroutes|\basf\b/),
  b("totalenergies.fr", "TotalEnergies", /\btotal ?energies\b|\btotal\b(?! ?\d)/),
  b("shell.fr", "Shell", /\bshell\b/),
  b("esso.fr", "Esso", /\besso\b/),
  b("ionity.eu", "Ionity", /\bionity\b/),
  b("tesla.com", "Tesla", /\btesla\b/),
  b("free.fr", "Free", /\bfree\b|\bfree mobile\b|\bfreebox\b/),
  b("orange.fr", "Orange", /\borange\b/),
  b("sfr.fr", "SFR", /\bsfr\b/),
  b("bouyguestelecom.fr", "Bouygues Telecom", /bouygues/),
  b("edf.fr", "EDF", /\bedf\b/),
  b("engie.fr", "Engie", /\bengie\b/),
  b("enedis.fr", "Enedis", /\benedis\b/),
  b("saur.com", "Saur", /\bsaur\b/),
  b("eaudugrandlyon.com", "Eau du Grand Lyon", /eau du grand lyon/),
  b("laposte.fr", "La Poste", /\bla ?poste\b/),
  b("mondialrelay.fr", "Mondial Relay", /mondial relay/),
  b("chronopost.fr", "Chronopost", /\bchronopost\b/),
  // Assurances, santé, administration
  b("axa.fr", "AXA", /\baxa\b/),
  b("ornikar.com", "Ornikar", /\bornikar\b|\bornicar\b/),
  b("lolivier.fr", "L'Olivier", /l.?olivier assurance|\blolivier\b/),
  b("mma.fr", "MMA", /\bmma\b/),
  b("gan.fr", "Gan", /\bgan\b/),
  b("maif.fr", "MAIF", /\bmaif\b/),
  b("macif.fr", "Macif", /\bmacif\b/),
  b("allianz.fr", "Allianz", /\ballianz\b/),
  b("kereis.com", "Kereis", /\bkereis\b/),
  b("henner.com", "Henner", /\bhenner\b/),
  b("doctolib.fr", "Doctolib", /\bdoctolib\b/),
  b("ameli.fr", "Assurance Maladie", /\bcpam\b|\bameli\b/),
  b("impots.gouv.fr", "DGFiP", /\bdgfip\b|\bimpots? ?gouv\b|\bdirection generale des finances\b/),
  b("caf.fr", "CAF", /\bcaf\b/),
  b("lpcr.fr", "LPCR", /\blpcr\b/),
  // Abonnements, services
  b("netflix.com", "Netflix", /\bnetflix\b/),
  b("spotify.com", "Spotify", /\bspotify\b/),
  b("deezer.com", "Deezer", /\bdeezer\b/),
  b("disneyplus.com", "Disney+", /disney ?\+|disney ?plus/),
  b("canalplus.com", "Canal+", /canal ?\+|canal ?plus/),
  b("spliiit.com", "Spliiit", /\bspli+t\b/),
  b("hostinger.com", "Hostinger", /\bhostinger\b/),
  b("readdle.com", "Spark", /^spark\b|\breaddle\b/),
  b("coursera.org", "Coursera", /\bcoursera\b/),
  b("notion.so", "Notion", /\bnotion\b/),
  b("ovhcloud.com", "OVHcloud", /\bovh\b/),
  b("lepotcommun.fr", "Le Pot Commun", /le pot commun/),
  b("booking.com", "Booking.com", /\bbooking\b/),
  b("airbnb.fr", "Airbnb", /\bairbnb\b/),
  b("ryanair.com", "Ryanair", /\bryanair\b/),
  b("easyjet.com", "easyJet", /\beasy ?jet\b/),
  b("airfrance.fr", "Air France", /air france/),
  b("transavia.com", "Transavia", /\btransavia\b/),
  b("cegid.com", "Cegid", /\bcegid\b/),
  b("octopus.energy", "Octopus Electroverse", /\boctopus\b|electroverse/),
  b("youprice.fr", "YouPrice", /\byou ?price\b/),
  b("trainline.fr", "Trainline", /\btrainline\b/),
  b("helloasso.com", "HelloAsso", /hello ?asso/),
  b("inpi.fr", "INPI", /\binpi\b/),
  b("billetweb.fr", "Billetweb", /billetweb/),
  b("pearsonvue.com", "Pearson VUE", /\bpearson\b/),
  b("caliceo.com", "Calicéo", /\bcaliceo\b/),
  // Grands employeurs et organismes payeurs (salaires, allocations) : en fin de liste, un marchand passe d'abord.
  b("capgemini.com", "Capgemini", /\bcapgemini\b/),
  b("soprasteria.com", "Sopra Steria", /sopra ?steria/),
  b("atos.net", "Atos", /\batos\b/),
  b("accenture.com", "Accenture", /\baccenture\b/),
  b("alten.com", "Alten", /\balten\b/),
  b("cgi.com", "CGI", /\bcgi\b/),
  b("ibm.com", "IBM", /\bibm\b/),
  b("3ds.com", "Dassault Systèmes", /dassault systemes/),
  b("dassault-aviation.com", "Dassault Aviation", /\bdassault\b/),
  b("thalesgroup.com", "Thales", /\bthales\b/),
  b("airbus.com", "Airbus", /\bairbus\b/),
  b("safran-group.com", "Safran", /\bsafran\b/),
  b("naval-group.com", "Naval Group", /naval group/),
  b("renaultgroup.com", "Renault", /\brenault\b/),
  b("stellantis.com", "Stellantis", /\bstellantis\b|\bpeugeot\b|\bcitroen\b/),
  b("michelin.com", "Michelin", /\bmichelin\b/),
  b("alstom.com", "Alstom", /\balstom\b/),
  b("schneider-electric.com", "Schneider Electric", /schneider electric/),
  b("saint-gobain.com", "Saint-Gobain", /saint.?gobain/),
  b("vinci.com", "Vinci", /\bvinci\b/),
  b("eiffage.com", "Eiffage", /\beiffage\b/),
  b("veolia.com", "Veolia", /\bveolia\b/),
  b("suez.com", "Suez", /\bsuez\b/),
  b("orano.group", "Orano", /\borano\b/),
  b("loreal.com", "L'Oréal", /\bl.?oreal\b/),
  b("lvmh.com", "LVMH", /\blvmh\b/),
  b("sanofi.com", "Sanofi", /\bsanofi\b/),
  b("danone.com", "Danone", /\bdanone\b/),
  b("ubisoft.com", "Ubisoft", /\bubisoft\b/),
  b("bnpparibas.com", "BNP Paribas", /bnp ?paribas|\bbnp\b/),
  b("societegenerale.com", "Société Générale", /societe generale|\bsocgen\b/),
  b("labanquepostale.fr", "La Banque Postale", /banque postale/),
  b("creditmutuel.fr", "Crédit Mutuel", /credit mutuel/),
  b("lcl.fr", "LCL", /\blcl\b/),
  b("cic.fr", "CIC", /\bcic\b/),
  b("ratp.fr", "RATP", /\bratp\b/),
  b("kpmg.com", "KPMG", /\bkpmg\b/),
  b("deloitte.com", "Deloitte", /\bdeloitte\b/),
  b("pwc.fr", "PwC", /\bpwc\b/),
  b("manpower.fr", "Manpower", /\bmanpower\b/),
  b("adecco.fr", "Adecco", /\badecco\b/),
  b("randstad.fr", "Randstad", /\brandstad\b/),
  b("cnrs.fr", "CNRS", /\bcnrs\b/),
  b("aphp.fr", "AP-HP", /\bap.?hp\b|assistance publique/),
  b("francetravail.fr", "France Travail", /france travail|pole emploi/),
  b("urssaf.fr", "Urssaf", /\burssaf\b/),
];

/** Texte comparable : minuscules, sans accents, ponctuation réduite à des espaces. */
export const brandText = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’'`]/g, "'")
    .replace(/[^a-z0-9.+&' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Marque reconnue dans un ou plusieurs textes (marchand, libellé, nom de compte, banque…). */
export function brandOf(...texts: (string | null | undefined)[]): Brand | null {
  for (const t of texts) {
    if (!t) continue;
    const s = brandText(t);
    const hit = BRANDS.find((x) => x.match.test(s));
    if (hit) return hit;
  }
  return null;
}

/** Domaines dont le serveur accepte de chercher le logo (liste fermée : pas d'appel vers un domaine arbitraire). */
export const BRAND_DOMAINS = new Set(BRANDS.map((x) => x.domain));
