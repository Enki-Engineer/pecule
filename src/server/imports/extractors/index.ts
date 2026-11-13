import type { Extractor } from "../registry.ts";
import { bien } from "./bien.ts";
import { bulletin } from "./bulletin.ts";
import { fichierBanque } from "./fichier-banque.ts";
import { avisImpot, taxeFonciere } from "./impots.ts";
import { contrat, placement } from "./placement.ts";
import { pret } from "./pret.ts";
import { releve } from "./releve.ts";
import { retraite } from "./retraite.ts";

/** Les types de documents que l'import massif sait lire, dans l'ordre où ils sont essayés. */
export const EXTRACTORS = [bulletin, avisImpot, taxeFonciere, pret, retraite, bien, releve, placement, contrat, fichierBanque] as unknown as Extractor[];

export const extractorById = (id: string | null | undefined) => EXTRACTORS.find((x) => x.id === id) ?? null;
export const pickExtractor = (c: { kind: string; domain: string; title: string }) => EXTRACTORS.find((x) => x.matches(c)) ?? null;
