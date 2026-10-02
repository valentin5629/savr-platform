#!/usr/bin/env python3
"""Migrations mécaniques R-UI-6b (iso-rendu) : Heading / PageHeader / Card / ChartTooltip / ToggleChip / Text."""
import os, re, sys, glob, collections

ROOT = '/home/user/savr-platform/packages/plateforme/src'
EXCLUDE = ('/components/ui/', '/app/dev/', '/app/api/', '.test.', '/test-utils/',
           'parametres/algo-ag/page.tsx')  # algo-ag : PR parallèle de Val
STATS = collections.Counter()

def files():
    out = []
    for d in ('app', 'components'):
        for f in glob.glob(f'{ROOT}/{d}/**/*.tsx', recursive=True):
            if any(x in f for x in EXCLUDE): continue
            out.append(f)
    return sorted(out)

# ── helpers JSX ─────────────────────────────────────────────────────────────
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

def add_import(s, name, path):
    m = re.search(r"^import \{([^}]*)\} from '" + re.escape(path) + r"';$", s, re.M)
    if m:
        names = [n.strip() for n in m.group(1).split(',') if n.strip()]
        if name in names: return s
        names.append(name)
        return s[:m.start()] + "import { " + ', '.join(names) + " } from '" + path + "';" + s[m.end():]
    lines = s.split('\n')
    idx = [i for i, l in enumerate(lines) if l.startswith('import ') or l.startswith("} from ")]
    if not idx:
        # après 'use client' éventuel
        k = 1 if lines and lines[0].startswith("'use client'") else 0
        lines.insert(k, f"import {{ {name} }} from '{path}';")
        if k == 1: lines.insert(1, '')
    else:
        lines.insert(idx[-1] + 1, f"import {{ {name} }} from '{path}';")
    return '\n'.join(lines)

def class_attr(tag_text):
    m = re.search(r'\sclassName="([^"]*)"', tag_text)
    return m

# ── Phase H : h1/h2/h3 → Heading ────────────────────────────────────────────
SIZE = {'text-sm': 'sm', 'text-base': 'base', 'text-lg': 'lg', 'text-xl': 'xl', 'text-2xl': '2xl'}
WEIGHT = {'font-medium': 'medium', 'font-semibold': 'semibold', 'font-bold': 'bold', 'font-extrabold': 'extrabold'}
TONE = {'text-savr-neutral-900': 'neutral', 'text-savr-neutral-800': 'strong', 'text-savr-neutral-700': 'muted',
        'text-savr-neutral-500': 'faint', 'text-savr-primary-800': 'primary', 'text-savr-primary-950': 'primary-deep',
        'text-savr-white': 'white'}
DEFAULTS = {1: ('2xl', 'bold'), 2: ('lg', 'semibold'), 3: ('base', 'semibold')}

def heading_props(level, classes):
    toks = classes.split(); size = weight = tone = None; tight = overline = False; rest = []
    for t in toks:
        if t in SIZE: size = SIZE[t]
        elif t in WEIGHT: weight = WEIGHT[t]
        elif t in TONE: tone = TONE[t]
        elif t == 'tracking-[-0.02em]': tight = True
        elif t in ('uppercase', 'tracking-wide'): overline = True
        elif t.startswith('text-savr-') or t.startswith('text-') and t not in ('text-left', 'text-center', 'text-right'):
            return None  # couleur / taille non répertoriée
        else: rest.append(t)
    if weight is None: return None
    if overline and not ('uppercase' in toks and 'tracking-wide' in toks): return None
    dsize, dweight = DEFAULTS[level]
    props = [f'level={{{level}}}']
    if (size or 'inherit') != dsize: props.append(f'size="{size or "inherit"}"')
    if weight != dweight: props.append(f'weight="{weight}"')
    if (tone or 'inherit') != 'neutral': props.append(f'tone="{tone or "inherit"}"')
    if tight: props.append('tight')
    if overline: props.append('overline')
    if rest: props.append(f'className="{" ".join(rest)}"')
    return props

