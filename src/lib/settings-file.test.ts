import { describe, expect, it } from "vitest";
import { composeDatabaseUrls, DATABASE_SECRETS, demoInitSql, formatSettings, KEPT_ADDRESS, mergeSettings, MIN_LENGTH, parseSettings, passwordFromUrl, recoverDatabasePasswords, refusals, SECRET_NAMES, SECRETS, SERVER_SECRETS, settleSecrets, setupCodeFromHash, setupLink } from "./settings-file.ts";

/** Tirage prévisible : la longueur demandée se lit dans la valeur. */
const draw = (bytes: number) => `tire-${bytes}`;

describe("fichier de réglages", () => {
  it("lit « CLÉ=valeur », sans les commentaires ni les guillemets", () => {
    const text = ["# en-tête", "APP_URL=https://pecule.exemple.fr", "  API_TOKEN = abc  ", 'SECRET_KEY="entre guillemets"', "VIDE=", "#COMMENTEE=non", "pas une ligne", "DB_PASSWORD='a=b'"].join("\r\n");
    expect(parseSettings(text)).toEqual({ APP_URL: "https://pecule.exemple.fr", API_TOKEN: "abc", SECRET_KEY: "entre guillemets", VIDE: "", DB_PASSWORD: "a=b" });
  });

  it("un commentaire en fin de ligne n'entre pas dans une valeur sans guillemets", () => {
    const text = ["TRUST_PROXY=0 # Pécule est joint directement", 'VAPID_CONTACT="alex # pas un commentaire"', "URL=https://pecule.exemple.fr/#ancre", "SEUL=#"].join("\n");
    expect(parseSettings(text)).toEqual({ TRUST_PROXY: "0", VAPID_CONTACT: "alex # pas un commentaire", URL: "https://pecule.exemple.fr/#ancre", SEUL: "#" });
  });

  it("relit ce qu'il a écrit, sans les valeurs vides", () => {
    const values = { API_TOKEN: "abc", SETUP_CODE: "", DATABASE_URL: "mysql://pecule:mdp@base:3306/pecule" };
    const text = formatSettings(values, "Réglages gardés");
    expect(text.startsWith("# Réglages gardés\n")).toBe(true);
    expect(text.endsWith("\n")).toBe(true);
    expect(parseSettings(text)).toEqual({ API_TOKEN: "abc", DATABASE_URL: "mysql://pecule:mdp@base:3306/pecule" });
  });
});

describe("secrets d'une installation", () => {
  it("installation neuve : tout est tiré, à la longueur prévue", () => {
    const s = settleSecrets({}, {}, draw);
    expect(s.drawn).toEqual(SECRET_NAMES);
    expect(s.given).toEqual([]);
    for (const name of SECRET_NAMES) expect(s.values[name]).toBe(`tire-${SECRETS[name]}`);
  });

  it("second passage : ce qui est gardé ne change plus", () => {
    const first = settleSecrets({}, {}, draw).values as Record<string, string>;
    const again = settleSecrets({}, first, () => "autre tirage");
    expect(again.drawn).toEqual([]);
    expect(again.values).toEqual(first);
  });

  it("l'environnement l'emporte sur ce qui est gardé", () => {
    const kept = settleSecrets({}, {}, draw).values as Record<string, string>;
    const s = settleSecrets({ DB_PASSWORD: "celui du fichier .env", API_TOKEN: "  jeton choisi  " }, kept, draw);
    expect(s.values.DB_PASSWORD).toBe("celui du fichier .env");
    expect(s.values.API_TOKEN).toBe("jeton choisi");
    expect(s.given).toEqual(["API_TOKEN", "DB_PASSWORD"]);
    expect(s.values.SYNC_TOKEN).toBe(kept.SYNC_TOKEN);
    expect(s.drawn).toEqual([]);
  });

  it("une variable vide vaut une variable absente", () => {
    const s = settleSecrets({ API_TOKEN: "", SECRET_KEY: "   " }, {}, draw);
    expect(s.drawn).toContain("API_TOKEN");
    expect(s.drawn).toContain("SECRET_KEY");
  });

  it("installation d'avant, sans SECRET_KEY ni SETUP_CODE : le jeton en tient lieu, rien n'est tiré à leur place", () => {
    const old = { API_TOKEN: "jeton-d-une-installation-d-avant", SYNC_TOKEN: "synchro", DB_PASSWORD: "base", DEMO_DB_PASSWORD: "demo", DB_ROOT_PASSWORD: "root" };
    const s = settleSecrets(old, {}, draw);
    expect(s.values.SECRET_KEY).toBeUndefined();
    expect(s.values.SETUP_CODE).toBeUndefined();
    expect(s.drawn).toEqual([]);
    expect(s.values).toEqual(old);
    // Le fichier .env retiré ensuite : le jeton gardé protège toujours des deux tirages.
    const later = settleSecrets({}, s.values as Record<string, string>, draw);
    expect(later.values).toEqual(old);
    expect(later.drawn).toEqual([]);
  });

  it("un jeton donné avec sa clé de chiffrement : les deux sont repris", () => {
    const s = settleSecrets({ API_TOKEN: "jeton", SECRET_KEY: "cle", SETUP_CODE: "code" }, {}, draw);
    expect(s.values.SECRET_KEY).toBe("cle");
    expect(s.values.SETUP_CODE).toBe("code");
    // Les mots de passe de la base, eux, se tirent toujours quand ils manquent.
    expect(s.drawn).toEqual(["SYNC_TOKEN", "DB_PASSWORD", "DEMO_DB_PASSWORD", "DB_ROOT_PASSWORD"]);
  });
});

