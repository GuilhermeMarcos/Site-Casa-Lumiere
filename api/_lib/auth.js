// Contas: senha com scrypt, sessão assinada em cookie HttpOnly, acesso da equipe por e-mail.
import { scrypt, randomBytes, timingSafeEqual, createHmac } from 'node:crypto';
import { promisify } from 'node:util';
import { q } from './db.js';
import { Falha, lerCookies } from './http.js';

const scryptAsync = promisify(scrypt);
const COOKIE = 'cl_sessao';
const LONGA = 30 * 24 * 3600; // "manter conectado": 30 dias
const CURTA = 12 * 3600;      // sem "manter conectado": 12 horas

function segredo() {
  const s = process.env.JWT_SECRET || process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Falha(503, 'sem_segredo', 'A chave das sessões (JWT_SECRET) ainda não foi configurada na Vercel.');
  return s;
}

export async function gerarHash(senha) {
  const sal = randomBytes(16);
  const h = await scryptAsync(senha, sal, 64);
  return `scrypt$${sal.toString('base64')}$${h.toString('base64')}`;
}

export async function conferirSenha(senha, guardado) {
  const [tipo, sal, hash] = String(guardado || '').split('$');
  if (tipo !== 'scrypt' || !sal || !hash) return false;
  const esperado = Buffer.from(hash, 'base64');
  const h = await scryptAsync(senha, Buffer.from(sal, 'base64'), esperado.length);
  return timingSafeEqual(h, esperado);
}

const b64 = (s) => Buffer.from(s).toString('base64url');
const assinar = (dados) => createHmac('sha256', segredo()).update(dados).digest('base64url');

function criarToken(uid, segundos) {
  const corpo = b64(JSON.stringify({ u: uid, e: Math.floor(Date.now() / 1000) + segundos }));
  return `${corpo}.${assinar(corpo)}`;
}

function lerToken(token) {
  const [corpo, ass] = String(token || '').split('.');
  if (!corpo || !ass) return null;
  const certo = Buffer.from(assinar(corpo));
  const veio = Buffer.from(ass);
  if (certo.length !== veio.length || !timingSafeEqual(certo, veio)) return null;
  try {
    const p = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    if (!p.u || !p.e || p.e < Date.now() / 1000) return null;
    return p.u;
  } catch {
    return null;
  }
}

function seguro(req) {
  const proto = req.headers['x-forwarded-proto'];
  return proto ? proto.split(',')[0].trim() === 'https' : !!(req.socket && req.socket.encrypted);
}

export function cookieSessao(req, uid, lembrar) {
  const seg = lembrar ? LONGA : CURTA;
  const partes = [`${COOKIE}=${criarToken(uid, seg)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (lembrar) partes.push(`Max-Age=${seg}`);
  if (seguro(req)) partes.push('Secure');
  return partes.join('; ');
}

export function cookieSair(req) {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${seguro(req) ? '; Secure' : ''}`;
}

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
  const uid = lerToken(lerCookies(req)[COOKIE]);
  if (!uid) return null;
  const [u] = await q('SELECT id, nome, email, telefone, especialidade FROM usuarios WHERE id = $1', [uid]);
  return u || null;
}

export async function exigirLogin(req) {
  const u = await usuarioAtual(req);
  if (!u) throw new Falha(401, 'sem_login', 'Entre na sua conta para continuar.');
  return u;
}

export async function exigirEquipe(req) {
  const u = await exigirLogin(req);
  if (!ehEquipe(u.email)) throw new Falha(403, 'sem_acesso', 'Esta área é só para a equipe da Casa.');
  return u;
}

// Trava de tentativas: depois de 8 senhas erradas no mesmo e-mail, espera 15 minutos
export async function checarBloqueio(email) {
  const [t] = await q('SELECT bloqueado_ate FROM tentativas WHERE email = $1 AND bloqueado_ate > now()', [email]);
  if (t) throw new Falha(429, 'bloqueado', 'Muitas tentativas com este e-mail. Espere 15 minutos e tente de novo.');
}
export async function registrarFalha(email) {
  await q(
    `INSERT INTO tentativas (email, falhas) VALUES ($1, 1)
     ON CONFLICT (email) DO UPDATE SET
       falhas = CASE WHEN tentativas.falhas + 1 >= 8 THEN 0 ELSE tentativas.falhas + 1 END,
       bloqueado_ate = CASE WHEN tentativas.falhas + 1 >= 8 THEN now() + interval '15 minutes' ELSE tentativas.bloqueado_ate END`,
    [email],
  );
}
export const limparFalhas = (email) => q('DELETE FROM tentativas WHERE email = $1', [email]);

export function codigoEquipeConfere(codigo) {
  const certo = String(process.env.CODIGO_EQUIPE || '');
  if (!certo) return false;
  const a = Buffer.from(String(codigo || '')), b = Buffer.from(certo);
  return a.length === b.length && timingSafeEqual(a, b);
}
