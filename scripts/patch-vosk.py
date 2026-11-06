"""Apply our streaming asset adapter to upstream vosk-browser 0.0.8.
Run against an unmodified npm dist/vosk.js; the script is idempotent.
"""
import base64,re,pathlib
root=pathlib.Path(__file__).resolve().parent.parent
path=root/'dist/vendor/vosk.js'
s=path.read_text()
match=re.search(r"createBase64WorkerFactory\('([^']+)'",s)
worker=base64.b64decode(match[1]).decode()
if not worker.startswith('// A same-origin, streaming'):
    worker=(root/'scripts/model-fetch-worker.js').read_text()+'\n'+worker
    s=s[:match.start(1)]+base64.b64encode(worker.encode()).decode()+s[match.end(1):]
    path.write_text(s)