describe("réglages qu'un démarrage ne peut pas reprendre tels quels", () => {
  const long = (letter: string) => letter.repeat(40);
  const check = (given: Record<string, string>, kept: Record<string, string>, address?: { effective: string; explicit: boolean }) => refusals(given, kept, settleSecrets(given, kept, draw), address);

  it("une installation neuve, ou un démarrage sans rien de nouveau, passe", () => {
    expect(check({}, {})).toEqual([]);
    const kept = { API_TOKEN: long("a"), SECRET_KEY: long("s"), SYNC_TOKEN: long("y"), SETUP_CODE: long("c"), [KEPT_ADDRESS]: "http://localhost:3000" };
    expect(check({}, kept, { effective: "http://localhost:3000", explicit: false })).toEqual([]);
    // Un fichier .env complet d'une installation d'avant, repris au premier passage.
    expect(check({ API_TOKEN: long("a"), SYNC_TOKEN: long("y"), DB_PASSWORD: "court-mais-libre" }, {}, { effective: "https://pecule.exemple.fr", explicit: true })).toEqual([]);
  });

  it("un secret trop court pour le serveur vient sans doute d'un autre projet", () => {
    expect(check({ API_TOKEN: "jeton-d-ailleurs" }, {})).toEqual([{ reason: "court", name: "API_TOKEN", min: MIN_LENGTH.API_TOKEN }]);
    expect(check({ SECRET_KEY: "x".repeat(31), SETUP_CODE: "x".repeat(15) }, {}).map((r) => r.reason === "court" && r.name)).toEqual(["SECRET_KEY", "SETUP_CODE"]);
    // Les mots de passe de la base n'ont pas de longueur imposée.
    expect(check({ DB_PASSWORD: "abc" }, {})).toEqual([]);
  });

  it("ce qui chiffre les clés gardées en base ne change jamais en silence", () => {
    const kept = { API_TOKEN: long("a"), SECRET_KEY: long("s") };
    expect(check({ SECRET_KEY: long("z") }, kept)).toEqual([{ reason: "chiffrement" }]);
    // Le jeton d'administration, lui, peut changer : la clé de chiffrement est à part.
    expect(check({ API_TOKEN: long("b") }, kept)).toEqual([]);
    // Installation d'avant, qui chiffre avec son jeton : changer le jeton, ou ajouter une autre clé, casserait tout.
    const old = { API_TOKEN: long("a") };
    expect(check({ API_TOKEN: long("b") }, old)).toEqual([{ reason: "chiffrement" }]);
    expect(check({ SECRET_KEY: long("z") }, old)).toEqual([{ reason: "chiffrement" }]);
    // Le passage prévu : l'ancien jeton devient la clé de chiffrement, le jeton peut alors changer.
    expect(check({ SECRET_KEY: long("a"), API_TOKEN: long("b") }, old)).toEqual([]);
  });

  it("l'adresse ne change pas parce que le fichier .env manque", () => {
    const kept = { API_TOKEN: long("a"), SECRET_KEY: long("s"), [KEPT_ADDRESS]: "https://pecule.exemple.fr" };
    // Lancé d'un dossier neuf : compose.yaml ne donnerait que l'adresse d'origine.
    expect(check({}, kept, { effective: "http://localhost:3000", explicit: false })).toEqual([{ reason: "adresse", from: "https://pecule.exemple.fr", to: "http://localhost:3000" }]);
    // Un changement demandé (APP_URL ou PECULE_PORT donnés) est un changement voulu.
    expect(check({}, kept, { effective: "https://finances.exemple.fr", explicit: true })).toEqual([]);
    expect(check({}, kept, { effective: "https://pecule.exemple.fr/", explicit: false })).toEqual([]);
    // Sans adresse connue (image lancée autrement que par compose.yaml), rien à comparer.
    expect(check({}, kept)).toEqual([]);
  });
});

