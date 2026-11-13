// Servidor para testar no seu computador, sem Vercel: `npm install` e depois `npm run dev`.
// Usa um Postgres embutido (PGlite) salvo em dev/.banco e guarda as fotos em dev/uploads.
// Conta da equipe para teste: crie a conta com o e-mail equipe@casalumiere.com.br e o código "lumiere".
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparar } from './preparar.mjs';
import handler from '../api/index.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = Number(process.env.PORT || 3000);
process.env.JWT_SECRET ||= 'segredo-so-para-teste-local-123';
process.env.ADMIN_EMAIL ||= 'equipe@casalumiere.com.br';
process.env.CODIGO_EQUIPE ||= 'lumiere';

const UPLOADS = join(RAIZ, 'dev', 'uploads');
await preparar({ pastaBanco: join(RAIZ, 'dev', '.banco'), pastaUploads: UPLOADS });

const TIPOS = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain',
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  if (url.pathname.startsWith('/api/')) return handler(req, res);
  let arquivo = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const base = arquivo.startsWith('/dev-uploads/') ? UPLOADS : RAIZ;
  if (base === UPLOADS) arquivo = arquivo.slice('/dev-uploads'.length);
  const alvo = normalize(join(base, arquivo));
  const primeira = alvo.slice(base.length).split(/[\\/]/).filter(Boolean)[0] || '';
  const proibida = base === RAIZ && ['api', 'dev', 'docs', 'node_modules', '.git'].includes(primeira);
  if (!alvo.startsWith(base) || proibida) {
    res.statusCode = 404; return res.end('404');
  }
  try {
    await stat(alvo);
    res.setHeader('Content-Type', TIPOS[extname(alvo)] || 'application/octet-stream');
    res.end(await readFile(alvo));
  } catch {
    res.statusCode = 404; res.end('404');
  }
}).listen(PORTA, () => console.log(`Casa Lumière rodando em http://localhost:${PORTA}`));
