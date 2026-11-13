# Liste les textes français qui restent en dur dans un fichier (hors t/tn/tk, classes, commentaires) ; quelques faux positifs.
# Usage : python3 scripts/i18n/reste.py src/client/pages/Écran.tsx …
import re, sys, pathlib
for path in sys.argv[1:]:
    out = []
    for i, line in enumerate(pathlib.Path(path).read_text().split("\n"), 1):
        code = re.sub(r"//.*$", "", line)
        if re.match(r"\s*(\*|/\*|import |\{/\*)", code): continue
        code = re.sub(r'\b(?:t|tn|tk|tr)\((?:"(?:[^"\\]|\\.)*"|`[^`]*`)(?:, "(?:[^"\\]|\\.)*")?', "", code)
        code = re.sub(r'(className|class|key|to|href|type|name|id|role|d|viewBox|fill|stroke|src|htmlFor|data-[\w-]+|inputMode|autoComplete|method|credentials|queryKey)=("[^"]*"|\{`[^`]*`\})', "", code)
        code = re.sub(r'\b(cn|clsx|api|apiStream|navigate|fetch|getItem|setItem|removeItem|closest|querySelector\w*|addEventListener|removeEventListener|startsWith|endsWith|includes|test|RegExp|getElementById)\((?:[^()]|\([^()]*\))*\)', "", code)
        for m in re.finditer(r'"((?:[^"\\]|\\.)*)"|\'((?:[^\'\\]|\\.)*)\'|`([^`]*)`|>([^<>{}]+)<', code):
            s = next(x for x in m.groups() if x is not None).strip()
            if re.search(r"[éèêàùçôîûœÉÀ«»…’]", s) or re.search(r"^[A-ZÉÀ][a-zéèàê']+( [\wéèàê'’]+)+", s) or (m.group(4) and re.search(r"[A-Za-zé]{3}", s)):
                if re.search(r"\b(flex|grid|px-|py-|text-\[|rounded|size-|absolute|items-center)\b", s): continue
                out.append(f"  {i}: {s[:150]}")
    print(f"{path} — {len(out)} restant(s)"); print("\n".join(out))