describe("base déjà créée", () => {
  const long = (letter: string) => letter.repeat(40);
  const check = (given: Record<string, string>, kept: Record<string, string>, databaseExists: boolean) => refusals(given, kept, settleSecrets(given, kept, draw), undefined, databaseExists);

  it("sans rien qui donne son mot de passe, aucun secret n'est tiré", () => {
    // Lancé d'un dossier qui n'a pas le .env d'une installation d'avant, ou réglages gardés perdus.
    expect(check({}, {}, true)).toEqual([{ reason: "base" }]);
    expect(check({ API_TOKEN: long("a") }, {}, true)).toEqual([{ reason: "base" }]);
    // Une installation neuve : la base n'existe pas encore, tout se tire.
    expect(check({}, {}, false)).toEqual([]);
  });

  it("avec son mot de passe, donné ou gardé, tout passe", () => {
    expect(check({ DB_PASSWORD: "celui du fichier .env", API_TOKEN: long("a"), SYNC_TOKEN: long("y") }, {}, true)).toEqual([]);
    expect(check({}, { DB_PASSWORD: "gardé", API_TOKEN: long("a"), SECRET_KEY: long("s") }, true)).toEqual([]);
  });

  it("un mot de passe qui n'est plus gardé à part se retrouve dans l'adresse de la base", () => {
    expect(passwordFromUrl("mysql://pecule:abc123@base:3306/pecule")).toBe("abc123");
    expect(passwordFromUrl(composeDatabaseUrls({ DB_PASSWORD: "p@ss/w:rd#1", DEMO_DB_PASSWORD: "x" }).DATABASE_URL)).toBe("p@ss/w:rd#1");
    for (const url of [undefined, "", "pas une adresse", "mysql://pecule@base/pecule"]) expect(passwordFromUrl(url)).toBeNull();
    const urls = composeDatabaseUrls({ DB_PASSWORD: "de-la-base", DEMO_DB_PASSWORD: "de-la-demo" });
    const kept = { API_TOKEN: long("a"), SECRET_KEY: long("s"), ...urls };
    expect(recoverDatabasePasswords(kept)).toMatchObject({ DB_PASSWORD: "de-la-base", DEMO_DB_PASSWORD: "de-la-demo" });
    // Ce qui est gardé à part l'emporte ; rien n'est inventé sans adresse.
    expect(recoverDatabasePasswords({ ...kept, DB_PASSWORD: "à part" }).DB_PASSWORD).toBe("à part");
    expect(recoverDatabasePasswords({ API_TOKEN: long("a") })).toEqual({ API_TOKEN: long("a") });
    // Le volume de la base perdu, la base toujours là : rien n'est refusé, et le mot de passe de la base n'est pas tiré.
    const settled = settleSecrets({}, recoverDatabasePasswords(kept), draw);
    expect(settled.values.DB_PASSWORD).toBe("de-la-base");
    expect(settled.drawn).toEqual(["SYNC_TOKEN", "DB_ROOT_PASSWORD"].filter((n) => !(n in kept)));
    expect(refusals({}, recoverDatabasePasswords(kept), settled, undefined, true)).toEqual([]);
  });
});

