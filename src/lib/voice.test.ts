import { describe, expect, it } from "vitest";
import { SpeechStream, VOICES, VoiceGate, isPhantom, speechSsml, speechText, spokenDecision, spokenFarewell, voiceFor, voicesOf } from "./voice.ts";
import { LANGS, langInfo } from "./i18n.ts";

describe("speechText", () => {
  it("retire la mise en forme Markdown", () => {
    expect(speechText("### Courses\n\nEn **octobre**, tu as dépensé `487,30 €` ([détail](/mois)).\n\n- Auchan : 210 €\n- Grand Frais : 107 €")).toBe(
      "Courses En octobre, tu as dépensé 487,30 € (détail). Auchan : 210 € Grand Frais : 107 €",
    );
  });
  it("ne dit ni les encadrés, ni les couleurs, ni le surlignage", () => {
    expect(speechText("Tu as dépensé {-+ 182 €-} de plus, ==à surveiller==.\n\n> [!TIP]\n> Résilie l'abonnement en double.\n\n> [!WARNING] Découvert le 28.")).toBe(
      "Tu as dépensé + 182 € de plus, à surveiller. Résilie l'abonnement en double. Découvert le 28.",
    );
  });
  it("lit un tableau cellule par cellule, sans la ligne de séparation", () => {
    expect(speechText("| Mois | Dépenses |\n| --- | ---: |\n| Septembre | 554 € |\n| Octobre | 487 € |")).toBe("Mois, Dépenses. Septembre, 554 €. Octobre, 487 €.");
  });
  it("coupe à la fin d'une phrase quand c'est trop long", () => {
    const t = speechText(`${"Une phrase assez courte. ".repeat(20)}`, 120);
    expect(t.endsWith("La suite est à l'écran.")).toBe(true);
    expect(t.length).toBeLessThan(160);
    expect(t).toMatch(/courte\. La suite/);
  });
});

describe("speechText (suite)", () => {
  it("retire les émojis", () => {
    expect(speechText("C'est noté ✅ 🎉 !")).toBe("C'est noté !");
  });
});

describe("speechSsml", () => {
  it("impose le français et protège le texte", () => {
    const x = speechSsml("Apple & Bic Camera : 2 600 € <total>", "vivienne");
    expect(x).toContain('<voice name="fr-FR-Vivienne:DragonHDLatestNeural"><lang xml:lang="fr-FR">');
    expect(x).toContain("Apple &amp; Bic Camera : 2 600 € &lt;total&gt;");
  });
  it("lit dans la langue de la voix", () => {
    const x = speechSsml("Guten Tag", "seraphina");
    expect(x).toContain('xml:lang="de-DE"><voice name="de-DE-Seraphina:DragonHDLatestNeural"><lang xml:lang="de-DE">');
  });
  it("propose quatre voix par langue, chacune dans la langue qu'elle annonce", () => {
    for (const l of LANGS) expect(voicesOf(l.id).length).toBe(4);
    for (const v of VOICES) expect(v.name.startsWith(`${langInfo(v.lang).locale}-`), v.id).toBe(true);
    expect(new Set(VOICES.map((v) => v.id)).size).toBe(VOICES.length);
  });
  it("ne rend jamais une voix d'une autre langue", () => {
    expect(voiceFor("fr", "remy")).toBe("remy");
    expect(voiceFor("en", "remy")).toBe("ada");
    expect(voiceFor("es", null)).toBe("ximena");
    expect(voiceFor("it", "inconnue")).toBe("isabella");
  });
});

describe("SpeechStream", () => {
  const feed = (s: SpeechStream, text: string, size = 7) => {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(...s.push(text.slice(i, i + size)));
    return out;
  };
  it("rend la première phrase dès qu'elle est complète, puis des groupes", () => {
    const s = new SpeechStream();
    const text = "Il te reste environ 865 € de prélèvements. Le plus gros est le prêt de Nantes, 842 €, prévu demain. S'y ajoutent Youprice, 12 €, et Orange, 11 €. Voilà.";
    const during = feed(s, text);
    expect(during[0]).toBe("Il te reste environ 865 € de prélèvements.");
    const all = [...during, ...s.flush()];
    expect(all.join(" ")).toBe(text);
    expect(all.length).toBeLessThan(4);
    expect(s.spoke).toBe(true);
  });
  it("ne coupe ni un montant ni une abréviation, et retire la mise en forme", () => {
    const s = new SpeechStream();
    const out = [...feed(s, "M. Dupont a payé **1 284,56 €**.\n\n- Auchan : 210 €\n- Lidl : 90 €\n", 3), ...s.flush()];
    expect(out[0]).toBe("M. Dupont a payé 1 284,56 €.");
    expect(out.join(" ")).toBe("M. Dupont a payé 1 284,56 €. Auchan : 210 € Lidl : 90 €");
  });
  it("dit une réponse très courte à la fin seulement, et rien pour une réponse vide", () => {
    const s = new SpeechStream();
    expect(s.push("Oui.")).toEqual([]);
    expect(s.flush()).toEqual(["Oui."]);
    const e = new SpeechStream();
    expect([...e.push("  \n\n"), ...e.flush()]).toEqual([]);
    expect(e.spoke).toBe(false);
  });
  it("s'arrête quand c'est trop long : la suite reste à l'écran", () => {
    const s = new SpeechStream({ max: 120 });
    const out = [...feed(s, "Une phrase assez courte pour être dite. ".repeat(12)), ...s.flush()];
    expect(out[out.length - 1]).toBe("La suite est à l'écran.");
    expect(out.join(" ").length).toBeLessThan(260);
  });
});

