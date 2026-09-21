#!/usr/bin/env python3
"""Build a deterministic, runtime-only Chrome ZIP; no secrets or preview tooling."""
import hashlib
import json
import re
import subprocess
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'movie-notes-extension'
OUT = ROOT / 'dist'
FILES = '''manifest.json background.js player-dock.js library-presence.js content.js panel.html panel.js panel.css
design.css theme.css cursor.css glass-grain.svg share.html share.js share.css
icons/icon16.png icons/icon32.png icons/icon48.png icons/icon128.png
vendor/marked.min.js vendor/qrcode-generator.js
utils/notion.js utils/storage.js utils/help-snap.js utils/platform.js utils/common.js
utils/local-data.js utils/supabase.js utils/sync.js utils/sync-feedback.js utils/merge.js'''.split()

def main():
    manifest = json.loads((SOURCE / 'manifest.json').read_text())
    version = manifest['version']
    assert re.fullmatch(r'\d+\.\d+\.\d+', version), 'Invalid version'
    assert manifest['manifest_version'] == 3
    content = (SOURCE / 'content.js').read_text()
    assert f"__asideContentLoaded = '{version}'" in content, 'Content script version mismatch'
    assert manifest.get('key'), 'Keep the existing public extension key to preserve its ID'
    for name in FILES:
        path = SOURCE / name
        assert path.is_file() and not path.is_symlink(), f'Missing/linked file: {name}'
        if path.suffix == '.js':
            subprocess.run(['node', '--check', str(path)], check=True, capture_output=True)
        if path.suffix in {'.html', '.js', '.css', '.json'}:
            text = path.read_text()
            assert not re.search(r'__agentation|data-agentation|localhost:4747|127\.0\.0\.1:4173', text), f'Preview code: {name}'
            # Check static HTML/CSS/module dependencies against the release allowlist.
            patterns = [r'(?:src|href)=["\']([^"\']+)["\']'] if path.suffix == '.html' else []
            if path.suffix == '.css':
                patterns += [r'url\(["\']?([^\)"\']+)', r'@import\s+["\']([^"\']+)']
            if path.suffix == '.js':
                patterns += [r'\bfrom\s+["\'](\.[^"\']+)["\']']
            for pattern in patterns:
                for ref in re.findall(pattern, text):
                    if ref.startswith(('#', '/', 'data:', 'http:', 'https:', 'mailto:')):
                        continue
                    ref = ref.split('?')[0].split('#')[0]
                    target = (path.parent / ref).resolve().relative_to(SOURCE).as_posix()
                    assert target in FILES, f'Unpackaged dependency: {name} -> {target}'
    required = [manifest['background']['service_worker'], *manifest['icons'].values(), *manifest['action']['default_icon'].values()]
    for script in manifest['content_scripts']:
        required += script.get('js', []) + script.get('css', [])
    for entry in manifest['web_accessible_resources']:
        required += entry['resources']
    assert all(name in FILES for name in required), 'Manifest resource missing'
    OUT.mkdir(exist_ok=True)
    archive = OUT / f'aside-v{version}.zip'
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as bundle:
        for name in sorted(FILES):
            info = zipfile.ZipInfo(name, (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            bundle.writestr(info, (SOURCE / name).read_bytes())
    with zipfile.ZipFile(archive) as bundle:
        assert bundle.testzip() is None
        assert json.loads(bundle.read('manifest.json'))['version'] == version
        assert set(bundle.namelist()) == set(FILES)
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    (OUT / f'{archive.name}.sha256').write_text(f'{digest}  {archive.name}\n')
    print(f'{archive}\n{len(FILES)} runtime files; {archive.stat().st_size:,} bytes; SHA256 {digest}')

if __name__ == '__main__':
    main()