def phase_headings(s, f):
    changed = False; pos = 0
    while True:
        m = re.compile(r'<(h[123])(?=[\s>])').search(s, pos)
        if not m: break
        tag = m.group(1); e = find_tag_end(s, m.start())
        if e < 0: break
        tag_text = s[m.start():e + 1]
        cm = class_attr(tag_text)
        if not cm or s[e - 1] == '/': pos = e + 1; continue
        props = heading_props(int(tag[1]), cm.group(1))
        if props is None: STATS['heading-skip'] += 1; pos = e + 1; continue
        attrs_rest = (tag_text[len('<' + tag):cm.start()] + tag_text[cm.end():-1]).strip()
        cs, ce = find_close(s, tag, e + 1)
        if cs < 0: pos = e + 1; continue
        new_open = '<Heading ' + ' '.join(props) + (' ' + attrs_rest if attrs_rest else '') + '>'
        s = s[:m.start()] + new_open + s[e + 1:cs] + '</Heading>' + s[ce:]
        pos = m.start() + len(new_open); changed = True; STATS['heading'] += 1
    if changed: s = add_import(s, 'Heading', '@/components/ui/heading')
    return s

# ── Phase P : en-tête simple → PageHeader ───────────────────────────────────
WRAP_RE = re.compile(r'<div className="(flex(?: flex-wrap)? items-center justify-between(?: gap-\d+)?)">\s*')
HEAD_RE = re.compile(r'<Heading level=\{1\}((?:\s+(?:tone="(?:primary|neutral)"|size="xl"|weight="semibold"))*)>')

def ph_props(heading_props_text):
    props = []
    for k, v in re.findall(r'(tone|size|weight)="([^"]+)"', heading_props_text):
        props.append(f'{k}="{v}"')
    return props

def phase_pageheader(s, f):
    changed = False; pos = 0
    while True:
        m = WRAP_RE.search(s, pos)
        if not m: break
        inner_start = m.end()
        # première forme : Heading directement
        hm = HEAD_RE.match(s, inner_start)
        icon = None
        if not hm:
            im = re.compile(r'<div className="flex items-center gap-3">\s*').match(s, inner_start)
            if im:
                # icône = premier élément auto-fermant, puis Heading
                ic = re.compile(r'<([A-Z][A-Za-z0-9]*)\b[^>]*?/>\s*').match(s, im.end())
                if ic:
                    hm2 = HEAD_RE.match(s, ic.end())
                    if hm2:
                        hcs, hce = find_close(s, 'Heading', hm2.end())
                        # fermeture du sous-div juste après le Heading
                        sub_close = re.compile(r'\s*</div>\s*').match(s, hce)
                        if hcs > 0 and sub_close:
                            icon = ic.group(0).strip(); hm = hm2
                            title = s[hm.end():hcs].strip()
                            after = sub_close.end()
        if not hm: pos = m.end(); continue
        if icon is None:
            hcs, hce = find_close(s, 'Heading', hm.end())
            if hcs < 0: pos = m.end(); continue
            title = s[hm.end():hcs].strip(); after = hce
        # actions = reste jusqu'au </div> du wrapper
        wcs, wce = find_close(s, 'div', m.end())
        if wcs < 0 or wcs < after: pos = m.end(); continue
        actions = s[after:wcs].strip()
        if '\n' in title and '{' in title: pos = m.end(); continue
        indent = re.search(r'[ \t]*$', s[:m.start()]).group(0)
        props = ph_props(hm.group(1))
        parts = [f'title={{{title}}}' if title.startswith('{') or '<' in title else f'title="{title}"']
        if '"' in title and not title.startswith('{') and '<' not in title: parts = [f'title={{`{title}`}}']
        parts += props
        if icon: parts.append(f'icon={{{icon}}}')
        if actions:
            if actions.count('\n') == 0 and actions.startswith('<') and actions.endswith('>') and actions.count('</') + actions.count('/>') == 1:
                parts.append(f'actions={{{actions}}}')
            else:
                parts.append('actions={\n' + indent + '  <>\n' + '\n'.join(indent + '    ' + l.strip() for l in actions.split('\n')) + '\n' + indent + '  </>\n' + indent + '}')
        new = '<PageHeader\n' + '\n'.join(indent + '  ' + p for p in parts) + '\n' + indent + '/>'
        s = s[:m.start()] + new + s[wce:]
        pos = m.start() + len(new); changed = True; STATS['pageheader'] += 1
    if changed: s = add_import(s, 'PageHeader', '@/components/ui/page-header')
    return s

