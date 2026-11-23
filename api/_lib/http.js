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
  let pronto;
  try { pronto = req.body; } catch { throw new Falha(400, 'json_invalido', 'Os dados enviados não estão no formato certo.'); }
  if (pronto !== undefined && pronto !== null) {
    try {
      if (typeof pronto === 'string') pronto = pronto ? JSON.parse(pronto) : {};
      else if (Buffer.isBuffer(pronto)) pronto = pronto.length ? JSON.parse(pronto.toString('utf8')) : {};
    } catch { throw new Falha(400, 'json_invalido', 'Os dados enviados não estão no formato certo.'); }
    return objeto(pronto);
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
  try { return objeto(JSON.parse(texto)); } catch (e) { if (e instanceof Falha) throw e; throw new Falha(400, 'json_invalido', 'Os dados enviados não estão no formato certo.'); }
}

// O corpo precisa ser um objeto simples (nada de lista, texto solto ou __proto__)
function objeto(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Falha(400, 'json_invalido', 'Os dados enviados não estão no formato certo.');
  const limpo = {};
  for (const [k, x] of Object.entries(v)) if (k !== '__proto__' && k !== 'constructor' && k !== 'prototype') limpo[k] = x;
  return limpo;
}

export function lerCookies(req) {
  const out = {};
  const bruto = req.headers.cookie || '';
  for (const parte of bruto.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    const valor = parte.slice(i + 1).trim();
    try { out[parte.slice(0, i).trim()] = decodeURIComponent(valor); } catch { /* cookie malformado: ignora */ }
  }
  return out;
}

// IP de quem fez o pedido. Na Vercel, x-real-ip e x-forwarded-for são preenchidos pela própria Vercel.
export function ipDe(req) {
  const h = req.headers || {};
  const ip = h['x-vercel-forwarded-for'] || h['x-real-ip'] || String(h['x-forwarded-for'] || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || '?';
  return String(ip).slice(0, 64);
}

// IP para os limites de tentativas. Em IPv6, cada casa recebe um bloco inteiro (/64) de endereços;
// contamos o bloco, senão daria para trocar de endereço a cada tentativa.
export function ipLimite(req) {
  const ip = ipDe(req);
  if (!ip.includes(':') || ip.startsWith('::ffff:')) return ip.replace(/^::ffff:/, '');
  const partes = ip.split('%')[0].split('::');
  const ini = partes[0] ? partes[0].split(':') : [];
  const fim = partes.length > 1 && partes[1] ? partes[1].split(':') : [];
  const cheio = partes.length > 1 ? [...ini, ...Array(Math.max(0, 8 - ini.length - fim.length)).fill('0'), ...fim] : ini;
  return cheio.slice(0, 4).map((x) => (x || '0').toLowerCase().replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

export function texto(v, max = 200) {
  return String(v ?? '').trim().slice(0, max);
}
