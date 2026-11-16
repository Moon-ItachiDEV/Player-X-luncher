#!/usr/bin/env python3
# Une horloge à l'écran, sous X, pour les essais où le moteur vidéo filme l'écran (t21) : un carré noir qui passe au blanc à
# des instants connus, 150 ms chaque fois. Le carré est une fenêtre à part, hors de l'appli : une page occupée ne le retarde
# pas. Les flashs ne sont pas réguliers (écarts de 0,9 à 2,5 s, tous différents, sur un cycle de 10 s calé sur l'heure du
# système) : un fichier daté de travers, même d'un nombre rond de secondes, ne retombe sur aucun flash. Ils ne tombent pas
# non plus toujours au même endroit entre deux images d'une capture à 30 ou 60 images par seconde.
# Usage : xflash.py X Y LARGEUR HAUTEUR
# Écrit une ligne par flash : « F <avant> <après> », l'heure du système (ms) juste avant de demander le blanc, puis une fois
# que le serveur X l'a peint. S'arrête quand on le tue, ou quand plus personne ne lit sa sortie.
import ctypes, sys, time

OFFSETS_MS = (0, 910, 2120, 3630, 5440, 7550)
CYCLE_MS = 10000
FLASH_MS = 150

class Attrs(ctypes.Structure):
    _fields_ = [('background_pixmap', ctypes.c_ulong), ('background_pixel', ctypes.c_ulong), ('border_pixmap', ctypes.c_ulong),
                ('border_pixel', ctypes.c_ulong), ('bit_gravity', ctypes.c_int), ('win_gravity', ctypes.c_int),
                ('backing_store', ctypes.c_int), ('backing_planes', ctypes.c_ulong), ('backing_pixel', ctypes.c_ulong),
                ('save_under', ctypes.c_int), ('event_mask', ctypes.c_long), ('do_not_propagate_mask', ctypes.c_long),
                ('override_redirect', ctypes.c_int), ('colormap', ctypes.c_ulong), ('cursor', ctypes.c_ulong)]

x = ctypes.cdll.LoadLibrary('libX11.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XOpenDisplay.argtypes = [ctypes.c_char_p]
for name in ('XDefaultScreen', 'XFlush'):
    getattr(x, name).argtypes = [ctypes.c_void_p]
for name in ('XDefaultRootWindow', 'XBlackPixel', 'XWhitePixel'):
    getattr(x, name).restype = ctypes.c_ulong
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XBlackPixel.argtypes = [ctypes.c_void_p, ctypes.c_int]
x.XWhitePixel.argtypes = [ctypes.c_void_p, ctypes.c_int]
x.XCreateWindow.restype = ctypes.c_ulong
x.XCreateWindow.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_uint,
                            ctypes.c_int, ctypes.c_uint, ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(Attrs)]
for name in ('XMapRaised', 'XRaiseWindow', 'XClearWindow'):
    getattr(x, name).argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XSetWindowBackground.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong]
x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]

if len(sys.argv) != 5:
    sys.exit('usage : xflash.py X Y LARGEUR HAUTEUR')
left, top, width, height = (int(v) for v in sys.argv[1:5])
d = x.XOpenDisplay(None)
assert d, 'pas de display'
screen = x.XDefaultScreen(d)
black, white = x.XBlackPixel(d, screen), x.XWhitePixel(d, screen)
# Ni cadre ni gestionnaire de fenêtres : la fenêtre se place où on le dit (override_redirect), fond noir.
attrs = Attrs(background_pixel=black, override_redirect=1)
CW_BACK_PIXEL, CW_OVERRIDE_REDIRECT, INPUT_OUTPUT = 1 << 1, 1 << 9, 1
w = x.XCreateWindow(d, x.XDefaultRootWindow(d), left, top, width, height, 0, 0, INPUT_OUTPUT, None, CW_BACK_PIXEL | CW_OVERRIDE_REDIRECT, ctypes.byref(attrs))
x.XMapRaised(d, w)
x.XSync(d, 0)

def paint(color):
    # Repassée devant à chaque fois : une fenêtre de l'appli ouverte entre-temps ne la cache pas.
    x.XSetWindowBackground(d, w, color)
    x.XRaiseWindow(d, w)
    x.XClearWindow(d, w)
    x.XSync(d, 0)

def wait_until(ms):
    while True:
        left_ms = ms - time.time() * 1000
        if left_ms <= 0:
            return
        # Le sommeil du système est précis à une milliseconde près : les deux dernières sont attendues en boucle.
        if left_ms > 2:
            time.sleep((left_ms - 2) / 1000)

def next_flash(now_ms):
    base = int(now_ms // CYCLE_MS) * CYCLE_MS
    for cycle in (base, base + CYCLE_MS):
        for off in OFFSETS_MS:
            if cycle + off > now_ms + 20:
                return cycle + off

print('PRET %d %d %d %d' % (left, top, width, height), flush=True)
try:
    while True:
        at = next_flash(time.time() * 1000)
        wait_until(at)
        before = time.time() * 1000
        paint(white)
        after = time.time() * 1000
        print('F %.1f %.1f' % (before, after), flush=True)
        wait_until(at + FLASH_MS)
        paint(black)
except (KeyboardInterrupt, BrokenPipeError):
    pass
