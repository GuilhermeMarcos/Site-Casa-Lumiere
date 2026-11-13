// Acesso ao Postgres. Na Vercel usa o driver HTTP da Neon (DATABASE_URL vem da integração).
// No teste local, dev/servidor.mjs troca a implementação por um Postgres embutido com usarBanco().
import { neon } from '@neondatabase/serverless';
import { Falha } from './http.js';

let impl = null;

export function usarBanco(nova) {
  impl = nova;
}

function banco() {
  if (impl) return impl;
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (!url) throw new Falha(503, 'sem_banco', 'O banco de dados ainda não foi ligado na Vercel.');
  const sql = neon(url);
  impl = {
    q: (texto, params = []) => sql.query(texto, params),
    tx: (lista) => sql.transaction(lista.map(([t, p]) => sql.query(t, p || []))),
  };
  return impl;
}

// Uma consulta: devolve as linhas
export const q = (texto, params) => banco().q(texto, params);

// Várias consultas numa transação: tudo ou nada. Devolve a lista de resultados (linhas de cada uma).
export const tx = (lista) => banco().tx(lista);

export function violouUnico(e) {
  return !!e && (e.code === '23505' || /duplicate key|unique constraint/i.test(e.message || ''));
}
