// Códigos de 6 números enviados por e-mail: confirmar o e-mail no cadastro e recuperar a senha.
// O código nunca fica salvo como está: só o HMAC dele. Vale 10 minutos, aceita 5 tentativas e só pode ser usado uma vez.
import { randomInt, timingSafeEqual } from 'node:crypto';
import { q } from './db.js';
import { Falha } from './http.js';
import { assinarTexto, limitar } from './auth.js';

const VALIDADE_MIN = 10;
const MAX_TENTATIVAS = 5;
const marca = (email, finalidade, codigo) => assinarTexto(`codigo|${finalidade}|${email}|${codigo}`);

export async function criarCodigo(email, finalidade) {
  // Um e-mail por minuto e no máximo 5 por hora para o mesmo endereço
  await limitar(`codigo-1min|${finalidade}|${email}`, 1, 60, 'Espere um minuto para pedir outro código.');
  await limitar(`codigo-1h|${finalidade}|${email}`, 5, 3600, 'Você pediu muitos códigos. Tente de novo mais tarde.');
  const codigo = String(randomInt(0, 1000000)).padStart(6, '0');
  await q(
    `INSERT INTO codigos (email, finalidade, codigo_hash, tentativas, expira_em) VALUES ($1, $2, $3, 0, now() + interval '${VALIDADE_MIN} minutes')
     ON CONFLICT (email, finalidade) DO UPDATE SET codigo_hash = EXCLUDED.codigo_hash, tentativas = 0, expira_em = EXCLUDED.expira_em`,
    [email, finalidade, marca(email, finalidade, codigo)],
  );
  return codigo;
}

// Confere e gasta o código. Erro se estiver errado, vencido ou já usado.
export async function usarCodigo(email, finalidade, codigo) {
  const limpo = String(codigo || '').replace(/\D/g, '');
  const [linha] = await q('SELECT codigo_hash, tentativas FROM codigos WHERE email = $1 AND finalidade = $2 AND expira_em > now()', [email, finalidade]);
  if (!linha) throw new Falha(400, 'codigo_vencido', 'Esse código venceu ou já foi usado. Peça um novo.');
  if (linha.tentativas >= MAX_TENTATIVAS) {
    await q('DELETE FROM codigos WHERE email = $1 AND finalidade = $2', [email, finalidade]);
    throw new Falha(400, 'codigo_vencido', 'Muitas tentativas com esse código. Peça um novo.');
  }
  const certo = Buffer.from(linha.codigo_hash), veio = Buffer.from(marca(email, finalidade, limpo));
  if (limpo.length !== 6 || certo.length !== veio.length || !timingSafeEqual(certo, veio)) {
    await q('UPDATE codigos SET tentativas = tentativas + 1 WHERE email = $1 AND finalidade = $2', [email, finalidade]);
    throw new Falha(400, 'codigo_errado', 'Código incorreto. Confira o e-mail e digite de novo.');
  }
  await q('DELETE FROM codigos WHERE email = $1 AND finalidade = $2', [email, finalidade]);
}
