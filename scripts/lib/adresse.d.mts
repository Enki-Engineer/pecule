export function addressInfo(url: string): { kind: "https" | "local" | "reseau" | "public"; ip: boolean; passkeys: boolean } | null;