# ── Phase C : Card padding / variant / CardTitle size / conteneurs inline ───
PAD = {'p-4': 'sm', 'p-5': 'md', 'p-6': 'lg'}

def phase_card(s, f):
    changed = False
    def repl_card(m):
        nonlocal changed
        tag, cls = m.group(1), m.group(2); toks = cls.split(); props = []
        pads = [t for t in toks if t in PAD]
        if len(pads) == 1:
            toks.remove(pads[0]); props.append(f'padding="{PAD[pads[0]]}"')
        if 'rounded-savr-lg' in toks and 'shadow-savr-sm' in toks:
            toks.remove('rounded-savr-lg'); toks.remove('shadow-savr-sm'); props.append('variant="elevated"')
        if not props: return m.group(0)
        changed = True; STATS['card-props'] += 1
        rest = f' className="{" ".join(toks)}"' if toks else ''
        return f'<{tag} ' + ' '.join(props) + rest
    s = re.sub(r'<(Card|CardClickable) className="([^"]*)"', repl_card, s)
    def repl_title(m):
        nonlocal changed
        toks = m.group(1).split()
        if 'text-base' not in toks and 'text-sm' not in toks: return m.group(0)
        size = 'base' if 'text-base' in toks else 'sm'
        toks = [t for t in toks if t not in ('text-base', 'text-sm')]
        changed = True; STATS['cardtitle-size'] += 1
        return f'<CardTitle size="{size}"' + (f' className="{" ".join(toks)}"' if toks else '')
    s = re.sub(r'<CardTitle className="([^"]*)"', repl_title, s)
    # conteneurs inline « recette cockpit » → <Card variant="elevated" padding>
    pos = 0; need_card = False
    while True:
        m = re.compile(r'<div className="([^"]*)"').search(s, pos)
        if not m: break
        toks = m.group(1).split()
        req = {'rounded-savr-lg', 'border', 'border-savr-neutral-200', 'bg-savr-white', 'shadow-savr-sm'}
        pads = [t for t in toks if t in PAD]
        if req <= set(toks) and len(pads) == 1 and 'shadow-savr-none' not in toks:
            e = find_tag_end(s, m.start())
            if s[e - 1] == '/': pos = e + 1; continue
            cs, ce = find_close(s, 'div', e + 1)
            if cs < 0: pos = e + 1; continue
            rest = [t for t in toks if t not in req and t not in PAD]
            tag_rest = s[m.end():e]
            new_open = f'<Card variant="elevated" padding="{PAD[pads[0]]}"' + (f' className="{" ".join(rest)}"' if rest else '') + tag_rest + '>'
            s = s[:m.start()] + new_open + s[e + 1:cs] + '</Card>' + s[ce:]
            pos = m.start() + len(new_open); changed = True; need_card = True; STATS['card-inline'] += 1
        else:
            pos = m.end()
    if need_card: s = add_import(s, 'Card', '@/components/ui/card')
    return s

# ── Phase I7 : infobulles de graphe → ChartTooltip ──────────────────────────
TT_REQ = {'rounded-savr-md', 'border', 'border-savr-neutral-200', 'bg-savr-white', 'px-3', 'py-2', 'shadow-savr-md'}
TT_FLOAT = {'pointer-events-none', 'absolute', 'z-10'}

def phase_tooltip(s, f):
    changed = False; pos = 0
    while True:
        m = re.compile(r'<div(?=[\s>])').search(s, pos)
        if not m: break
        e = find_tag_end(s, m.start())
        if e < 0: break
        tag_text = s[m.start():e + 1]
        cm = class_attr(tag_text)
        if not cm or s[e - 1] == '/': pos = e + 1; continue
        toks = cm.group(1).split()
        if not TT_REQ <= set(toks): pos = e + 1; continue
        cs, ce = find_close(s, 'div', e + 1)
        if cs < 0: pos = e + 1; continue
        floating = TT_FLOAT <= set(toks)
        rest = [t for t in toks if t not in TT_REQ and (not floating or t not in TT_FLOAT)]
        props = [] if floating else ['floating={false}']
        if rest: props.append(f'className="{" ".join(rest)}"')
        attrs_rest = (tag_text[len('<div'):cm.start()] + tag_text[cm.end():-1]).strip()
        new_open = '<ChartTooltip' + ''.join(' ' + p for p in props) + (' ' + attrs_rest if attrs_rest else '') + '>'
        s = s[:m.start()] + new_open + s[e + 1:cs] + '</ChartTooltip>' + s[ce:]
        pos = m.start() + len(new_open); changed = True; STATS['tooltip'] += 1
    if changed: s = add_import(s, 'ChartTooltip', '@/components/ui/chart-tooltip')
    return s