describe("ce que reçoit le serveur", () => {
  it("ses secrets, jamais les mots de passe du conteneur de la base", () => {
    expect(SERVER_SECRETS).toEqual(["API_TOKEN", "SETUP_CODE", "SYNC_TOKEN", "SECRET_KEY"]);
    expect(Object.keys(DATABASE_SECRETS).sort()).toEqual(["DB_PASSWORD", "DB_ROOT_PASSWORD", "DEMO_DB_PASSWORD"]);
    // Tout secret est rangé d'un côté ou de l'autre.
    expect([...SERVER_SECRETS, ...Object.keys(DATABASE_SECRETS)].sort()).toEqual([...SECRET_NAMES].sort());
    // Des fichiers cachés : MariaDB ne joue, à la création de sa base, que ce qui porte une extension connue.
    for (const file of Object.values(DATABASE_SECRETS)) expect(file).toMatch(/^\.[a-z-]+$/);
  });
});

describe("réglages gardés et environnement", () => {
  it("complète ce qui manque, sans jamais remplacer ce qui est donné", () => {
    const env: Record<string, string | undefined> = { API_TOKEN: "de l'environnement", SECRET_KEY: "", AI_STT_DEPLOYMENT: "" };
    const added = mergeSettings(env, { API_TOKEN: "gardé", SECRET_KEY: "gardée", SYNC_TOKEN: "gardé aussi", VIDE: "" });
    expect(env).toEqual({ API_TOKEN: "de l'environnement", SECRET_KEY: "gardée", SYNC_TOKEN: "gardé aussi", AI_STT_DEPLOYMENT: "" });
    expect(added).toEqual(["SECRET_KEY", "SYNC_TOKEN"]);
  });
});

describe("base du conteneur", () => {
  it("adresses des deux bases, mot de passe protégé", () => {
    expect(composeDatabaseUrls({ DB_PASSWORD: "abc123", DEMO_DB_PASSWORD: "def456" })).toEqual({
      DATABASE_URL: "mysql://pecule:abc123@base:3306/pecule",
      DEMO_DATABASE_URL: "mysql://pecule_demo:def456@base:3306/pecule_demo",
    });
    const odd = composeDatabaseUrls({ DB_PASSWORD: "p@ss/w:rd#1", DEMO_DB_PASSWORD: "x" }).DATABASE_URL;
    const parsed = new URL(odd);
    expect(decodeURIComponent(parsed.password)).toBe("p@ss/w:rd#1");
    expect(parsed.hostname).toBe("base");
    expect(parsed.pathname).toBe("/pecule");
  });

  it("base de la démo : un utilisateur à part, mot de passe échappé", () => {
    const sql = demoInitSql("abc123");
    expect(sql).toContain("CREATE DATABASE IF NOT EXISTS pecule_demo");
    expect(sql).toContain("CREATE USER IF NOT EXISTS 'pecule_demo'@'%' IDENTIFIED BY 'abc123';");
    expect(sql).toContain("GRANT ALL PRIVILEGES ON pecule_demo.* TO 'pecule_demo'@'%';");
    // Rien sur la vraie base.
    expect(sql).not.toMatch(/ON pecule\.\*/);
    expect(demoInitSql("l'apos\\trophe")).toContain("IDENTIFIED BY 'l''apos\\\\trophe';");
  });
});

describe("lien du premier démarrage", () => {
  it("porte le code dans le fragment, que le navigateur n'envoie pas", () => {
    expect(setupLink("http://localhost:3000", "abc123")).toBe("http://localhost:3000/#code=abc123");
    expect(setupLink("https://pecule.exemple.fr/", "a b&c")).toBe("https://pecule.exemple.fr/#code=a%20b%26c");
    const link = new URL(setupLink("https://pecule.exemple.fr", "abc123"));
    expect(link.search).toBe("");
    expect(link.pathname).toBe("/");
  });

  it("le code se relit depuis le fragment", () => {
    expect(setupCodeFromHash(new URL(setupLink("https://pecule.exemple.fr", "a b&c")).hash)).toBe("a b&c");
    expect(setupCodeFromHash("#code=abc123")).toBe("abc123");
    expect(setupCodeFromHash("code=abc123")).toBe("abc123");
    expect(setupCodeFromHash("#autre=1&code=abc123&suite=2")).toBe("abc123");
    for (const hash of ["", "#", "#section", "#code=", "#codex=abc", "#code=%E0%A4%A"]) expect(setupCodeFromHash(hash)).toBeNull();
  });
});
