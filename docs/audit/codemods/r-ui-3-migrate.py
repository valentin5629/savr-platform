#!/usr/bin/env python3
"""Migrations mécaniques R-UI-3 (boutons) : L (prop `loading`), I (icône sans `mr-*` dans Button).

Analyse des balises JSX (fermeture appariée par profondeur) — reprise de r-ui-6b-migrate.py.
Usage : python3 r-ui-3-migrate.py L I   (SAVR_SRC = racine src ; DRY=1 = rapport seul)
"""
import os, re, sys, glob, collections

ROOT = os.environ.get('SAVR_SRC', os.path.join(os.getcwd(), 'packages/plateforme/src'))
EXCLUDE = ('/components/ui/', '/app/dev/', '/app/api/', '.test.', '/test-utils/',
           'parametres/algo-ag/page.tsx')  # algo-ag : PR parallèle de Val
DRY = os.environ.get('DRY') == '1'
STATS = collections.Counter()
TODO = []

def files():
    out = []
    for d in ('app', 'components'):
        for f in glob.glob(f'{ROOT}/{d}/**/*.tsx', recursive=True):
            if any(x in f for x in EXCLUDE): continue
            out.append(f)
    return sorted(out)

def find_tag_end(s, i):
    depth = 0; j = i; n = len(s); in_str = None
    while j < n:
        c = s[j]
        if in_str:
            if c == '\\': j += 2; continue
            if c == in_str: in_str = None
        elif c in '"\'`': in_str = c
        elif c == '{': depth += 1
        elif c == '}': depth -= 1
        elif c == '>' and depth == 0: return j
        j += 1
    return -1

def find_close(s, tag, start):
    depth = 1; j = start
    open_re = re.compile(r'<' + re.escape(tag) + r'(?=[\s>/])')
    close_re = re.compile(r'</' + re.escape(tag) + r'\s*>')
    while True:
        mo = open_re.search(s, j); mc = close_re.search(s, j)
        if not mc: return -1, -1
        if mo and mo.start() < mc.start():
            e = find_tag_end(s, mo.start())
            if e < 0: return -1, -1
            if s[e - 1] != '/': depth += 1
            j = e + 1
        else:
            depth -= 1
            if depth == 0: return mc.start(), mc.end()
            j = mc.end()

def rel(f): return os.path.relpath(f, ROOT)
def lineno(s, i): return s[:i].count('\n') + 1

def buttons(s):
    """Itère (start, attrs_text, children, end) sur chaque <Button …>…</Button> (non auto-fermant)."""
    out = []
    for m in re.finditer(r'<Button(?=[\s>])', s):
        e = find_tag_end(s, m.start())
        if e < 0 or s[e - 1] == '/': continue
        cs, ce = find_close(s, 'Button', e + 1)
        if cs < 0: continue
        out.append((m.start(), s[m.end():e], s[e + 1:cs], ce))
    return out

# ── Phase L : état chargement → prop `loading` ──────────────────────────────
ICON_RE = r'(?:<([A-Z]\w*)\s+className=(?:"[^"]*"|\{`[^`]*`\})\s*/>|<([A-Z]\w*)\s*/>)'
# children = [icône] {COND ? 'texte…' : RESTE}
CHILD_RE = re.compile(
    r'^\s*(?P<icon>' + ICON_RE + r')?\s*\{\s*(?P<cond>[^?{}]+?)\s*\?\s*'
    r'(?P<busy>\'[^\']*\'|"[^"]*")\s*:\s*(?P<rest>[^{}]+?)\s*\}\s*$', re.S)
LOADING_NAMES = re.compile(r'^(?:[\w.]*\.)?(?:loading|saving|submitting|busy|pending|inviting|generating|isPending|isSubmitting|isLoading|envoi|enCours)$')

def jsx_str(lit):
    v = lit[1:-1]
    if '"' not in v: return f'"{v}"'
    return '{' + lit + '}'

