import { describe, expect, it } from "vitest";
import { isPrivateAddress, isLocalAddress } from "./net.ts";

describe("adresses privées", () => {
  it("reconnaît la boucle locale, les réseaux privés et le lien local", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("laisse passer les adresses publiques", () => {
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("lit l'IPv4 qu'une IPv6 porte, quelle que soit son écriture", () => {
    // La même boucle locale ou le même réseau privé, écrits en groupes hexadécimaux : c'est ce que rend un analyseur d'adresses.
    // IPv4 traduite (« ::ffff:0:a.b.c.d ») : jamais l'adresse d'un service public, quelle que soit l'IPv4 portée.
    for (const ip of ["::ffff:0:127.0.0.1", "::ffff:0:8.8.8.8", "0:0:0:0:ffff:0:a00:1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:a9fe:a9fe", "::ffff:a00:5", "::ffff:c0a8:101", "::7f00:1", "::127.0.0.1", "64:ff9b::7f00:1", "2002:7f00:1::1", "2001:0:1::1", "2001:db8::1", "fec0::1", "ff02::1", "fe80::1%en0"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["::ffff:808:808", "0:0:0:0:0:ffff:5db8:d822", "2a00:1450:4007:80e::200e", "2001:4860:4860::8888"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("juge l'IPv4 portée par une adresse traduite par le réseau (NAT64)", () => {
    // Sur un réseau sans IPv4, un site public en IPv4 a pour adresse « 64:ff9b:: » suivie de son IPv4.
    for (const ip of ["64:ff9b::808:808", "64:ff9b::8.8.8.8", "64:ff9b:0:0:0:0:5db8:d822"]) expect(isPrivateAddress(ip), ip).toBe(false);
    // La même écriture ne donne pas accès au réseau privé ni à la machine.
    for (const ip of ["64:ff9b::7f00:1", "64:ff9b::a00:5", "64:ff9b::10.0.0.5", "64:ff9b::c0a8:101", "64:ff9b::a9fe:a9fe", "64:ff9b::ac10:1", "64:ff9b::"]) expect(isPrivateAddress(ip), ip).toBe(true);
    // Préfixes propres à un réseau, ou IPv4 ailleurs qu'à la fin : on ne sait pas ce qu'ils désignent.
    for (const ip of ["64:ff9b:1::808:808", "64:ff9b:0:0:0:1:808:808", "64:ff9b:808:808::"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("refuse ce qui n'est pas une adresse", () => {
    for (const ip of ["exemple", "", "1.2.3", "256.1.1.1", "::ffff:999.1.1.1", "1::2::3", "12345::1", "g::1", "1:2:3:4:5:6:7", "1:2:3:4:5:6:7:8:9"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
});

describe("adresse de la machine ou d'un réseau local, au sens strict", () => {
  it("la boucle locale, les réseaux privés et la plage partagée des opérateurs", () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.254", "192.168.1.20", "100.64.0.5", "100.127.255.254", "::1", "fd12:3456::1", "fc00::1", "::ffff:192.168.1.20", "::ffff:c0a8:114"]) expect(isLocalAddress(ip), ip).toBe(true);
  });
  it("ni lien local (métadonnées d'un hébergeur), ni diffusion, ni plages réservées, ni adresse publique", () => {
    for (const ip of ["169.254.169.254", "fe80::1", "fd00:ec2::254", "224.0.0.251", "0.0.0.0", "192.0.78.24", "198.18.0.1", "100.128.0.1", "172.32.0.1", "8.8.8.8", "2606:4700::1111"]) expect(isLocalAddress(ip), ip).toBe(false);
  });
  it("ni une IPv6 qui porte une IPv4 autrement que sous sa forme habituelle, ni une adresse illisible", () => {
    for (const ip of ["::", "::8.8.8.8", "::ffff:8.8.8.8", "::ffff:0:c0a8:114", "2002:c0a8:114::1", "64:ff9b::c0a8:114", "2001:0:1234::1", "fe80::1%en0", "999.1.1.1", "localhost", ""]) expect(isLocalAddress(ip), ip).toBe(false);
  });
});
