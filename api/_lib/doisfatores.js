// Verificação em duas etapas da conta da equipe: código de 6 números de um aplicativo autenticador
// (Google Authenticator, Microsoft Authenticator...). Padrão TOTP (RFC 6238), sem depender de serviço de fora.
import { createHmac, createHash, createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { Falha } from './http.js';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PASSO = 30; // segundos

export const exigir2fa = () => process.env.EQUIPE_2FA !== '0';

export function base32(buf) {
  let bits = 0, valor = 0, out = '';
  for (const b of buf) {
    valor = (valor << 8) | b; bits += 8;
    while (bits >= 5) { out += ALFABETO[(valor >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALFABETO[(valor << (5 - bits)) & 31];
  return out;
}
function deBase32(s) {
  let bits = 0, valor = 0; const out = [];
  for (const c of String(s).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    valor = (valor << 5) | ALFABETO.indexOf(c); bits += 5;
    if (bits >= 8) { out.push((valor >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export function codigoNoPasso(segredoB32, passo) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(passo));
  const h = createHmac('sha1', deBase32(segredoB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1e6).padStart(6, '0');
}
// O relógio pode ser trocado nos testes automáticos (dev/preparar.mjs), para simular o tempo passando
let relogio = () => Date.now();
export function usarRelogio(f) { relogio = f; }
export const passoAtual = (agora = relogio()) => Math.floor(agora / 1000 / PASSO);

// Confere o código aceitando 30 s de diferença no relógio do celular. Devolve o passo usado, ou null.
// Um código já usado não vale de novo (ultimoPasso), para ninguém reaproveitar um código visto por cima do ombro.
export function conferirCodigo(segredoB32, codigo, ultimoPasso = 0) {
  const c = String(codigo || '').replace(/\D/g, '');
  if (c.length !== 6) return null;
  const agora = passoAtual();
  for (const p of [agora - 1, agora, agora + 1]) {
    if (p <= Number(ultimoPasso || 0)) continue;
    const certo = Buffer.from(codigoNoPasso(segredoB32, p));
    if (timingSafeEqual(certo, Buffer.from(c))) return p;
  }
  return null;
}

export const novoSegredo = () => base32(randomBytes(20));

export function uriAutenticador(segredoB32, email) {
  const rotulo = encodeURIComponent('Casa Lumière:' + email);
  return `otpauth://totp/${rotulo}?secret=${segredoB32}&issuer=${encodeURIComponent('Casa Lumière')}&algorithm=SHA1&digits=6&period=${PASSO}`;
}

/* O segredo fica cifrado no banco (AES-256-GCM com chave derivada do JWT_SECRET):
   quem conseguisse copiar o banco não consegue gerar os códigos. */
function chave() {
  const s = process.env.JWT_SECRET || process.env.SESSION_SECRET || '';
  if (s.length < 16) throw new Falha(503, 'sem_segredo', 'A chave das sessões (JWT_SECRET) ainda não foi configurada na Vercel.');
  return createHash('sha256').update('casa-lumiere|2fa|' + s).digest();
}
export function cifrar(texto) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', chave(), iv);
  const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), corpo.toString('base64')].join('.');
}
export function decifrar(guardado) {
  const [v, iv, tag, corpo] = String(guardado || '').split('.');
  if (v !== 'v1') return null;
  try {
    const d = createDecipheriv('aes-256-gcm', chave(), Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(corpo, 'base64')), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/* Códigos de recuperação: 8 códigos de uso único para quando o celular não estiver à mão.
   No banco fica só o hash. */
export const hashRecuperacao = (c) => createHmac('sha256', chave()).update(String(c).toLowerCase().replace(/[^a-z0-9]/g, '')).digest('base64url');
export function novosCodigosRecuperacao() {
  const codigos = Array.from({ length: 8 }, () => {
    const t = base32(randomBytes(7)).toLowerCase().slice(0, 10);
    return t.slice(0, 5) + '-' + t.slice(5);
  });
  return { codigos, hashes: codigos.map(hashRecuperacao) };
}
// Devolve a lista de hashes sem o código usado, ou null se o código não vale
export function usarRecuperacao(hashes, codigo) {
  const h = hashRecuperacao(codigo || '');
  const lista = Array.isArray(hashes) ? hashes : [];
  const i = lista.findIndex((x) => { const a = Buffer.from(x), b = Buffer.from(h); return a.length === b.length && timingSafeEqual(a, b); });
  if (i < 0 || !String(codigo || '').trim()) return null;
  return lista.filter((_, k) => k !== i);
}
