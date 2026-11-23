// Testes de segurança da conta da equipe (verificação em duas etapas) e contra spam. `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar, ligar2fa, codigoApp } from './preparar.mjs';
import handler from '../api/index.js';
import { emailNovoAcesso } from '../api/_lib/correio.js';

let pg, servidor, base;
before(async () => {
  pg = await preparar();
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
let segredo, recuperacao;

test('senha da equipe precisa de 12 caracteres', async () => {
  const r = await pc('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: EMAIL, telefone: '19992487347', senha: 'Curta-123', codigoEquipe: 'lumiere' });
  assert.equal(r.status, 400);
  assert.equal((await pc('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: EMAIL, telefone: '19992487347', senha: SENHA, codigoEquipe: 'lumiere' })).status, 201);
  assert.equal((await comum('POST', '/api/auth/cadastro', { nome: 'Cliente', email: 'cliente@exemplo.com', telefone: '19990000001', senha: 'Senha-Comum-1' })).status, 201);
});

test('sem a verificação ligada, a equipe só vê a tela de ativação', async () => {
  for (const [m, c] of [['GET', '/api/admin/dados'], ['POST', '/api/admin/salas'], ['GET', '/api/admin/reservas/x'], ['POST', '/api/admin/sair-todos']]) {
    const r = await pc(m, c);
    assert.equal(r.status, 403, c); assert.equal(r.dados.erro, 'configurar_2fa', c);
  }
  const s = await pc('GET', '/api/admin/2fa');
  assert.equal(s.status, 200); assert.equal(s.dados.ativo, false);
  assert.equal((await comum('GET', '/api/admin/2fa')).status, 403, 'cliente não mexe nisso');
  assert.equal((await comum('POST', '/api/admin/2fa/iniciar', { codigoEquipe: 'lumiere' })).status, 403);
});

test('ativar pede o código da equipe e o primeiro código do aplicativo', async () => {
  assert.equal((await pc('POST', '/api/admin/2fa/iniciar', { codigoEquipe: 'chute' })).status, 403);
  assert.equal((await pc('POST', '/api/admin/2fa/ativar', { codigo: '123456' })).status, 400, 'sem ter começado');
  // o celular entra com a senha antes da ativação (sessão sem o segundo fator)
  assert.equal((await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, lembrar: true })).status, 200);
  const r = await ligar2fa(pc);
  segredo = r.segredo; recuperacao = r.codigos;
  assert.equal(recuperacao.length, 8);
  assert.equal((await pc('GET', '/api/admin/dados')).status, 200, 'quem ativou entra direto');
  const velho = await celular('GET', '/api/admin/dados');
  assert.equal(velho.status, 401, 'ativar derruba as sessões abertas em outros aparelhos');
});

test('entrar exige o código do aplicativo; código errado não entra', async () => {
  const antes = celular.cookie();
  let r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA });
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'precisa_2fa');
  assert.equal(celular.cookie(), antes, 'sem código não recebe sessão nova');
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigo2fa: '000000' });
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'codigo_2fa');
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: 'senha-errada-qualquer', codigo2fa: await codigoApp(segredo) });
  assert.equal(r.status, 401); assert.equal(r.dados.erro, 'senha', 'código certo com senha errada não entra');
  const codigo = await codigoApp(segredo);
  r = await celular('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigo2fa: codigo, lembrar: true });
  assert.equal(r.status, 200);
  assert.equal((await celular('GET', '/api/admin/dados')).status, 200);
  // o mesmo código não serve duas vezes (alguém que viu por cima do ombro)
  const outro = cliente();
  r = await outro('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigo2fa: codigo });
  assert.equal(r.status, 401);
});