# ── Phase K2 : légendes cliquables → ToggleChip ─────────────────────────────
CHIP_RE = re.compile(
    r'<button\s+(?:key=\{(?P<key>[^}]+)\}\s+)?type="button"\s+onClick=\{(?P<onclick>[^}]*)\}\s+aria-pressed=\{(?P<pressed>[^}]+)\}\s+'
    r'className="(?P<cls>[^"]*)"\s+style=\{\{(?P<style>[^}]*)\}\}\s*>\s*'
    r'<span\s+style=\{\{\s*width:\s*(?P<w>\d+),\s*height:\s*(?P<h>\d+),\s*background:\s*(?P<color>[^,]+),\s*borderRadius:\s*(?P<r>\d+),\s*\}\}\s*/>\s*'
    r'(?P<label>[^<]+?)\s*</button>', re.S)
CHIP_VARIANTS = {
    'bare': '-my-3 flex min-h-[44px] items-center gap-1.5 rounded-savr-full px-1.5 transition-opacity focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
    'pill': 'inline-flex min-h-[44px] items-center gap-1.5 rounded-savr-full border border-savr-neutral-100 bg-savr-neutral-50 px-2.5 py-1 text-xs font-semibold text-savr-neutral-700 transition-colors hover:border-savr-neutral-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
    'accent': 'inline-flex min-h-[44px] items-center gap-1.5 rounded-savr-full border px-2.5 py-1 text-xs font-bold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-savr-primary-500',
}

def phase_chips(s, f):
    changed = False
    def repl(m):
        nonlocal changed
        cls = m.group('cls'); variant = next((k for k, v in CHIP_VARIANTS.items() if v == cls), None)
        if not variant: STATS['chip-skip'] += 1; return m.group(0)
        style = m.group('style')
        op = re.search(r'opacity:\s*(?P<cond>[^?]+)\?\s*0\.4\s*:\s*1', style)
        if not op: STATS['chip-skip'] += 1; return m.group(0)
        pressed = m.group('pressed').strip()
        if variant == 'accent':
            # fond / bordure / couleur = tokens accent (TINT.orange / ACCENT_TEXT) portés par la variante
            if not ('TINT.orange' in style and 'ACCENT_TEXT' in style): STATS['chip-skip'] += 1; return m.group(0)
        shape = 'line' if m.group('w') == '14' else 'square'
        sw = f"{{ color: {m.group('color').strip()}" + (", shape: 'line'" if shape == 'line' else '') + (f", radius: {m.group('r')}" if (shape == 'square' and m.group('r') != '2') else '') + ' }'
        indent = re.search(r'[ \t]*$', s[:m.start()]).group(0)
        key = f'\n{indent}  key={{{m.group("key")}}}' if m.group('key') else ''
        changed = True; STATS['chip'] += 1
        return (f'<ToggleChip{key}\n{indent}  variant="{variant}"\n{indent}  pressed={{{pressed}}}\n{indent}  onClick={{{m.group("onclick")}}}\n'
                f'{indent}  swatch={{{sw}}}\n{indent}>\n{indent}  {m.group("label").strip()}\n{indent}</ToggleChip>')
    s = CHIP_RE.sub(repl, s)
    if changed: s = add_import(s, 'ToggleChip', '@/components/ui/toggle-chip')
    return s

