"""Servidor local para desenvolver o app: python serve.py  →  http://localhost:8000

O index.html não tem <!doctype>/<head>/<body> porque é publicado como Artifact do claude.ai, que acrescenta
esse esqueleto na hora de publicar. Aqui o servidor faz o mesmo para a página "/".
"""
import http.server, os, socketserver, sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
ROOT = os.path.dirname(os.path.abspath(__file__))
SKELETON = ('<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>{}</body></html>')


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)

    def do_GET(self):
        if self.path.split('?')[0] in ('/', '/index.html'):
            body = SKELETON.format(open(os.path.join(ROOT, 'index.html'), encoding='utf-8').read()).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            super().do_GET()


Handler.extensions_map.update({'.js': 'text/javascript', '.json': 'application/json'})
with socketserver.ThreadingTCPServer(('127.0.0.1', PORT), Handler) as s:
    print(f'Andrelândia Rural em http://localhost:{PORT}')
    s.serve_forever()
