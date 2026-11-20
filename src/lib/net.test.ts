import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./net.ts";

describe("adresses privées", () => {
  it("reconnaît la boucle locale, les réseaux privés et le lien local", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("laisse passer les adresses publiques", () => {
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("lit l'IPv4 qu'une IPv6 porte, quelle que soit son écriture", () => {
    // La même boucle locale ou le même réseau privé, écrits en groupes hexadécimaux : c'est ce que rend un analyseur d'adresses.
    for (const ip of ["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:a00:5", "::ffff:c0a8:101", "::7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:1::1", "2001:db8::1", "fec0::1", "ff02::1", "fe80::1%en0"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["::ffff:808:808", "0:0:0:0:0:ffff:5db8:d822", "2a00:1450:4007:80e::200e", "2001:4860:4860::8888"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuse ce qui n'est pas une adresse", () => {
    for (const ip of ["exemple", "", "1.2.3", "256.1.1.1", "::ffff:999.1.1.1", "1::2::3", "12345::1", "g::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
});
