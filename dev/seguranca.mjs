// Testes de segurança da conta da equipe (senha + código no e-mail) e contra spam. `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar, caixaDeEntrada } from './preparar.mjs';
import handler from '../api/index.js';

let pg, servidor, base;
before(async () => {
  pg = await preparar({ correio: true });
  servidor = http.createServer(handler).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

let ipSeq = 1;
function cliente(ip = `100.66.0.${ipSeq++}`, extras = {}) {
  let cookie = '';
  const f = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, 'user-agent': 'Teste/1.0', ...extras, ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, dados: await r.json() };
  };
  f.cookie = () => cookie; f.usarCookie = (c) => { cookie = c; };
  return f;
}
const EMAIL = 'equipe@casalumiere.com.br', SENHA = 'Senha-Forte-da-Casa-2026';
const pc = cliente(), celular = cliente(), comum = cliente();
const ultimo = (email) => [...caixaDeEntrada].reverse().find((m) => m.para === email);
const codigoDe = (email) => /(\d{6})/.exec(ultimo(email).assunto)[1];

test('conta da equipe: senha de 12 caracteres, código da equipe e código do e-mail', async () => {
  assert.equal((await pc('POST', '/api/auth/codigo', { email: EMAIL, finalidade: 'cadastro' })).status, 200);
  const base = { nome: 'Luiza e Agatha', email: EMAIL, telefone: '19992487347', codigoEquipe: 'lumiere' };
  assert.equal((await pc('POST', '/api/auth/cadastro', { ...base, senha: 'Curta-123', codigo: codigoDe(EMAIL) })).status, 400);
  const r = await pc('POST', '/api/auth/cadastro', { ...base, senha: SENHA, codigo: codigoDe(EMAIL) });
  assert.equal(r.status, 201);
  assert.equal((await pc('GET', '/api/admin/dados')).status, 200, 'quem criou a conta (com os dois códigos) já entra');
  assert.equal((await comum('POST', '/api/auth/codigo', { email: 'cliente@exemplo.com', finalidade: 'cadastro' })).status, 200);
  assert.equal((await comum('POST', '/api/auth/cadastro', { nome: 'Cliente', email: 'cliente@exemplo.com', telefone: '19990000001', senha: 'Senha-Comum-1', codigo: codigoDe('cliente@exemplo.com') })).status, 201);
});

test('aparelho novo: depois da senha, chega um código no e-mail da equipe', async () => {
  const antes = caixaDeEntrada.length;
  let r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, lembrar: true });
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'precisa_codigo');
  assert.match(r.dados.mensagem, /eq\*+@casalumiere\.com\.br/, 'mostra o e-mail escondido');
  assert.equal(celular.cookie(), '', 'sem o código, não recebe sessão');
  assert.equal(caixaDeEntrada.length, antes + 1);
  assert.match(ultimo(EMAIL).assunto, /código para entrar no painel/);
  // tocou em Entrar de novo logo em seguida: não manda outro e-mail, o código anterior continua valendo
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, lembrar: true });
  assert.equal(r.dados.erro, 'precisa_codigo'); assert.equal(caixaDeEntrada.length, antes + 1);
  const codigo = codigoDe(EMAIL);
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: codigo === '000000' ? '111111' : '000000' });
  assert.equal(r.status, 400); assert.equal(r.dados.erro, 'codigo_errado');
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: 'senha-errada-qualquer', codigoEmail: codigo });
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'senha', 'código certo com senha errada não entra');
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: codigo, lembrar: true });
  assert.equal(r.status, 200);
  assert.equal((await celular('GET', '/api/admin/dados')).status, 200);
  r = await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: codigo });
  assert.equal(r.status, 400, 'o mesmo código não serve duas vezes');
});

