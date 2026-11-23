// Liga a API a um Postgres embutido (PGlite) e a uma pasta de fotos, para testar sem a Vercel.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { usarBanco } from '../api/_lib/db.js';
import { usarArmazenamento } from '../api/_lib/armazenamento.js';
import { usarCorreio } from '../api/_lib/correio.js';

// E-mails "enviados" no teste ficam aqui (e aparecem no terminal do npm run dev)
export const caixaDeEntrada = [];

export async function preparar({ pastaBanco, pastaUploads, correio = false, mostrarEmails = false } = {}) {
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
  if (correio) usarCorreio(async (m) => {
    caixaDeEntrada.push(m);
    if (mostrarEmails) console.log(`\n[e-mail para ${m.para}] ${m.assunto}\n`);
  });
  return pg;
}

// Liga a verificação em duas etapas da conta da equipe nos testes (como as meninas fazem pelo painel)
export async function ligar2fa(api) {
  const { codigoNoPasso, passoAtual } = await import('../api/_lib/doisfatores.js');
  const i = await api('POST', '/api/admin/2fa/iniciar', { codigoEquipe: process.env.CODIGO_EQUIPE });
  if (i.status !== 200) throw new Error('iniciar 2fa: ' + i.status + ' ' + JSON.stringify(i.dados));
  const a = await api('POST', '/api/admin/2fa/ativar', { codigo: codigoNoPasso(i.dados.segredo, passoAtual()) });
  if (a.status !== 200) throw new Error('ativar 2fa: ' + a.status + ' ' + JSON.stringify(a.dados));
  return { segredo: i.dados.segredo, codigos: a.dados.codigos };
}
// Código do aplicativo: cada chamada adianta o relógio em 30 segundos (cada código só vale uma vez)
let desvio = 0;
export async function codigoApp(segredo) {
  const { codigoNoPasso, passoAtual, usarRelogio } = await import('../api/_lib/doisfatores.js');
  desvio += 30000;
  usarRelogio(() => Date.now() + desvio);
  return codigoNoPasso(segredo, passoAtual());
}
