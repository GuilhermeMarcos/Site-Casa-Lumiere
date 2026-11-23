// Contas: senha com scrypt, sessão assinada em cookie HttpOnly, acesso da equipe por e-mail.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';
import { Falha, lerCookies, ipLimite } from './http.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'cl_sessao';
// Segunda etapa da conta da equipe (código por e-mail, ou o código da equipe enquanto o e-mail não estiver ligado)
export const exigir2fa = () => process.env.EQUIPE_2FA !== '0';
const LONGA = 30 * 24 * 3600; // "manter conectado": 30 dias
const CURTA = 12 * 3600;      // sem "manter conectado": 12 horas

function segredo() {
  const s = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Falha(503, 'sem_segredo', 'A chave das sessões (JWT_SECRET) ainda não foi configurada na Vercel.');
  return s;
}

/* ===== Senhas ===== */
export async function gerarHash(senha) {
  const sal = randomBytes(16);
  const h = await scryptAsync(senha, sal, 64);
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

// Hash de mentira: quando o e-mail não existe, a conta leva o mesmo tempo, e ninguém descobre quem tem conta pelo relógio
const HASH_FALSO = gerarHash('senha-que-ninguem-usa-' + Math.random());

export async function conferirSenha(senha, guardado) {
  const [tipo, sal, hash] = String(guardado || (await HASH_FALSO)).split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const h = await scryptAsync(String(senha), Buffer.from(sal, 'base64'), esperado.length);
  return timingSafeEqual(h, esperado) && !!guardado;
}

const COMUNS = new Set(['12345678', '123456789', '1234567890', '87654321', '11111111', '00000000', '12341234', '11223344',
  'senha123', 'senha1234', 'senha12345', 'password', 'password1', 'qwerty123', 'abc12345', 'abcd1234', 'iloveyou',
  'casalumiere', 'lumiere123', 'holambra', 'holambra123', 'mudar123', 'admin123', 'brasil123', 'teste123']);

// Senha nova: pelo menos 8 caracteres (12 para a equipe), não pode ser uma das mais usadas nem o próprio e-mail
export function checarSenhaNova(senha, email = '') {
  const s = String(senha || '');
  if (s.length > 200) throw new Falha(400, 'senha', 'A senha pode ter até 200 caracteres.');
  if (ehEquipe(email) && s.length < 12) throw new Falha(400, 'senha', 'A senha da equipe precisa ter pelo menos 12 caracteres. Dica: use uma frase, como "sala-dourada-de-holambra".');
  if (s.length < 8) throw new Falha(400, 'senha', 'A senha precisa ter pelo menos 8 caracteres.');
  const baixa = s.toLowerCase();
  if (COMUNS.has(baixa) || /^(.)\1+$/.test(s) || (email && (baixa === email.toLowerCase() || baixa === email.split('@')[0].toLowerCase()))) {
    throw new Falha(400, 'senha_fraca', 'Essa senha é fácil de adivinhar. Use uma combinação diferente.');
  }
}

/* ===== Sessão =====
   O token leva a "versão da sessão" da conta. Trocar ou redefinir a senha aumenta a versão,
   e todos os aparelhos que estavam conectados saem na hora. */
const b64 = (s) => Buffer.from(s).toString('base64url');
const assinar = (dados) => createHmac('sha256', segredo()).update(dados).digest('base64url');
export const assinarTexto = (t) => assinar(t);

function criarToken(uid, versao, segundos, mfa) {
  const corpo = b64(JSON.stringify({ u: uid, v: versao || 0, e: Math.floor(Date.now() / 1000) + segundos, ...(mfa ? { m: 1 } : {}) }));
  return `${corpo}.${assinar(corpo)}`;
}

function lerToken(token) {
  const [corpo, ass, sobra] = String(token || '').split('.');
  if (!corpo || !ass || sobra !== undefined || corpo.length > 400) return null;
  const certo = Buffer.from(assinar(corpo));
  const veio = Buffer.from(ass);
  if (certo.length !== veio.length || !timingSafeEqual(certo, veio)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (typeof p.u !== 'string' || !p.e || p.e < Date.now() / 1000) return null;
    return { uid: p.u, versao: Number(p.v) || 0, mfa: p.m === 1 };
  } catch {
    return null;
  }
}

function seguro(req) {
  const proto = req.headers['x-forwarded-proto'];
  return proto ? proto.split(',')[0].trim() === 'https' : !!(req.socket && req.socket.encrypted);
}

// mfa: a pessoa passou pela verificação em duas etapas nesta entrada (só conta para a equipe)
export function cookieSessao(req, uid, versao, lembrar, mfa = false) {
  const seg = lembrar ? LONGA : CURTA;
  const partes = [`${COOKIE}=${criarToken(uid, versao, seg, mfa)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (lembrar) partes.push(`Max-Age=${seg}`);
  if (seguro(req)) partes.push('Secure');
  return partes.join('; ');
}

export function cookieSair(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro(req) ? '; Secure' : ''}`;
}

/* ===== Equipe ===== */
export function emailsEquipe() {
  return String(process.env.ADMIN_EMAIL || process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}
export const ehEquipe = (email) => emailsEquipe().includes(String(email || '').toLowerCase());

export function publico(u) {
  return { id: u.id, nome: u.nome, email: u.email, telefone: u.telefone, especialidade: u.especialidade, equipe: ehEquipe(u.email) };
}

// Usuário da sessão, ou null
export async function usuarioAtual(req) {
  const t = lerToken(lerCookies(req)[COOKIE]);
  if (!t) return null;
  const [u] = await q('SELECT id, nome, email, telefone, especialidade, sessao_versao FROM usuarios WHERE id = $1', [t.uid]);
  if (!u || Number(u.sessao_versao) !== t.versao) return null;
  u.mfa = t.mfa;
  return u;
}

export async function exigirLogin(req) {
  const u = await usuarioAtual(req);
  if (!u) throw new Falha(401, 'sem_login', 'Entre na sua conta para continuar.');
  return u;
}

/* Equipe: além da senha, a sessão precisa ter passado pela segunda etapa
   (código que chega no e-mail da equipe). Sessões antigas, só com a senha, precisam entrar de novo. */
export async function exigirEquipe(req) {
  const u = await exigirLogin(req);
  if (!ehEquipe(u.email)) throw new Falha(403, 'sem_acesso', 'Esta área é só para a equipe da Casa.');
  if (exigir2fa() && !u.mfa) throw new Falha(401, 'precisa_codigo', 'Por segurança, entre de novo. Vamos pedir um código.');
  return u;
}

/* ===== Limites contra força bruta e abuso =====
   Contador por chave numa janela de tempo. Passou do máximo, responde 429 até a janela acabar. */
export async function limitar(chave, max, segundos, mensagem) {
  const [r] = await q(
    `INSERT INTO limites (chave, contagem, janela_ate) VALUES ($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT (chave) DO UPDATE SET
       contagem = CASE WHEN limites.janela_ate < now() THEN 1 ELSE limites.contagem + 1 END,
       janela_ate = CASE WHEN limites.janela_ate < now() THEN now() + make_interval(secs => $2) ELSE limites.janela_ate END
     RETURNING contagem`,
    [chave.slice(0, 200), segundos],
  );
  if (r.contagem > max) throw new Falha(429, 'muitas_tentativas', mensagem || 'Muitas tentativas seguidas. Espere alguns minutos e tente de novo.');
}

// Trava de senha errada: por e-mail E aparelho (IP). Assim ninguém consegue trancar a conta da equipe errando de propósito de outro lugar.
const chaveTrava = (email, req) => `${String(email).toLowerCase()}|${ipLimite(req)}`;
export async function checarBloqueio(email, req) {
  const [t] = await q('SELECT bloqueado_ate FROM tentativas WHERE email = $1 AND bloqueado_ate > now()', [chaveTrava(email, req)]);
  if (t) throw new Falha(429, 'bloqueado', 'Muitas tentativas com este e-mail. Espere 15 minutos e tente de novo.');
}
export async function registrarFalha(email, req) {
  await q(
    `INSERT INTO tentativas (email, falhas) VALUES ($1, 1)
     ON CONFLICT (email) DO UPDATE SET
       falhas = CASE WHEN tentativas.falhas + 1 >= 8 THEN 0 ELSE tentativas.falhas + 1 END,
       bloqueado_ate = CASE WHEN tentativas.falhas + 1 >= 8 THEN now() + interval '15 minutes' ELSE tentativas.bloqueado_ate END`,
    [chaveTrava(email, req)],
  );
}
export const limparFalhas = (email, req) => q('DELETE FROM tentativas WHERE email = $1', [chaveTrava(email, req)]);

// No site de verdade, o código da equipe não pode ser o de teste nem curto demais
export function codigoEquipeFraco() {
  const c = String(process.env.CODIGO_EQUIPE || '');
  return process.env.VERCEL_ENV === 'production' && (c.length < 10 || c.toLowerCase() === 'lumiere');
}
export function codigoEquipeConfere(codigo) {
  const certo = String(process.env.CODIGO_EQUIPE || '');
  if (!certo || codigoEquipeFraco()) return false;
  const a = Buffer.from(String(codigo || '')), b = Buffer.from(certo);
  return a.length === b.length && timingSafeEqual(a, b);
}
