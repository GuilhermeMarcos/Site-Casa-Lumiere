// Testes da confirmação por e-mail: código no cadastro e na recuperação de senha. `npm test`
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
function cliente(ip = `192.168.0.${ipSeq++}`) {
  let cookie = '';
  const f = async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, dados: await r.json() };
  };
  f.cookie = () => cookie;
  return f;
}
const ultimoPara = (email) => [...caixaDeEntrada].reverse().find((m) => m.para === email);
const codigoDe = (email) => /(\d{6})/.exec(ultimoPara(email).assunto)[1];
const dados = (email) => ({ nome: 'Clara Teste', email, telefone: '19999991234', senha: 'Senha-Boa-Clara' });
const voltarRelogio = (email) => pg.query("UPDATE limites SET janela_ate = now() - interval '1 second' WHERE chave LIKE $1", [`codigo-1min|%|${email}`]);

test('o site avisa que o e-mail está ligado', async () => {
  const r = await cliente()('GET', '/api/auth/eu');
  assert.equal(r.dados.emailAtivo, true);
});

test('cadastro só termina com o código que chegou no e-mail', async () => {
  const c = cliente();
  assert.equal((await c('POST', '/api/auth/cadastro', dados('clara@exemplo.com'))).status, 400, 'sem código não cria');
  assert.equal((await c('POST', '/api/auth/codigo', { email: 'clara@exemplo.com', finalidade: 'cadastro' })).status, 200);
  const m = ultimoPara('clara@exemplo.com');
  assert.match(m.assunto, /^\d{6} é o seu código/);
  assert.match(m.html, /Confirme o seu e-mail/);
  const codigo = codigoDe('clara@exemplo.com');
  const errado = String((Number(codigo) + 1) % 1000000).padStart(6, '0');
  assert.equal((await c('POST', '/api/auth/cadastro', { ...dados('clara@exemplo.com'), codigo: errado })).status, 400);
  const r = await c('POST', '/api/auth/cadastro', { ...dados('clara@exemplo.com'), codigo });
  assert.equal(r.status, 201);
  assert.equal((await c('POST', '/api/auth/cadastro', { ...dados('clara@exemplo.com'), codigo })).status, 409, 'o código não serve duas vezes');
});

test('o código fica guardado só como hash e vence', async () => {
  const c = cliente();
  await c('POST', '/api/auth/codigo', { email: 'vence@exemplo.com', finalidade: 'cadastro' });
  const codigo = codigoDe('vence@exemplo.com');
  const [linha] = (await pg.query("SELECT codigo_hash FROM codigos WHERE email = 'vence@exemplo.com'")).rows;
  assert.ok(!linha.codigo_hash.includes(codigo));
  await pg.query("UPDATE codigos SET expira_em = now() - interval '1 second' WHERE email = 'vence@exemplo.com'");
  const r = await c('POST', '/api/auth/cadastro', { ...dados('vence@exemplo.com'), codigo });
  assert.equal(r.status, 400);
  assert.equal(r.dados.erro, 'codigo_vencido');
});

test('chutar o código: depois de 5 erros ele deixa de valer', async () => {
  const c = cliente();
  await c('POST', '/api/auth/codigo', { email: 'chute@exemplo.com', finalidade: 'cadastro' });
  const codigo = codigoDe('chute@exemplo.com');
  for (let i = 0; i < 5; i++) {
    const chute = String((Number(codigo) + 1 + i) % 1000000).padStart(6, '0');
    await c('POST', '/api/auth/cadastro', { ...dados('chute@exemplo.com'), codigo: chute });
  }
  const r = await c('POST', '/api/auth/cadastro', { ...dados('chute@exemplo.com'), codigo });
  assert.equal(r.status, 400, 'nem o código certo vale mais');
});

test('pedir código toda hora é limitado', async () => {
  const c = cliente();
  assert.equal((await c('POST', '/api/auth/codigo', { email: 'pressa@exemplo.com', finalidade: 'cadastro' })).status, 200);
  assert.equal((await c('POST', '/api/auth/codigo', { email: 'pressa@exemplo.com', finalidade: 'cadastro' })).status, 429, 'um por minuto');
  const robo = cliente();
  let ultimo;
  for (let i = 0; i < 16; i++) ultimo = await robo('POST', '/api/auth/codigo', { email: `spam${i}@exemplo.com`, finalidade: 'cadastro' });
  assert.equal(ultimo.status, 429, 'um IP não dispara e-mails sem fim');
});

