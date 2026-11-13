// Ajudas de HTTP que funcionam na Vercel e no servidor local (dev/servidor.mjs)

export class Falha extends Error {
  constructor(status, erro, mensagem) {
    super(mensagem);
    this.status = status;
    this.erro = erro;
  }
}

export function enviar(res, status, dados, cabecalhos = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(cabecalhos)) res.setHeader(k, v);
  res.end(dados === undefined ? '' : JSON.stringify(dados));
}

export async function lerCorpo(req) {
  // Na Vercel o corpo já vem lido em req.body; no servidor local lemos o stream
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return req.body ? JSON.parse(req.body) : {};
    if (Buffer.isBuffer(req.body)) return req.body.length ? JSON.parse(req.body.toString('utf8')) : {};
    return req.body;
  }
  const partes = [];
  let total = 0;
  for await (const p of req) {
    total += p.length;
    if (total > 6 * 1024 * 1024) throw new Falha(413, 'grande_demais', 'O envio passou do tamanho permitido.');
    partes.push(p);
  }
  const texto = Buffer.concat(partes).toString('utf8');
  if (!texto) return {};
  try { return JSON.parse(texto); } catch { throw new Falha(400, 'json_invalido', 'Os dados enviados não estão no formato certo.'); }
}

export function lerCookies(req) {
  const out = {};
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    out[parte.slice(0, i).trim()] = decodeURIComponent(parte.slice(i + 1).trim());
  }
  return out;
}

export function texto(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}
