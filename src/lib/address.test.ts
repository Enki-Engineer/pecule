import { describe, expect, it } from "vitest";
import { addressInfo as forScripts } from "../../scripts/lib/adresse.mjs";
import { addressInfo, isLoopbackHost } from "./address.ts";

const CASES: [url: string, kind: string | null, passkeys: boolean][] = [
  ["https://pecule.exemple.fr", "https", true],
  ["https://pecule.exemple.fr:8443/", "https", true],
  // Une adresse IP en https : servie, mais aucun navigateur n'y crée de clé d'accès.
  ["https://192.168.1.20", "https", false],
  ["https://[fd00::1]", "https", false],
  ["http://localhost:3000", "local", true],
  ["http://pecule.localhost:3000", "local", true],
  ["http://127.0.0.1:3000", "local", false],
  ["http://[::1]:3000", "local", false],
  ["http://192.168.1.20:3000", "reseau", false],
  ["http://10.0.0.5:3000", "reseau", false],
  ["http://172.20.0.2:3000", "reseau", false],
  ["http://100.101.102.103:3000", "reseau", false],
  ["http://169.254.10.10:3000", "reseau", false],
  ["http://[fd12:3456::1]:3000", "reseau", false],
  ["http://[fe80::1]:3000", "reseau", false],
  ["http://nas:3000", "reseau", false],
  ["http://raspberrypi.local:3000", "reseau", false],
  ["http://serveur.home.arpa:3000", "reseau", false],
  ["http://NAS.LAN:3000", "reseau", false],
  // En http sur une adresse publique : refusée.
  ["http://pecule.exemple.fr", "public", false],
  ["http://8.8.8.8:3000", "public", false],
  ["http://172.32.0.1:3000", "public", false],
  ["http://[2001:db8::1]:3000", "public", false],
  ["ftp://pecule.exemple.fr", null, false],
  ["pas une adresse", null, false],
];

describe("addressInfo", () => {
  it.each(CASES)("%s", (url, kind, passkeys) => {
    const info = addressInfo(url);
    expect(info?.kind ?? null).toBe(kind);
    if (info) expect(info.passkeys).toBe(passkeys);
  });

  it("dit si le nom d'hôte est une adresse IP", () => {
    expect(addressInfo("http://192.168.1.20:3000")?.ip).toBe(true);
    expect(addressInfo("https://[fd00::1]")?.ip).toBe(true);
    expect(addressInfo("http://nas.local:3000")?.ip).toBe(false);
    expect(addressInfo("https://pecule.exemple.fr")?.ip).toBe(false);
  });

  it("donne la même réponse aux scripts de l'installation (scripts/lib/adresse.mjs)", () => {
    for (const [url] of CASES) expect(forScripts(url), url).toEqual(addressInfo(url));
  });
});

describe("nom d'hôte d'une requête", () => {
  it("reconnaît la machine elle-même, avec ou sans port", () => {
    for (const host of ["127.0.0.1", "127.0.0.1:47800", "localhost", "LOCALHOST:3000", "pecule.localhost:3000", "[::1]", "[::1]:3000", "::1", "127.1.2.3:80"]) expect(isLoopbackHost(host), host).toBe(true);
  });

  it("refuse tout autre nom, même s'il ressemble", () => {
    for (const host of [undefined, "", "pecule.exemple.fr", "127.0.0.1.exemple.fr", "localhost.exemple.fr", "exemple.fr:47800", "192.168.1.20:3000", "[::2]:3000", "0.0.0.0", "1127.0.0.1"]) expect(isLoopbackHost(host), String(host)).toBe(false);
  });
});