test('recuperar a senha pelo e-mail', async () => {
  const c = cliente();
  const outroAparelho = cliente();
  await outroAparelho('POST', '/api/auth/entrar', { email: 'clara@exemplo.com', senha: 'Senha-Boa-Clara', lembrar: true });
  assert.equal((await outroAparelho('GET', '/api/reservas')).status, 200);
  assert.equal((await c('POST', '/api/auth/codigo', { email: 'clara@exemplo.com', finalidade: 'senha' })).status, 200);
  const m = ultimoPara('clara@exemplo.com');
  assert.match(m.html, /Crie uma senha nova/);
  const codigo = codigoDe('clara@exemplo.com');
  assert.equal((await c('POST', '/api/auth/recuperar', { email: 'clara@exemplo.com', codigo, senhaNova: '12345678' })).status, 400, 'senha fácil recusada');
  const r = await c('POST', '/api/auth/recuperar', { email: 'clara@exemplo.com', codigo, senhaNova: 'Nova-Senha-Clara-2' });
  assert.equal(r.status, 200);
  assert.equal(r.dados.conta.email, 'clara@exemplo.com');
  assert.equal((await c('GET', '/api/reservas')).status, 200, 'já entrou na conta');
  assert.equal((await outroAparelho('GET', '/api/reservas')).status, 401, 'o outro aparelho saiu');
  assert.equal((await cliente()('POST', '/api/auth/entrar', { email: 'clara@exemplo.com', senha: 'Nova-Senha-Clara-2' })).status, 200);
  assert.equal((await c('POST', '/api/auth/recuperar', { email: 'clara@exemplo.com', codigo, senhaNova: 'Mais-Uma-Senha-3' })).status, 400, 'código de senha não serve duas vezes');
});

test('ninguém descobre quem tem conta pelo "esqueci a senha" nem pelo cadastro', async () => {
  const c = cliente();
  const antes = caixaDeEntrada.length;
  const r1 = await c('POST', '/api/auth/codigo', { email: 'ninguem@exemplo.com', finalidade: 'senha' });
  assert.equal(r1.status, 200, 'mesma resposta para e-mail sem conta');
  assert.equal(caixaDeEntrada.length, antes, 'e nenhum e-mail sai');
  await voltarRelogio('clara@exemplo.com');
  const r2 = await c('POST', '/api/auth/codigo', { email: 'clara@exemplo.com', finalidade: 'cadastro' });
  assert.equal(r2.status, 200, 'pedir cadastro com e-mail que já existe responde igual');
  assert.match(ultimoPara('clara@exemplo.com').assunto, /já tem conta/, 'a dona do e-mail recebe um aviso');
  const r3 = await c('POST', '/api/auth/recuperar', { email: 'ninguem@exemplo.com', codigo: '123456', senhaNova: 'Qualquer-Senha-9' });
  assert.equal(r3.status, 400);
});

test('código de cadastro não serve para trocar senha, e vice-versa', async () => {
  const c = cliente();
  await voltarRelogio('clara@exemplo.com');
  await pg.query("DELETE FROM limites WHERE chave LIKE 'codigo-1h|%|clara@exemplo.com'");
  await c('POST', '/api/auth/codigo', { email: 'clara@exemplo.com', finalidade: 'senha' });
  const codigoSenha = codigoDe('clara@exemplo.com');
  assert.equal((await c('POST', '/api/auth/cadastro', { ...dados('clara@exemplo.com'), codigo: codigoSenha })).status, 409);
  await c('POST', '/api/auth/codigo', { email: 'nova@exemplo.com', finalidade: 'cadastro' });
  const codigoCadastro = codigoDe('nova@exemplo.com');
  assert.equal((await c('POST', '/api/auth/recuperar', { email: 'nova@exemplo.com', codigo: codigoCadastro, senhaNova: 'Senha-Nova-Nova-1' })).status, 400);
});

test('a conta da equipe também precisa do código da equipe, além do e-mail', async () => {
  const c = cliente();
  await c('POST', '/api/auth/codigo', { email: 'equipe@casalumiere.com.br', finalidade: 'cadastro' });
  const codigo = codigoDe('equipe@casalumiere.com.br');
  const base = { nome: 'Luiza e Agatha', email: 'equipe@casalumiere.com.br', telefone: '19992487347', senha: 'Casa-Forte-2026', codigo };
  assert.equal((await c('POST', '/api/auth/cadastro', base)).status, 403, 'sem o código da equipe');
  const r = await c('POST', '/api/auth/cadastro', { ...base, codigoEquipe: 'lumiere' });
  assert.equal(r.status, 201);
  assert.equal(r.dados.conta.equipe, true);
});
