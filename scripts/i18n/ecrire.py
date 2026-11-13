# Ajoute un lot de traductions aux dictionnaires src/i18n/<langue>.ts (fusion : l'existant est gardé, un texte déjà là est remplacé).
# Un lot est un fichier JSON : une liste de lignes [français, anglais, allemand, italien, espagnol] ; pour un pluriel,
# chaque élément est un couple [singulier, pluriel]. (Un fichier Python qui définit la même liste dans T est aussi accepté.) Les textes à traduire : `pnpm i18n:manquants --json`.
# Usage (depuis la racine du dépôt) : python3 scripts/i18n/ecrire.py lot.py [--menage]   (--menage retire les textes qui ne servent plus)
import json, pathlib, re, runpy, subprocess, sys
LANGS = ["en", "de", "it", "es"]
NAMES = {"en": "anglais", "de": "allemand", "it": "italien", "es": "espagnol"}
q = lambda s: json.dumps(s, ensure_ascii=False)

def read(lang):
    out = {}
    f = pathlib.Path(f"src/i18n/{lang}.ts")
    if f.exists():
        for line in f.read_text().split("\n"):
            if line.startswith('  "'):
                out.update(json.loads("{" + line.strip().rstrip(",") + "}"))
    return out

dicts = {l: read(l) for l in LANGS}
for lot in [a for a in sys.argv[1:] if not a.startswith("--")]:
    rows = json.loads(pathlib.Path(lot).read_text()) if lot.endswith(".json") else runpy.run_path(lot)["T"]
    for row in rows:
        fr = row[0]
        plural = isinstance(fr, (tuple, list))
        for i, l in enumerate(LANGS):
            dicts[l][fr[0] if plural else fr] = list(row[i + 1]) if plural else row[i + 1]
if "--menage" in sys.argv:
    used = json.loads(subprocess.run(["pnpm", "exec", "tsx", "scripts/i18n-manquants.ts", "--utilises"], capture_output=True, text=True, check=True).stdout)
    for l in LANGS:
        dicts[l] = {k: v for k, v in dicts[l].items() if k in used}
for l in LANGS:
    lines = [f"  {q(k)}: {('[' + ', '.join(q(x) for x in v) + ']') if isinstance(v, list) else q(v)}," for k, v in dicts[l].items()]
    head = f'import type {{ Dict }} from "../lib/i18n.ts";\n\n/** Pécule en {NAMES[l]} : texte français du code → traduction. Écrit par `scripts/i18n/ecrire.py` ; complétude vérifiée par `complet.test.ts`. */\n// prettier-ignore\nexport const {l}: Dict = {{\n'
    pathlib.Path(f"src/i18n/{l}.ts").write_text(head + "\n".join(lines) + "\n};\n")
    print(l, len(dicts[l]), "textes")
