#!/usr/bin/env python3
# Appuie sur une combinaison de touches sous X (XTest), pour essayer le raccourci global. Usage : xkey.py Alt_L c
import ctypes, sys, time
x = ctypes.cdll.LoadLibrary('libX11.so.6'); t = ctypes.cdll.LoadLibrary('libXtst.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
x.XStringToKeysym.restype = ctypes.c_ulong
x.XStringToKeysym.argtypes = [ctypes.c_char_p]
x.XFlush.argtypes = [ctypes.c_void_p]
t.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = x.XOpenDisplay(None)
assert d, 'pas de display'
codes = [x.XKeysymToKeycode(d, x.XStringToKeysym(k.encode())) for k in sys.argv[1:]]
for c in codes:
    t.XTestFakeKeyEvent(d, c, 1, 0); x.XFlush(d); time.sleep(0.05)
for c in reversed(codes):
    t.XTestFakeKeyEvent(d, c, 0, 0); x.XFlush(d); time.sleep(0.05)
print('touches envoyées', codes)
