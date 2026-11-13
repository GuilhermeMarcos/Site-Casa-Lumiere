// Liga a API a um Postgres embutido (PGlite) e a uma pasta de fotos, para testar sem a Vercel.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { usarBanco } from '../api/_lib/db.js';
import { usarArmazenamento } from '../api/_lib/armazenamento.js';

export async function preparar({ pastaBanco, pastaUploads } = {}) {
  process.env.JWT_SECRET ||= 'segredo-so-para-teste-local-123';
  process.env.ADMIN_EMAIL ||= 'equipe@casalumiere.com.br';
  process.env.CODIGO_EQUIPE ||= 'lumiere';
  const pg = new PGlite(pastaBanco);
  await pg.waitReady;
  usarBanco({
    q: async (t, p = []) => (await pg.query(t, p)).rows,
    tx: (lista) => pg.transaction(async (t) => {
      const out = [];
      for (const [texto, params] of lista) out.push((await t.query(texto, params || [])).rows);
      return out;
    }),
  });
  usarArmazenamento(async (caminho, corpo) => {
    const nome = caminho.replace(/\//g, '-');
    if (pastaUploads) {
      await mkdir(pastaUploads, { recursive: true });
      await writeFile(join(pastaUploads, nome), corpo);
    }
    return '/dev-uploads/' + nome;
  });
  return pg;
}
