# Enveloppe les textes français simples d'un fichier d'écran dans t("…") : attributs, texte entre balises, tables de libellés.
# Usage (depuis la racine du dépôt) : python3 scripts/i18n/envelopper.py src/client/pages/Écran.tsx …
# Relire ensuite `git diff` (un libellé comparé à un texte ailleurs ne doit pas être traduit) et finir à la main ce que
# l'outil ne voit pas — gabarits, ternaires, pluriels — avec `python3 scripts/i18n/reste.py <fichier>`.
import re, sys, pathlib
L = r"A-Za-zÀ-ÖØ-öø-ÿŒœ"
ATTRS = r"aria-label|title|placeholder|alt|label|hint|sub|what|subtitle|empty|caption"
PROPS = r"title|label|hint|sub|placeholder|header|subtitle|caption|description|text"
def esc(s): return s.replace("\\", "\\\\").replace('"', '\\"')
def has_words(s): return re.search(rf"[{L}]{{2}}", s) is not None
def wrap(path):
    p = pathlib.Path(path); s = p.read_text(); o = s; tsx = p.suffix == ".tsx"; n = 0
    if tsx:
        # attribut="Texte"
        def a(m):
            return m.group(0) if not has_words(m.group(2)) else f'{m.group(1)}={{t("{esc(m.group(2))}")}}'
        s = re.sub(rf'(?<![\w-])({ATTRS})="([^"\n]*)"', a, s)
        # >Texte< sur une ligne, après une fin de balise ("> ou }> ou />… pas un générique)
        def b(m):
            lead, core, trail = re.match(r"^(\s*)(.*?)(\s*)$", m.group(2)).groups()
            if not has_words(core) or re.search(r"[=;()\[\]|&]", core): return m.group(0)
            return f'{m.group(1)}>{lead}{{t("{esc(core)}")}}{trail}<'
        s = re.sub(r'(["}\w/])>([^<>{}\n]+)<(?=/|[A-Za-z])', b, s)
        # ligne de texte seule entre deux balises
        def c(m):
            core = m.group(2).rstrip()
            if not has_words(core) or re.search(r"[=;{}<>]|^\s*(//|\*|/\*|import |export |return |const |let |if |for |case )", core) or core.endswith((",", "(", "[", "&&", "||", "?", ":")) and not re.search(r" [?:!]$", core): return m.group(0)
            return f'{m.group(1)}{{t("{esc(core)}")}}\n'
        s = re.sub(rf'(?m)^(\s+)((?:[A-ZÀ-ÖØ-Þ«]|[{L}]+ )[^\n]*)\n(?=\s*<)', c, s)
    # tables de libellés : clé: "Texte"
    def d(m):
        v = m.group(2)
        if not has_words(v) or re.fullmatch(r"[a-z0-9_./:#-]+", v): return m.group(0)
        return f'{m.group(1)}: t("{esc(v)}")'
    s = re.sub(rf'(?<![\w"])({PROPS}): "([^"\n]*)"', d, s)
    # toasts
    s = re.sub(r'(toast\.(?:error|success|message|info|warning)\()"([^"\n]+)"', lambda m: f'{m.group(1)}t("{esc(m.group(2))}")', s)
    if s != o:
        rel = "../" * len(p.relative_to("src/client").parts[:-1]) + "../lib/i18n.ts" if str(p).startswith("src/client") else None
        if rel and not re.search(r'import \{[^}]*\bt\b[^}]*\} from "[./]*lib/i18n\.ts"', s):
            m = re.search(r'import \{([^}]*)\} from "' + re.escape(rel) + '";', s)
            if m: s = s.replace(m.group(0), f'import {{{m.group(1).rstrip()}, t }} from "{rel}";')
            else:
                last = [x for x in re.finditer(r'^import [^;]*;\n', s, flags=re.M)][-1].end()
                s = s[:last] + f'import {{ t }} from "{rel}";\n' + s[last:]
        p.write_text(s)
    print(f"{path}: {s.count('t(\"') - o.count('t(\"')} textes enveloppés")
for f in sys.argv[1:]: wrap(f)
