// Fotos das salas e dos profissionais. Na Vercel vão para o Vercel Blob (store público conectado ao projeto).
// O SDK se autentica sozinho: OIDC + BLOB_STORE_ID (padrão atual) ou BLOB_READ_WRITE_TOKEN (jeito antigo).
// No teste local, dev/servidor.mjs troca por uma pasta com usarArmazenamento().
import { put } from '@vercel/blob';
import { Falha } from './http.js';

let impl = null;
export function usarArmazenamento(nova) {
  impl = nova;
}

const TIPOS = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MAX = 3 * 1024 * 1024;

// Recebe "data:image/webp;base64,...." e devolve o endereço público da imagem
export async function guardarFoto(nomeBase, dataUrl, pasta = 'salas') {
  const m = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) throw new Falha(400, 'foto_invalida', 'Use uma foto em JPG, PNG ou WebP.');
  const corpo = Buffer.from(m[2], 'base64');
  if (!corpo.length || corpo.length > MAX) throw new Falha(413, 'foto_grande', 'A foto ficou grande demais. Tente outra.');
  // Confere os primeiros bytes do arquivo: tem que ser mesmo uma imagem, não um arquivo disfarçado
  if (tipoReal(corpo) !== m[1]) throw new Falha(400, 'foto_invalida', 'Esse arquivo não é uma foto válida.');
  const caminho = `${pasta}/${nomeBase}-${Date.now().toString(36)}.${TIPOS[m[1]]}`;
  if (impl) return impl(caminho, corpo, m[1]);
  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    throw new Falha(503, 'sem_blob', 'O armazenamento de fotos ainda não foi ligado. Na Vercel: Storage, Create, Blob (acesso Público), conectar ao projeto e fazer Redeploy.');
  }
  try {
    const r = await put(caminho, corpo, { access: 'public', contentType: m[1], addRandomSuffix: false });
    return r.url;
  } catch (e) {
    console.error('Vercel Blob:', e && e.message);
    throw new Falha(503, 'blob_erro', 'Não foi possível guardar a foto. Confira na Vercel se o Blob foi criado com acesso Público e está conectado a este projeto.');
  }
}

function tipoReal(b) {
  if (b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  return null;
}
