"""Copy source into isolated local browser fixtures; never serve the project root."""
from pathlib import Path
import json
import shutil

root = Path(__file__).resolve().parent.parent
fixture = Path('/private/tmp/aside-browser-fixture')
fixture.mkdir(exist_ok=True)
for name in ['movie-notes-extension', 'movie-notes-pwa']:
    shutil.copytree(root / name, fixture / name, dirs_exist_ok=True)
shutil.copyfile(root / 'movie-notes-extension/content.js', fixture / 'content.js')

# Test-only host grant emulates toolbar activeTab authorization in automation.
# The release manifest is never modified.
polish = Path('/private/tmp/aside-172-extension-fixture')
shutil.copytree(root / 'movie-notes-extension', polish, dirs_exist_ok=True)
manifest_path = polish / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['host_permissions'].append('https://example.test/*')
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
background = polish / 'background.js'
background.write_text(background.read_text() + '\nglobalThis.__testToolbar = toggleLibrary;\n')
print('Isolated browser fixtures ready.')
