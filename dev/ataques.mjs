// Testes de ataque: tentam invadir, vazar dados ou abusar do sistema. Todos precisam FALHAR para o atacante.
// Rodam com `npm test`, num banco em memória.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar } from './preparar.mjs';
import handler from '../api/index.js';
import { agoraLocal, somarDias, diaSemana } from '../api/_lib/agenda.js';

let pg, servidor, base;
before(async () => {
  pg = await preparar();
  servidor = http.createServer(handler).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

let ipSeq = 1;
function cliente(ip = `172.16.0.${ipSeq++}`) {
  let cookie = '';
  const f = async (metodo, caminho, corpo, extra = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    const txt = await r.text();
    let dados; try { dados = JSON.parse(txt); } catch { dados = txt; }
    return { status: r.status, dados, txt };
  };
  f.cookie = () => cookie;
  f.usarCookie = (c) => { cookie = c; };
  return f;
}

const hoje = agoraLocal().data;
let dia = somarDias(hoje, 4);
while ([2, 3, 4].includes(diaSemana(dia))) dia = somarDias(dia, 1);
const vitima = cliente(), atacante = cliente(), equipe = cliente();
const nova = (n) => ({ nome: 'Pessoa ' + n, email: `${n}@exemplo.com`, telefone: '19999990000', senha: 'Senha-Boa-' + n });

test('preparação: vítima, atacante e equipe', async () => {
  assert.equal((await vitima('POST', '/api/auth/cadastro', { ...nova('vitima'), nome: 'Vítima Silva' })).status, 201);
  assert.equal((await atacante('POST', '/api/auth/cadastro', nova('atacante'))).status, 201);
  assert.equal((await equipe('POST', '/api/auth/cadastro', { ...nova('equipe'), email: 'equipe@casalumiere.com.br', codigoEquipe: 'lumiere' })).status, 201);
  assert.equal((await vitima('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [9, 10] })).status, 201);
});

test('injeção de SQL não funciona', async () => {
  const c = cliente();
  for (const email of ["' OR '1'='1", "vitima@exemplo.com' --", "x' UNION SELECT senha_hash FROM usuarios --"]) {
    const r = await c('POST', '/api/auth/entrar', { email, senha: "' OR '1'='1" });
    assert.equal(r.status, 401, email);
  }
  const r = await c('POST', '/api/auth/cadastro', { ...nova('sqli'), nome: "Robert'); DROP TABLE usuarios; --" });
  assert.equal(r.status, 201);
  const [n] = (await pg.query('SELECT count(*)::int AS n FROM usuarios')).rows;
  assert.ok(n.n >= 4, 'a tabela de usuários continua lá');
  assert.equal((await c('GET', '/api/auth/eu')).dados.conta.nome, "Robert'); DROP TABLE usuarios; --", 'guardado como texto comum');
  const r2 = await c('POST', '/api/reservas', { sala: "sala-02' OR 1=1 --", data: dia, horas: [11] });
  assert.equal(r2.status, 404);
  const r3 = await c('POST', '/api/reservas', { sala: 'sala-02', data: "2026-01-01'; DELETE FROM reservas; --", horas: [11] });
  assert.equal(r3.status, 400);
  const r4 = await c('DELETE', "/api/reservas/1%27%20OR%20%271%27=%271");
  assert.equal(r4.status, 404);
});

test('cliente não entra no painel nem usa nenhuma rota da equipe', async () => {
  const anon = cliente();
  const rotas = [['GET', '/api/admin/dados'], ['POST', '/api/admin/reservas', { sala: 'sala-02', data: dia, horas: [12], nome: 'x' }],
    ['PATCH', '/api/admin/reservas/abc', {}], ['POST', '/api/admin/reservas/abc/confirmar'], ['DELETE', '/api/admin/reservas/abc'],
    ['POST', '/api/admin/salas'], ['PATCH', '/api/admin/salas/sala-02', { disponivel: false }], ['POST', '/api/admin/salas/sala-02/foto', { imagem: 'x' }],
    ['POST', '/api/admin/fixos', {}], ['DELETE', '/api/admin/fixos/abc'], ['PUT', '/api/admin/config', { abre: 0, fecha: 24 }],
    ['POST', '/api/admin/usuarios/senha', { email: 'vitima@exemplo.com', senhaNova: 'Invadida-123' }],
    ['POST', '/api/admin/parceiros', { nome: 'Eu', email: 'atacante@exemplo.com', descontoAluguel: 100, pctAtendimento: 0 }],
    ['PATCH', '/api/admin/parceiros/abc', { descontoAluguel: 100 }], ['DELETE', '/api/admin/parceiros/abc'],
    ['POST', '/api/admin/atendimentos', {}], ['PATCH', '/api/admin/atendimentos/abc', { status: 'recebido' }], ['DELETE', '/api/admin/atendimentos/abc']];
  for (const [m, rota, corpo] of rotas) {
    assert.equal((await atacante(m, rota, corpo)).status, 403, `cliente em ${m} ${rota}`);
    assert.equal((await anon(m, rota, corpo)).status, 401, `anônimo em ${m} ${rota}`);
  }
});

test('mandar "equipe: true" no cadastro não dá acesso de equipe', async () => {
  const c = cliente();
  const r = await c('POST', '/api/auth/cadastro', { ...nova('esperto'), equipe: true, admin: true, sessao_versao: 99, id: 'admin', __proto__: { equipe: true } });
  assert.equal(r.status, 201);
  assert.equal(r.dados.conta.equipe, false);
  assert.equal((await c('GET', '/api/admin/dados')).status, 403);
});

test('e-mail da equipe sem o código não cria conta, e chutar o código trava', async () => {
  const c = cliente();
  await pg.query("DELETE FROM usuarios WHERE email = 'equipe@casalumiere.com.br'");
  assert.equal((await c('POST', '/api/auth/cadastro', { ...nova('falsa'), email: 'equipe@casalumiere.com.br' })).status, 403);
  let ultimo;
  for (let i = 0; i < 9; i++) ultimo = await c('POST', '/api/auth/cadastro', { ...nova('falsa'), email: 'equipe@casalumiere.com.br', codigoEquipe: 'chute' + i });
  assert.equal(ultimo.status, 429);
  // a equipe de verdade, de outro lugar, continua conseguindo
  const r = await equipe('POST', '/api/auth/cadastro', { ...nova('equipe'), email: 'equipe@casalumiere.com.br', codigoEquipe: 'lumiere' });
  assert.equal(r.status, 201);
});

test('cookie de sessão falsificado ou adulterado não vale', async () => {
  const id = (await pg.query("SELECT id FROM usuarios WHERE email = 'equipe@casalumiere.com.br'")).rows[0].id;
  const corpo = Buffer.from(JSON.stringify({ u: id, v: 0, e: 9999999999 })).toString('base64url');
  const falsos = [`cl_sessao=${corpo}.assinaturafalsa`, `cl_sessao=${corpo}.`, `cl_sessao=${corpo}`, 'cl_sessao=%E0%A4%A', 'cl_sessao=a.b.c'];
  // pega a assinatura do atacante e cola no corpo da equipe
  const [, assinaturaReal] = atacante.cookie().split('=')[1].split('.');
  falsos.push(`cl_sessao=${corpo}.${assinaturaReal}`);
  for (const ck of falsos) {
    const c = cliente(); c.usarCookie(ck);
    const r = await c('GET', '/api/admin/dados');
    assert.equal(r.status, 401, ck);
    assert.equal((await c('GET', '/api/auth/eu')).status, 200, 'cookie estragado não derruba o servidor');
  }
});

test('trocar a senha desconecta os outros aparelhos', async () => {
  const celular = cliente(), computador = cliente();
  await celular('POST', '/api/auth/cadastro', nova('dois'));
  await computador('POST', '/api/auth/entrar', { email: 'dois@exemplo.com', senha: 'Senha-Boa-dois', lembrar: true });
  const cookieRoubado = computador.cookie();
  assert.equal((await computador('GET', '/api/reservas')).status, 200);
  const r = await celular('PATCH', '/api/auth/eu', { senhaAtual: 'Senha-Boa-dois', senhaNova: 'Outra-Senha-Forte-9' });
  assert.equal(r.status, 200);
  assert.equal((await computador('GET', '/api/reservas')).status, 401, 'o outro aparelho saiu');
  assert.equal((await celular('GET', '/api/reservas')).status, 200, 'quem trocou continua conectado');
  // quando a equipe cria senha nova para o cliente, o cookie antigo também morre
  const ladrao = cliente(); ladrao.usarCookie(celular.cookie());
  await equipe('POST', '/api/admin/usuarios/senha', { email: 'dois@exemplo.com', senhaNova: 'Nova-Da-Equipe-7' });
  assert.equal((await ladrao('GET', '/api/reservas')).status, 401);
  void cookieRoubado;
});

test('um cliente não vê nem cancela a reserva de outro', async () => {
  const minhasAtacante = (await atacante('GET', '/api/reservas')).dados.reservas;
  assert.equal(minhasAtacante.length, 0);
  const idVitima = (await vitima('GET', '/api/reservas')).dados.reservas[0].id;
  assert.equal((await atacante('DELETE', '/api/reservas/' + idVitima)).status, 404);
  assert.equal((await vitima('GET', '/api/reservas')).dados.reservas.length, 1);
});

test('a agenda pública não mostra nome, telefone nem e-mail de ninguém', async () => {
  const r = await cliente()('GET', '/api/agenda');
  assert.ok(!/Vítima|vitima@|19999990000|telefone|email|nome_|usuario/i.test(JSON.stringify(r.dados.ocupados)));
});

test('pedido de outro site (CSRF) é recusado', async () => {
  assert.equal((await vitima('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [14] }, { Origin: 'https://golpe.com' })).status, 403);
  const r = await vitima('POST', '/api/reservas', 'sala=sala-02', { 'Content-Type': 'application/x-www-form-urlencoded' });
  assert.equal(r.status, 415, 'formulário comum de outro site');
  const r2 = await vitima('POST', '/api/auth/excluir', JSON.stringify({ senha: 'x' }), { 'Content-Type': 'text/plain' });
  assert.equal(r2.status, 415);
});

test('força bruta: senha trava por e-mail e o IP é limitado', async () => {
  const robo = cliente('203.0.113.9');
  let r;
  for (let i = 0; i < 8; i++) r = await robo('POST', '/api/auth/entrar', { email: 'vitima@exemplo.com', senha: 'chute' + i });
  r = await robo('POST', '/api/auth/entrar', { email: 'vitima@exemplo.com', senha: 'Senha-Boa-vitima' });
  assert.equal(r.status, 429, 'travou para o robô');
  assert.equal((await cliente()('POST', '/api/auth/entrar', { email: 'vitima@exemplo.com', senha: 'Senha-Boa-vitima' })).status, 200, 'a dona da conta continua entrando');
  // senha "spray": um IP testando muitos e-mails
  const spray = cliente('203.0.113.50');
  for (let i = 0; i < 40; i++) await spray('POST', '/api/auth/entrar', { email: `alvo${i}@exemplo.com`, senha: '12345678' });
  assert.equal((await spray('POST', '/api/auth/entrar', { email: 'outro@exemplo.com', senha: 'x' })).status, 429);
  // criação de contas em massa
  const fabrica = cliente('203.0.113.77');
  let ultimo;
  for (let i = 0; i < 11; i++) ultimo = await fabrica('POST', '/api/auth/cadastro', nova('massa' + i));
  assert.equal(ultimo.status, 429);
});

test('senhas fáceis são recusadas', async () => {
  const c = cliente();
  for (const senha of ['12345678', 'senha123', 'aaaaaaaa', 'fraca@exemplo.com', 'fraca', 'Password']) {
    const r = await c('POST', '/api/auth/cadastro', { ...nova('fraca'), senha });
    assert.equal(r.status, 400, senha);
  }
});

test('arquivo disfarçado de foto é recusado', async () => {
  const html = Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  for (const tipo of ['png', 'jpeg', 'webp']) {
    const r = await equipe('POST', '/api/admin/salas/sala-02/foto', { imagem: `data:image/${tipo};base64,${html}` });
    assert.equal(r.status, 400, tipo);
  }
  const svg = Buffer.from('<svg onload="alert(1)"/>').toString('base64');
  assert.equal((await equipe('POST', '/api/admin/salas/sala-02/foto', { imagem: `data:image/svg+xml;base64,${svg}` })).status, 400);
});

test('corpo malformado não derruba o servidor', async () => {
  const c = cliente();
  assert.equal((await c('POST', '/api/auth/entrar', '{"email": ')).status, 400);
  assert.equal((await c('POST', '/api/auth/entrar', '[1,2,3]')).status, 400);
  assert.equal((await c('POST', '/api/auth/entrar', '"texto"')).status, 400);
  assert.equal((await c('POST', '/api/auth/entrar', JSON.stringify({ email: { $ne: null }, senha: ['x'] }))).status, 401);
  assert.equal((await c('GET', '/api/auth/entrar')).status, 405);
  assert.equal((await c('GET', '/api/../../etc/passwd')).status, 404);
});

test('o texto que alguém digita nunca vira código na tela do painel', async () => {
  const c = cliente();
  await c('POST', '/api/auth/cadastro', { ...nova('xss'), nome: '<img src=x onerror=alert(1)>', especialidade: '<script>alert(2)</script>' });
  const r = await c('POST', '/api/reservas', { sala: 'sala-04', data: dia, horas: [9] });
  assert.equal(r.status, 201);
  const dados = (await equipe('GET', '/api/admin/dados')).dados;
  const res = dados.reservas.find((x) => x.nome.startsWith('<img'));
  assert.equal(res.nome, '<img src=x onerror=alert(1)>', 'a API devolve como texto; o painel mostra com textContent');
});

test('excluir a própria conta apaga os dados e a sessão', async () => {
  const c = cliente();
  await c('POST', '/api/auth/cadastro', nova('sair'));
  await c('POST', '/api/reservas', { sala: 'sala-06', data: dia, horas: [18] });
  const ck = c.cookie();
  assert.equal((await c('POST', '/api/auth/excluir', { senha: 'errada-123' })).status, 400);
  assert.equal((await c('POST', '/api/auth/excluir', { senha: 'Senha-Boa-sair' })).status, 200);
  const ladrao = cliente(); ladrao.usarCookie(ck);
  assert.equal((await ladrao('GET', '/api/reservas')).status, 401);
  const sobrou = (await pg.query("SELECT count(*)::int AS n FROM usuarios WHERE email = 'sair@exemplo.com'")).rows[0].n;
  assert.equal(sobrou, 0);
  const pre = (await pg.query("SELECT count(*)::int AS n FROM reservas WHERE nome = 'Pessoa sair'")).rows[0].n;
  assert.equal(pre, 0, 'a pré-reserva sumiu junto');
  assert.equal((await equipe('POST', '/api/auth/excluir', { senha: 'Senha-Boa-equipe' })).status, 400, 'a conta da equipe não se apaga pelo site');
});

test('as senhas ficam guardadas só como hash', async () => {
  const linhas = (await pg.query('SELECT senha_hash FROM usuarios')).rows;
  for (const l of linhas) {
    assert.match(l.senha_hash, /^scrypt\$/);
    assert.ok(!l.senha_hash.includes('Senha-Boa'));
  }
});
