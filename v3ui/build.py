#!/usr/bin/env python3
# Assemble l'interface V3 : src/renderer/public/v3/{index.html,app.js,app.css,assets/}. Copié aussi dans out/renderer/v3 pour les essais sans refaire electron-vite.
import base64, glob, os, shutil, subprocess, sys
U = os.path.dirname(os.path.abspath(__file__))
R = os.path.dirname(U)
S = U + '/src'
OUT = R + '/src/renderer/public/v3'
os.makedirs(OUT + '/assets', exist_ok=True)
ESB = R + '/node_modules/.bin/esbuild'
esb = lambda: [ESB] if os.path.exists(ESB) else ['npx', '--yes', 'esbuild@0.24.0']
cmd = esb() + [
    U + '/shared-entry.ts', '--bundle', '--format=iife', '--global-name=Shared', '--platform=browser', '--target=chrome130',
    '--alias:@shared=' + R + '/src/shared', '--outfile=' + U + '/.shared.js', '--log-level=warning']
subprocess.run(cmd, check=True, cwd=R)
b64 = lambda p: base64.b64encode(open(p, 'rb').read()).decode()
css = f"""@font-face{{font-family:'Archivo';src:url(data:font/woff2;base64,{b64(U + '/fonts/archivo.woff2')}) format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:swap}}
@font-face{{font-family:'Sora';src:url(data:font/woff2;base64,{b64(U + '/fonts/sora.woff2')}) format('woff2');font-weight:100 800;font-display:swap}}
"""
# Boutons caméléon (style.css) : une police par style, sous licence libre (OFL, Apache pour Special Elite ; textes dans fonts/licences)
for fam, f, w, it in [('PX Neon', 'chakra-petch-700', 700, 0), ('PX Stade', 'barlow-condensed-800i', 800, 1), ('PX Epique', 'cinzel-700', 700, 0), ('PX Pop', 'baloo2-800', 800, 0),
                      ('PX Vitesse', 'racing-sans-one', 400, 0), ('PX Frisson', 'special-elite', 400, 0), ('PX Tactique', 'share-tech-mono', 400, 0)]:
    css += f"@font-face{{font-family:'{fam}';src:url(data:font/woff2;base64,{b64(U + '/fonts/' + f + '.woff2')}) format('woff2');font-weight:{w};font-style:{'italic' if it else 'normal'};font-display:swap}}\n"
for f in sorted(glob.glob(S + '/*.css')):
    css += open(f, encoding='utf8').read() + '\n'
ORDER = ['data.js', 'core.js', 'real.js', 'real-friends.js', 'fluid.js', 'pxtype.js', 'style.js', 'play.js', 'bar.js', 'live.js', 'clips.js', 'edit.js', 'pages.js', 'board.js', 'stats.js', 'atelier.js', 'news.js', 'settings.js', 'flows.js', 'moments.js', 'main.js']
js = open(U + '/constants.js', encoding='utf8').read() + '\n' + open(U + '/.shared.js', encoding='utf8').read() + '\n'
# Un fichier de ORDER absent, ou un fichier de src/ hors de ORDER, arrête le build : rien ne disparaît en silence
manque = [f for f in ORDER if not os.path.exists(f'{S}/{f}')]
oublie = sorted(set(os.path.basename(f) for f in glob.glob(S + '/*.js')) - set(ORDER))
if manque or oublie:
    sys.exit(f'build.py : absents de src/ {manque}, absents de ORDER {oublie}')
for f in ORDER:
    js += f'\n// ---- {f}\n' + open(f'{S}/{f}', encoding='utf8').read()
# Allègement : espaces et syntaxe pour le JS (les noms restent : les modules se parlent par leurs noms globaux), tout pour le CSS
def minify(src, loader, opts):
    r = subprocess.run(esb() + ['--loader=' + loader, '--target=chrome130', '--charset=utf8', '--log-level=warning'] + opts, input=src.encode('utf8'), capture_output=True, cwd=R)
    if r.returncode:
        sys.exit(f'build.py : esbuild a refusé le {loader}\n' + r.stderr.decode('utf8', 'replace'))
    return r.stdout.decode('utf8')
js = minify(js, 'js', ['--minify-whitespace', '--minify-syntax'])
css = minify(css, 'css', ['--minify'])
html = """<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: blob: https: pxclip:; media-src 'self' blob: pxclip:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self'; connect-src 'self' pxclip:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<title>Player X V3 Test</title>
<link rel="stylesheet" href="app.css">
</head>
<body>
<div id="root"><main id="stage"><div id="win" data-view="play"></div></main></div>
<script src="app.js"></script>
</body>
</html>
"""
def write(base):
    os.makedirs(base + '/assets', exist_ok=True)
    open(base + '/index.html', 'w', encoding='utf8').write(html)
    open(base + '/app.js', 'w', encoding='utf8').write(js)
    open(base + '/app.css', 'w', encoding='utf8').write(css)
    # Les images sont recopiées à neuf : une image retirée de v3ui/assets ne part plus dans l'exe
    shutil.rmtree(base + '/assets')
    shutil.copytree(U + '/assets', base + '/assets')
write(OUT)
if os.path.isdir(R + '/out/renderer'):
    write(R + '/out/renderer/v3')
print('app.js', len(js) // 1024, 'Ko, app.css', len(css) // 1024, 'Ko')
