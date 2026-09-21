#!/usr/bin/env python3
"""Export the approved hand-drawn Aside master to app icon sizes on macOS.

Creative edits belong in the master asset; this script only frames and scales exports.
Run from any working directory: python3 gen_icons.py
"""
from pathlib import Path
import base64
import subprocess
from tempfile import TemporaryDirectory

ROOT = Path(__file__).resolve().parent
MASTER = ROOT / 'brand/aside-film-transparent/aside-icon-purple.png'
if not MASTER.is_file():
    raise SystemExit(f'Missing approved master: {MASTER}')
# The approved 1254px master has generous outside padding. A centered 980px
# export frame enlarges the same drawing by 28%, while retaining clear alpha
# padding on every side. The master and the drawing itself stay untouched.
with TemporaryDirectory(prefix='aside-icon-export-') as folder:
    framed = Path(folder) / 'framed.png'
    subprocess.run(['sips', '-c', '980', '980', str(MASTER), '--out', str(framed)], check=True)
    for size in (16, 32, 48, 128):
        target = ROOT / f'movie-notes-extension/icons/icon{size}.png'
        subprocess.run(['sips', '-z', str(size), str(size), str(framed), '--out', str(target)], check=True)
    for size in (192, 512):
        target = ROOT / f'movie-notes-pwa/icons/icon-{size}.png'
        subprocess.run(['sips', '-z', str(size), str(size), str(framed), '--out', str(target)], check=True)
data = base64.b64encode((ROOT / 'movie-notes-pwa/icons/icon-512.png').read_bytes()).decode()
(ROOT / 'movie-notes-extension/icons/store-icon.svg').write_text(
    '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">'
    '<title>旁白 Aside</title><image width="128" height="128" href="data:image/png;base64,' + data + '"/></svg>\n')