# ── Phase T : texte courant → Text ──────────────────────────────────────────
TSIZE = {'text-[10px]': '3xs', 'text-[11px]': '2xs', 'text-xs': 'xs', 'text-[13px]': 'xs-plus', 'text-sm': 'sm', 'text-base': 'base'}
TTONE = {'text-savr-neutral-400': 'faint', 'text-savr-neutral-500': 'muted', 'text-savr-neutral-600': 'soft',
         'text-savr-neutral-700': 'body', 'text-savr-neutral-800': 'strong', 'text-savr-neutral-900': 'ink'}
VARIANTS = {('sm', 'muted'): 'muted', ('xs', 'muted'): 'hint', ('xs', 'faint'): 'faint', ('sm', 'body'): 'body'}
BASE_BY_SIZE = {'sm': ('muted', 'sm', 'muted'), 'xs': ('hint', 'xs', 'muted'), 'xs-plus': ('muted', 'sm', 'muted'),
                '2xs': ('hint', 'xs', 'muted'), '3xs': ('hint', 'xs', 'muted'), 'base': ('muted', 'sm', 'muted')}
TEXT_ELTS = ('p', 'span', 'div', 'dt', 'dd', 'li', 'label')

def text_props(classes):
    toks = classes.split(); size = tone = None; rest = []; overline = False
    for t in toks:
        if t in TSIZE:
            if size: return None
            size = TSIZE[t]
        elif t in TTONE:
            if tone: return None
            tone = TTONE[t]
        elif t.startswith('text-') and t not in ('text-left', 'text-center', 'text-right', 'text-balance', 'text-pretty'):
            return None
        else: rest.append(t)
    if not size or not tone: return None
    if 'uppercase' in rest:
        if {'uppercase', 'tracking-wide', 'font-semibold'} <= set(rest) and tone == 'muted':
            for t in ('uppercase', 'tracking-wide', 'font-semibold'): rest.remove(t)
            overline = True
        else: return None
    props = []
    if overline:
        props.append('variant="overline"')
        if size != 'xs': props.append(f'size="{size}"')
    else:
        v = VARIANTS.get((size, tone))
        if v:
            if v != 'muted': props.append(f'variant="{v}"')
        else:
            bv, bsize, btone = BASE_BY_SIZE[size]
            if bv != 'muted': props.append(f'variant="{bv}"')
            if size != bsize: props.append(f'size="{size}"')
            if tone != btone: props.append(f'tone="{tone}"')
    if rest: props.append(f'className="{" ".join(rest)}"')
    return props

def phase_text(s, f):
    changed = False; pos = 0
    rx = re.compile(r'<(' + '|'.join(TEXT_ELTS) + r')(?=[\s>])')
    while True:
        m = rx.search(s, pos)
        if not m: break
        tag = m.group(1); e = find_tag_end(s, m.start())
        if e < 0: break
        tag_text = s[m.start():e + 1]
        cm = class_attr(tag_text)
        if not cm or s[e - 1] == '/': pos = e + 1; continue
        props = text_props(cm.group(1))
        if props is None: pos = e + 1; continue
        attrs_rest = (tag_text[len('<' + tag):cm.start()] + tag_text[cm.end():-1]).strip()
        cs, ce = find_close(s, tag, e + 1)
        if cs < 0: pos = e + 1; continue
        pre = [f'as="{tag}"'] if tag != 'p' else []
        new_open = '<Text' + ''.join(' ' + p for p in pre + props) + (' ' + attrs_rest if attrs_rest else '') + '>'
        s = s[:m.start()] + new_open + s[e + 1:cs] + '</Text>' + s[ce:]
        pos = m.start() + len(new_open); changed = True; STATS['text'] += 1; STATS[f'text-{tag}'] += 1
    if changed: s = add_import(s, 'Text', '@/components/ui/text')
    return s

PHASES = {'H': phase_headings, 'P': phase_pageheader, 'C': phase_card, 'I7': phase_tooltip, 'K2': phase_chips, 'T': phase_text}

def main(selected):
    for f in files():
        s0 = open(f).read(); s = s0
        for k in selected: s = PHASES[k](s, f)
        if s != s0:
            open(f, 'w').write(s); STATS['files'] += 1
    for k, v in sorted(STATS.items()): print(f'{k:16s} {v}')

if __name__ == '__main__':
    main(sys.argv[1:] or list(PHASES))
