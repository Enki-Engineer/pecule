import { beforeAll, describe, expect, it } from "vitest";

/*
 * Schémas de sortie envoyés au fournisseur d'IA (reconnaissance d'un document, extracteurs de l'import) : leur forme.
 * Le fournisseur refuse toute la demande pour un schéma mal écrit — plus aucun document n'est alors lu. Les modules du
 * serveur lisent leur configuration au chargement : on leur en donne une factice (aucune connexion n'est ouverte).
 */
type Node = { type?: unknown; enum?: unknown[]; properties?: Record<string, Node>; required?: string[]; items?: Node; anyOf?: Node[]; additionalProperties?: unknown };
let schemas: [name: string, schema: Node][];

beforeAll(async () => {
  Object.assign(process.env, { DATABASE_URL: "mysql://essai:essai@127.0.0.1:1/essai", APP_URL: "http://localhost:3000", API_TOKEN: "x".repeat(40), SYNC_TOKEN: "y".repeat(40) });
  const { CLASSIFY_SCHEMA } = await import("./documents.ts");
  const { EXTRACTORS } = await import("./imports/extractors/index.ts");
  const { CLASSIFY_OPS_SCHEMA } = await import("./classify-ai.ts");
  schemas = [["reconnaissance", CLASSIFY_SCHEMA as Node], ["classement des opérations", CLASSIFY_OPS_SCHEMA as Node], ...EXTRACTORS.map((x): [string, Node] => [x.id, x.schema as Node])];
});

/** Tous les nœuds d'un schéma, avec leur chemin. */
function nodes(n: Node, path: string, out: [string, Node][] = []): [string, Node][] {
  out.push([path, n]);
  for (const [k, v] of Object.entries(n.properties ?? {})) nodes(v, `${path}.${k}`, out);
  if (n.items) nodes(n.items, `${path}[]`, out);
  (n.anyOf ?? []).forEach((v, i) => nodes(v, `${path}|${i}`, out));
  return out;
}

describe("schémas envoyés à l'IA", () => {
  it("une liste de valeurs ne porte pas sur un type double (« chaîne ou rien » s'écrit en deux branches)", () => {
    for (const [name, schema] of schemas)
      for (const [path, n] of nodes(schema, name)) {
        if (!n.enum) continue;
        expect(Array.isArray(n.type), path).toBe(false);
        expect(n.enum.every((v) => typeof v === "string"), path).toBe(true);
      }
  });

  it("un objet est fermé et exige tous ses champs", () => {
    for (const [name, schema] of schemas)
      for (const [path, n] of nodes(schema, name)) {
        if (n.type !== "object") continue;
        expect(n.additionalProperties, path).toBe(false);
        expect([...(n.required ?? [])].sort(), path).toEqual(Object.keys(n.properties ?? {}).sort());
      }
  });

  it("la nature d'un contrat est l'une de celles du coffre, ou rien", async () => {
    const { TOPICS } = await import("../lib/contracts.ts");
    const topic = schemas[0][1].properties!.topic;
    expect(topic.anyOf).toEqual([{ type: "string", enum: [...TOPICS] }, { type: "null" }]);
  });
});
