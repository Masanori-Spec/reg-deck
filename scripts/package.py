#!/usr/bin/env python3
"""Freeze review artifacts without dependencies, secrets or browser binaries."""
from pathlib import Path
import hashlib
import json
import zipfile
root = Path(__file__).resolve().parent.parent
out = root.parent / 'reg-deck-output'
out.mkdir(exist_ok=True)
excluded = {'node_modules', '.git', 'dist', '__pycache__', 'artifacts'}
files = sorted(p for p in root.rglob('*') if p.is_file() and not any(x in excluded for x in p.relative_to(root).parts) and p.suffix not in {'.pyc', '.log'})
def digest(path):
    data = path.read_bytes()
    return {'path': path.relative_to(root).as_posix(), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'gitBlobSha': hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()}
manifest = {'project': 'RegDeck', 'version': '0.1.0', 'files': [digest(p) for p in files]}
(out/'source-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')
archives = []
for name, items, prefix, relative in [('reg-deck-source.zip', files, 'reg-deck/', root), ('reg-deck-static.zip', sorted(p for p in (root/'dist').rglob('*') if p.is_file()), '', root/'dist')]:
    with zipfile.ZipFile(out/name, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in items:
            info=zipfile.ZipInfo(prefix+path.relative_to(relative).as_posix(), date_time=(1980,1,1,0,0,0))
            info.compress_type=zipfile.ZIP_DEFLATED
            info.external_attr=0o644 << 16
            archive.writestr(info,path.read_bytes())
    data=(out/name).read_bytes()
    archives.append({'filename':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()})
(out/'archive-manifest.json').write_text(json.dumps(archives,indent=2)+'\n')
print(json.dumps({'sourceFiles':len(files),'archives':archives},indent=2))
