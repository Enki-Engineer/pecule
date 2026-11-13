import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "./net.ts";

describe("adresses privées", () => {
  it("reconnaît la boucle locale, les réseaux privés et le lien local", () => {
    for (const ip of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd12:3456::1", "fe80::1", "::ffff:10.0.0.1", "224.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
  });
  it("laisse passer les adresses publiques", () => {
    for (const ip of ["93.184.216.34", "172.32.0.1", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuse ce qui n'est pas une adresse", () => {
    expect(isPrivateAddress("exemple")).toBe(true);
  });
});
