# Contrôle un lot de traductions avant de le fusionner : JSON lisible, cinq langues par ligne, mêmes variables,
# espaces de début et de fin gardées, et tous les textes des fichiers donnés couverts (par le lot ou déjà traduits).
# Usage (depuis la racine du dépôt) : python3 scripts/i18n/verifier-lot.py lot.json [fichiers du lot…]
import json, pathlib, re, subprocess, sys
lot = json.loads(pathlib.Path(sys.argv[1]).read_text())
ph = lambda s: sorted(re.findall(r"\{(\w+)\}", s))
bad = []; keys = set()
for i, row in enumerate(lot):
    if not isinstance(row, list) or len(row) != 5: bad.append(f"ligne {i} : il faut 5 éléments (fr, en, de, it, es)"); continue
    plural = isinstance(row[0], list)
    key = row[0][0] if plural else row[0]
    if key in keys: bad.append(f"en double : {key[:60]}")
    keys.add(key)
    for j, v in enumerate(row[1:], 1):
        if plural != isinstance(v, list) or (plural and len(v) != 2): bad.append(f"« {key[:50]} » : pluriel attendu partout ([singulier, pluriel])"); continue
        for a, b in (zip(row[0], v) if plural else [(row[0], v)]):
            if not isinstance(b, str) or not b.strip(): bad.append(f"« {key[:50]} » : traduction vide (langue {j})")
            elif ph(a) != ph(b): bad.append(f"« {key[:50]} » : variables différentes (langue {j}) : {ph(a)} ≠ {ph(b)}")
            elif (a[:1].isspace(), a[-1:].isspace()) != (b[:1].isspace(), b[-1:].isspace()): bad.append(f"« {key[:50]} » : espace de début ou de fin à garder (langue {j})")
files = sys.argv[2:]
if files:
    out = subprocess.run(["pnpm", "exec", "tsx", "scripts/i18n-manquants.ts", "--json", "--fichiers", *files], capture_output=True, text=True, check=True).stdout
    for k in json.loads(out):
        k = k[0] if isinstance(k, list) else k
        if k not in keys: bad.append(f"texte du code absent du lot : {k[:80]}")
print(f"{len(lot)} lignes ; " + ("lot correct" if not bad else f"{len(bad)} problème(s) :"))
for b in bad[:60]: print("  -", b)
sys.exit(1 if bad else 0)