describe("spokenDecision", () => {
  it("reconnaît un accord ou un refus court", () => {
    expect(spokenDecision("Oui, vas-y.")).toBe(true);
    expect(spokenDecision("Confirme")).toBe(true);
    expect(spokenDecision("D'accord !")).toBe(true);
    expect(spokenDecision("Non merci")).toBe(false);
    expect(spokenDecision("Annule.")).toBe(false);
  });
  it("laisse passer une vraie question", () => {
    expect(spokenDecision("Oui mais combien ai-je dépensé en courses le mois dernier ?")).toBeNull();
    expect(spokenDecision("Quel est mon solde ?")).toBeNull();
    expect(spokenDecision("")).toBeNull();
  });
});

describe("spokenFarewell", () => {
  it("reconnaît la fin de la conversation", () => {
    for (const t of ["Au revoir.", "Merci, c'est tout.", "Merci beaucoup, au revoir !", "Stop.", "Bonne soirée", "Ok, à plus tard", "Tu peux t'arrêter."]) expect(spokenFarewell(t), t).toBe(true);
  });
  it("laisse passer une question ou un simple merci", () => {
    for (const t of ["Merci.", "Arrête-moi si je me trompe, mais combien ai-je dépensé ce mois-ci ?", "C'est tout ce que j'ai dépensé en courses ?", "Quel est mon solde ?", ""]) expect(spokenFarewell(t), t).toBe(false);
  });
});

describe("mots dits dans les autres langues", () => {
  it("reconnaît un accord ou un refus", () => {
    expect(spokenDecision("Yes, go ahead.", "en")).toBe(true);
    expect(spokenDecision("Cancel", "en")).toBe(false);
    expect(spokenDecision("Ja, bestätige.", "de")).toBe(true);
    expect(spokenDecision("Abbrechen", "de")).toBe(false);
    expect(spokenDecision("Sì, conferma", "it")).toBe(true);
    expect(spokenDecision("Annulla", "it")).toBe(false);
    expect(spokenDecision("Sí, confirma", "es")).toBe(true);
    expect(spokenDecision("Cancela", "es")).toBe(false);
    // Un mot d'une autre langue n'est pas une décision : « oui » ne confirme rien en anglais.
    expect(spokenDecision("Oui", "en")).toBeNull();
    expect(spokenDecision("How much did I spend on groceries last month?", "en")).toBeNull();
  });
  it("reconnaît la fin de la conversation, pas une question ni un bonjour", () => {
    for (const [text, lang] of [["Thanks, that's all.", "en"], ["Goodbye!", "en"], ["Danke, das war's.", "de"], ["Auf Wiedersehen", "de"], ["Tschüss", "de"], ["Grazie, è tutto.", "it"], ["Arrivederci", "it"], ["Gracias, eso es todo.", "es"], ["Adiós", "es"], ["Hasta luego", "es"]] as const)
      expect(spokenFarewell(text, lang), text).toBe(true);
    for (const [text, lang] of [["Thanks.", "en"], ["Ciao", "it"], ["¿Para qué sirve esto?", "es"], ["Was ist mein Kontostand?", "de"], ["Au revoir", "en"]] as const) expect(spokenFarewell(text, lang), text).toBe(false);
  });
  it("écarte les génériques inventés dans toutes les langues", () => {
    expect(isPhantom("Thanks for watching!")).toBe(true);
    expect(isPhantom("Untertitelung des ZDF, 2020")).toBe(true);
    expect(isPhantom("Sottotitoli creati dalla comunità Amara.org")).toBe(true);
    expect(isPhantom("Subtítulos realizados por la comunidad de Amara.org")).toBe(true);
    expect(isPhantom("How much did I spend this month?")).toBe(false);
  });
});

describe("isPhantom", () => {
  it("écarte les génériques de sous-titres inventés sur du bruit", () => {
    expect(isPhantom("Sous-titres réalisés par la communauté d'Amara.org")).toBe(true);
    expect(isPhantom("Sous-titrage ST' 501")).toBe(true);
    expect(isPhantom("Combien ai-je dépensé en courses ?")).toBe(false);
  });
});

describe("VoiceGate", () => {
  const feed = (g: VoiceGate, level: number, ms: number) => {
    const events: string[] = [];
    for (let t = 0; t < ms; t += 50) {
      const e = g.push(level, 50);
      if (e) events.push(e);
    }
    return events;
  };
  it("détecte une phrase : début après un instant de voix, fin après un silence", () => {
    const g = new VoiceGate();
    expect(feed(g, 0.004, 1000)).toEqual([]);
    expect(feed(g, 0.08, 400)).toEqual(["speech-start"]);
    expect(feed(g, 0.004, 500)).toEqual([]); // courte pause : la phrase continue
    expect(feed(g, 0.08, 600)).toEqual([]);
    expect(feed(g, 0.004, 1200)).toEqual(["speech-end"]);
  });
  it("ignore un bruit bref et s'adapte au bruit ambiant", () => {
    const g = new VoiceGate();
    expect(feed(g, 0.08, 100)).toEqual([]);
    feed(g, 0.02, 4000); // pièce bruyante : le seuil monte
    expect(g.threshold).toBeGreaterThan(0.04);
    expect(feed(g, 0.035, 500)).toEqual([]);
    expect(feed(g, 0.2, 300)).toEqual(["speech-start"]);
  });
  it("signale un long silence et borne la durée d'une phrase", () => {
    expect(feed(new VoiceGate({ idleMs: 2000 }), 0.003, 2100)).toEqual(["timeout"]);
    const g = new VoiceGate({ maxMs: 2000 });
    expect(feed(g, 0.1, 2500)[1]).toBe("speech-end");
  });
});
