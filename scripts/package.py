"""Create a loadable extension archive without dependencies or development files."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / 'manifest.json').read_text())
package = json.loads((root / 'package.json').read_text())
assert manifest['version'] == package['version'], 'Version declarations must agree'
files = ['LICENSE', 'README.md', 'manifest.json', 'popup.html', 'src/popup.js', 'src/popup.css']
files += manifest['content_scripts'][0]['js']
assert all((root / name).is_file() for name in files)
destination = root / 'dist' / f'Oh-my-Caton-{manifest["version"]}.zip'
destination.parent.mkdir(exist_ok=True)
with ZipFile(destination, 'w', ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
print(destination)