def strip_disabled(attrs, cond):
    """Retire `cond` de disabled={…} ; renvoie (attrs, retiré?)."""
    m = re.search(r'\s+disabled=\{([^}]*)\}', attrs)
    if not m: return attrs, False
    expr = ' '.join(m.group(1).split()); c = ' '.join(cond.split())
    if expr == c: return attrs[:m.start()] + attrs[m.end():], True
    parts = [p.strip() for p in expr.split('||')]
    if c in parts and len(parts) > 1 and all('&&' not in p for p in parts):
        raw = m.group(1)  # retrait textuel (préserve retours à la ligne et commentaires)
        raw2 = re.sub(r'(^|\|\|)\s*' + re.escape(c) + r'\s*\|\|', r'\1', raw, count=1, flags=re.S)
        if raw2 == raw: raw2 = re.sub(r'\|\|\s*' + re.escape(c) + r'\s*$', '', raw, count=1, flags=re.S)
        return attrs[:m.start()] + ' disabled={' + raw2.strip() + '}' + attrs[m.end():], True
    return attrs, False

def phase_L(s, f):
    out = []; last = 0
    for start, attrs, children, end in buttons(s):
        if 'loading=' in attrs: continue
        m = CHILD_RE.match(children)
        if not m:
            if '?' in children and re.search(r'\b(loading|saving|submitting|busy|pending|generating|inviting|regenerating)\b', children):
                TODO.append(f'{rel(f)}:{lineno(s, start)} L manuel :: {" ".join(children.split())[:100]}')
            continue
        cond = m.group('cond').strip(); busy = m.group('busy'); rest = m.group('rest').strip()
        if not busy.endswith(('…\'', '…"')):
            TODO.append(f'{rel(f)}:{lineno(s, start)} L non-… :: {" ".join(children.split())[:100]}')
            continue
        attrs2, _ = strip_disabled(attrs, cond)
        attrs2 = attrs2.rstrip() + f' loading={{{cond}}} loadingText={jsx_str(busy)}'
        icon = m.group('icon') or ''
        if re.fullmatch(r'\'[^\'{}<>]*\'|"[^"{}<>]*"', rest) and "'" not in rest[1:-1]:
            body = rest[1:-1]
        else:
            body = '{' + rest + '}'
        new = f'<Button{attrs2}>{icon}{(" " if icon else "")}{body}</Button>'
        out.append(s[last:start]); out.append(new); last = end
        STATS['L'] += 1
    out.append(s[last:])
    s = ''.join(out)
    # disabled={x} seul (sans retour visuel) sur un bouton d'action → loading={x}
    out = []; last = 0
    for start, attrs, children, end in buttons(s):
        if 'loading=' in attrs or '?' in children: continue
        m = re.search(r'\s+disabled=\{([\w.]+)\}', attrs)
        if not m or not LOADING_NAMES.match(m.group(1)): continue
        if re.search(r'variant="(secondary|ghost|link|outline)', attrs): continue
        if re.search(r'Annuler|Retour|Fermer', children): continue
        attrs2 = attrs[:m.start()] + ' loading={' + m.group(1) + '}' + attrs[m.end():]
        out.append(s[last:start]); out.append(f'<Button{attrs2}>{children}</Button>'); last = end
        STATS['L-disabled'] += 1
        TODO.append(f'{rel(f)}:{lineno(s, start)} L disabled→loading (vérifier) :: {" ".join(children.split())[:80]}')
    out.append(s[last:])
    return ''.join(out)

# ── Phase I : icône dans Button sans mr-* ni h-4 w-4 ─────────────────────────
def phase_I(s, f):
    out = []; last = 0
    for start, attrs, children, end in buttons(s):
        new = children
        for im in list(re.finditer(r'<([A-Z]\w*)\s+className="([^"]*)"\s*/>', children)):
            cls = [c for c in im.group(2).split() if not re.fullmatch(r'(mr|ml)-\d+(\.\d+)?|h-4|w-4|shrink-0', c)]
            rep = f'<{im.group(1)} />' if not cls else f'<{im.group(1)} className="{" ".join(cls)}" />'
            if rep != im.group(0):
                new = new.replace(im.group(0), rep, 1); STATS['I'] += 1
        if new != children:
            out.append(s[last:start]); out.append(f'<Button{attrs}>{new}</Button>'); last = end
    out.append(s[last:])
    return ''.join(out)

PHASES = {'L': phase_L, 'I': phase_I}

if __name__ == '__main__':
    phases = sys.argv[1:] or list(PHASES)
    for f in files():
        s0 = s = open(f).read()
        for p in phases: s = PHASES[p](s, f)
        if s != s0 and not DRY: open(f, 'w').write(s)
    print(dict(STATS))
    for t in TODO: print(t)