test('5 códigos errados travam a verificação por 15 minutos, de qualquer lugar', async () => {
  await pg.query('UPDATE usuarios SET totp_falhas = 0 WHERE email = $1', [EMAIL]);
  try {
    for (let i = 0; i < 5; i++) assert.equal((await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigo2fa: '111111' })).status, 401);
    const r = await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, codigo2fa: await codigoApp(segredo) });
    assert.equal(r.status, 429, 'travado mesmo com o código certo');
  } finally {
    await pg.query('UPDATE usuarios SET totp_bloqueado_ate = NULL, totp_falhas = 0 WHERE email = $1', [EMAIL]);
  }
});

test('código de recuperação entra uma vez só', async () => {
  const a = cliente();
  let r = await a('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, recuperacao: recuperacao[0] });
  assert.equal(r.status, 200); assert.equal(r.dados.recuperacoesRestantes, 7);
  r = await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, recuperacao: recuperacao[0] });
  assert.equal(r.status, 401, 'já foi usado');
  r = await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, recuperacao: 'aaaaa-bbbbb' });
  assert.equal(r.status, 401);
});

test('segredo do aplicativo e códigos de recuperação não ficam legíveis no banco', async () => {
  const { rows: [u] } = await pg.query('SELECT totp_segredo, recuperacao FROM usuarios WHERE email = $1', [EMAIL]);
  assert.ok(!u.totp_segredo.includes(segredo), 'segredo cifrado');
  assert.ok(u.recuperacao.every((h) => !recuperacao.includes(h)), 'só o hash dos códigos');
  const dados = (await pc('GET', '/api/admin/dados')).dados;
  assert.ok(!JSON.stringify(dados).includes(u.totp_segredo), 'o painel nunca recebe o segredo');
});

test('novos códigos de recuperação pedem o código do aplicativo e anulam os antigos', async () => {
  assert.equal((await pc('POST', '/api/admin/2fa/novos-codigos', { codigo2fa: '222222' })).status, 401);
  const r = await pc('POST', '/api/admin/2fa/novos-codigos', { codigo2fa: await codigoApp(segredo) });
  assert.equal(r.status, 200); assert.equal(r.dados.codigos.length, 8);
  assert.equal((await cliente()('POST', '/api/auth/entrar', { email: EMAIL, senha: SENHA, recuperacao: recuperacao[1] })).status, 401, 'antigo não vale mais');
  recuperacao = r.dados.codigos;
});

test('sair de todos os aparelhos', async () => {
  assert.equal((await celular('GET', '/api/admin/dados')).status, 200);
  const r = await pc('POST', '/api/admin/sair-todos');
  assert.equal(r.status, 200);
  assert.equal((await celular('GET', '/api/admin/dados')).status, 401, 'o outro aparelho saiu');
  assert.equal((await pc('GET', '/api/admin/dados')).status, 200, 'este continua');
});

test('registro de acessos aparece no painel', async () => {
  const s = (await pc('GET', '/api/admin/dados')).dados.seguranca;
  const tipos = s.acessos.map((a) => a.resultado);
  for (const t of ['entrou', 'codigo_errado', 'senha_errada', 'ativou_2fa', 'saiu_de_todos']) assert.ok(tipos.includes(t), t + ' ' + tipos.join(','));
  assert.equal(s.doisFatores.ativo, true);
  assert.equal(s.doisFatores.recuperacoesRestantes, 8);
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
    assert.equal((await pc('POST', '/api/admin/2fa/iniciar', { codigoEquipe: 'lumiere' })).status, 503);
    assert.equal((await cliente()('POST', '/api/auth/redefinir-equipe', { email: EMAIL, codigo: 'lumiere', senhaNova: 'Nova-Senha-Forte-77', codigo2fa: '123456' })).status, 403);
    assert.equal((await pc('GET', '/api/admin/2fa')).dados.codigoEquipeFraco, true);
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

test('e-mail de aviso de acesso não deixa o aparelho virar código', () => {
  const m = emailNovoAcesso({ quando: 'agora', local: 'Holambra', aparelho: '<script>alert(1)</script>' });
  assert.ok(!m.html.includes('<script>'));
  assert.ok(m.html.includes('&lt;script&gt;'));
});
