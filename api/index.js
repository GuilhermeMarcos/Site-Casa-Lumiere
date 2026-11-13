// Uma única função da Vercel recebe todas as rotas /api/* (o vercel.json encaminha para cá).
import { ROTAS } from './_lib/rotas.js';
import { Falha, enviar, lerCorpo } from './_lib/http.js';
import { garantirEsquema } from './_lib/esquema.js';

const TABELA = ROTAS.map(([metodo, caminho, fn]) => {
  const nomes = [];
  const re = new RegExp('^' + caminho.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([A-Za-z0-9_-]{1,64})'; }) + '/?$');
  return { metodo, re, nomes, fn };
});

function caminhoDe(req) {
  const url = new URL(req.url, 'http://local');
  // Com o rewrite da Vercel, o caminho original chega em ?rota=
  const rota = url.searchParams.get('rota');
  return rota != null ? '/api/' + rota.replace(/^\/+/, '') : url.pathname;
}

// Pedidos que mudam dados precisam vir do próprio site
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    return new URL(origem).host === host;
  } catch {
    return false;
  }
}

export default async function handler(req, res) {
  try {
    const caminho = caminhoDe(req);
    const metodo = req.method || 'GET';
    let achou = null, params = {}, outroMetodo = false;
    for (const r of TABELA) {
      const m = r.re.exec(caminho);
      if (!m) continue;
      if (r.metodo !== metodo) { outroMetodo = true; continue; }
      achou = r;
      r.nomes.forEach((n, i) => { params[n] = m[i + 1]; });
      break;
    }
    if (!achou) throw new Falha(outroMetodo ? 405 : 404, 'rota', 'Endereço não encontrado.');
    if (metodo !== 'GET' && !mesmaOrigem(req)) throw new Falha(403, 'origem', 'Pedido recusado.');
    const corpo = metodo === 'GET' || metodo === 'DELETE' ? {} : await lerCorpo(req);
    await garantirEsquema();
    const [status, dados, cabecalhos] = await achou.fn(req, params, corpo || {});
    enviar(res, status, dados, cabecalhos);
  } catch (e) {
    if (e instanceof Falha) {
      enviar(res, e.status, { erro: e.erro, mensagem: e.message });
    } else {
      console.error(e);
      enviar(res, 500, { erro: 'interno', mensagem: 'Algo deu errado do nosso lado. Tente de novo em instantes.' });
    }
  }
}