test('5 tentativas erradas anulam o código', async () => {
  const a = cliente();
  await new Promise((ok) => setTimeout(ok, 10));
  await pg.query("DELETE FROM limites WHERE chave LIKE 'codigo-1min|entrar|%'");
  await a('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA });
  const certo = codigoDe(EMAIL);
  const errado = certo === '123456' ? '654321' : '123456';
  for (let i = 0; i < 5; i++) await a('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: errado });
  const r = await a('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: certo });
  assert.equal(r.status, 400, 'nem o código certo vale mais: precisa pedir outro');
});

test('trocar a senha pelo e-mail não pula a segunda etapa', async () => {
  await pg.query("DELETE FROM limites WHERE chave LIKE 'codigo-1min|%'");
  const x = cliente();
  assert.equal((await x('POST', '/api/auth/codigo', { email: EMAIL, finalidade: 'senha' })).status, 200);
  const codSenha = codigoDe(EMAIL);
  // o código de trocar senha não serve para entrar no painel
  let r = await x('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigoEmail: codSenha });
  assert.notEqual(r.status, 200);
  r = await x('POST', '/api/auth/recuperar', { email: EMAIL, codigo: codSenha, senhaNova: 'Outra-Senha-Forte-da-Casa' });
  assert.equal(r.status, 200);
  r = await x('GET', '/api/admin/dados');
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'precisa_codigo');
  assert.equal((await pc('GET', '/api/admin/dados')).status, 401, 'senha nova desconecta os outros aparelhos');
  await pg.query("DELETE FROM limites WHERE chave LIKE 'codigo-1min|%'");
  await pc('POST', '/api/auth/entrar', { email: EMAIL, senha: 'Outra-Senha-Forte-da-Casa', lembrar: true });
  r = await pc('POST', '/api/auth/entrar', { email: EMAIL, senha: 'Outra-Senha-Forte-da-Casa', codigoEmail: codigoDe(EMAIL), lembrar: true });
  assert.equal(r.status, 200);
});

test('sair de todos os aparelhos', async () => {
  await pg.query("DELETE FROM limites WHERE chave LIKE 'codigo-1min|%'");
  await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: 'Outra-Senha-Forte-da-Casa', lembrar: true });
  assert.equal((await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: 'Outra-Senha-Forte-da-Casa', codigoEmail: codigoDe(EMAIL), lembrar: true })).status, 200);
  assert.equal((await celular('GET', '/api/admin/dados')).status, 200);
  assert.equal((await pc('POST', '/api/admin/sair-todos')).status, 200);
  assert.equal((await celular('GET', '/api/admin/dados')).status, 401, 'o outro aparelho saiu');
  assert.equal((await pc('GET', '/api/admin/dados')).status, 200, 'este continua');
});

test('registro de acessos aparece no painel', async () => {
  const s = (await pc('GET', '/api/admin/dados')).dados.seguranca;
  const tipos = s.acessos.map((a) => a.resultado);
  for (const t of ['entrou', 'codigo_errado', 'senha_errada', 'saiu_de_todos']) assert.ok(tipos.includes(t), t + ' ' + tipos.join(','));
  assert.equal(s.segundaEtapa, 'email');
  assert.equal(s.acessos[0].aparelho, 'Teste/1.0');
});

test('o painel não troca a senha da própria equipe (só clientes)', async () => {
  const r = await pc('POST', '/api/admin/usuarios/senha', { email: EMAIL, senhaNova: 'Outra-Senha-Forte-99' });
  assert.equal(r.status, 400);
});

test('no site de verdade, código da equipe fraco fica desligado', async () => {
  const antes = process.env.VERCEL_ENV;
  process.env.VERCEL_ENV = 'production';
  try {
    assert.equal((await cliente()('POST', '/api/auth/redefinir-equipe', { email: EMAIL, codigo: 'lumiere', senhaNova: 'Nova-Senha-Forte-77' })).status, 403);
  } finally {
    if (antes === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = antes;
  }
});

test('spam: campo isca preenchido por robô é recusado', async () => {
  const r = await cliente()('POST', '/api/auth/cadastro', { nome: 'Robô', email: 'robo@exemplo.com', telefone: '19990000009', senha: 'Senha-Robo-123', site: 'http://spam.example' });
  assert.equal(r.status, 400);
  const { rows } = await pg.query("SELECT 1 FROM usuarios WHERE email = 'robo@exemplo.com'");
  assert.equal(rows.length, 0);
});

test('spam: trocar de endereço IPv6 dentro da mesma casa não fura o limite', async () => {
  let ultimo;
  for (let i = 0; i < 11; i++) {
    ultimo = await cliente(`2804:14c:5b81:8c12::${(i + 1).toString(16)}`)('POST', '/api/auth/cadastro', { nome: 'Pessoa ' + i, email: `v6-${i}@exemplo.com`, telefone: '19990000010', senha: 'Senha-Boa-' + i + 'x' });
  }
  assert.equal(ultimo.status, 429);
});

test('spam: teto geral de contas novas por hora, mesmo vindo de muitos lugares', async () => {
  let ultimo, n = 0;
  for (let i = 0; i < 70 && (!ultimo || ultimo.status !== 429); i++, n++) {
    ultimo = await cliente(`100.67.${i}.1`)('POST', '/api/auth/cadastro', { nome: 'Bot ' + i, email: `bot-${i}@exemplo.com`, telefone: '19990000011', senha: 'Senha-Bot-' + i + 'xy' });
  }
  assert.equal(ultimo.status, 429);
  assert.ok(n <= 61, 'parou perto de 60 por hora');
});

test('corpo gigante é recusado antes de qualquer trabalho', async () => {
  const r = await cliente()('POST', '/api/auth/entrar', { email: 'x@exemplo.com', senha: 'a'.repeat(80 * 1024) });
  assert.equal(r.status, 413);
});

