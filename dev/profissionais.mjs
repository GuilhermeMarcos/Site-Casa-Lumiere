// Testes do cadastro de profissionais pelo painel e da conferência do parceiro ao editar. `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar, ligar2fa } from './preparar.mjs';
import handler from '../api/index.js';

let servidor, base;
before(async () => {
  await preparar();
  servidor = http.createServer(handler).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

let ipSeq = 1;
function cliente(ip = `100.65.0.${ipSeq++}`) {
  let cookie = '';
  return async (metodo, caminho, corpo) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', 'x-real-ip': ip, ...(cookie ? { Cookie: cookie } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, dados: await r.json() };
  };
}
const equipe = cliente(), comum = cliente(), visitante = cliente(), paula = cliente();
// PNG de 1x1 válido
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('preparação: equipe e cliente', async () => {
  assert.equal((await equipe('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: 'equipe@casalumiere.com.br', telefone: '19992487347', senha: 'Casa-Forte-2026', codigoEquipe: 'lumiere' })).status, 201);
  await ligar2fa(equipe);
  assert.equal((await comum('POST', '/api/auth/cadastro', { nome: 'Cliente Comum', email: 'comum@exemplo.com', telefone: '19990000001', senha: 'Senha-Comum-1' })).status, 201);
});

test('os profissionais que já estavam no site vêm cadastrados', async () => {
  const r = await visitante('GET', '/api/profissionais');
  assert.equal(r.status, 200);
  assert.deepEqual(r.dados.profissionais.map((p) => p.nome), ['Vanessa Marques', 'Emily Almeida', 'Adriele Gomes', 'Elisangela Almeida']);
  assert.equal(r.dados.profissionais[2].credito, 'Foto: Daiane Anjos Fotografia');
  assert.ok(r.dados.profissionais.every((p) => p.foto.startsWith('/assets/img/')));
});

test('só a equipe cadastra, altera e remove profissionais', async () => {
  assert.equal((await visitante('POST', '/api/admin/profissionais', { nome: 'Invasor' })).status, 401);
  assert.equal((await comum('POST', '/api/admin/profissionais', { nome: 'Invasor' })).status, 403);
  assert.equal((await comum('PATCH', '/api/admin/profissionais/prof-vanessa', { nome: 'Trocado' })).status, 403);
  assert.equal((await comum('DELETE', '/api/admin/profissionais/prof-vanessa')).status, 403);
  assert.equal((await comum('POST', '/api/admin/profissionais/prof-vanessa/foto', { imagem: PNG })).status, 403);
  assert.equal((await comum('POST', '/api/admin/profissionais/prof-vanessa/mover', { para: 'baixo' })).status, 403);
});

let novo;
test('a equipe cadastra uma profissional nova com foto e ela aparece no site', async () => {
  assert.equal((await equipe('POST', '/api/admin/profissionais', { nome: 'x' })).status, 400, 'nome curto');
  assert.equal((await equipe('POST', '/api/admin/profissionais', { nome: 'Marina Duarte', whatsapp: '123' })).status, 400, 'WhatsApp inválido');
  const r = await equipe('POST', '/api/admin/profissionais', { nome: 'Marina Duarte', especialidade: 'Fisioterapeuta', registro: 'CREFITO 3/123456-F', whatsapp: '(19) 98888-7777', credito: '<script>alert(1)</script>' });
  assert.equal(r.status, 201); novo = r.dados.id;
  assert.equal((await equipe('POST', `/api/admin/profissionais/${novo}/foto`, { imagem: 'data:image/png;base64,PGh0bWw+' })).status, 400, 'arquivo que não é imagem');
  const f = await equipe('POST', `/api/admin/profissionais/${novo}/foto`, { imagem: PNG });
  assert.equal(f.status, 200); assert.match(f.dados.foto, /profissionais/);
  const lista = (await visitante('GET', '/api/profissionais')).dados.profissionais;
  const m = lista[lista.length - 1];
  assert.equal(m.nome, 'Marina Duarte'); assert.equal(m.whatsapp, '19988887777'); assert.equal(m.registro, 'CREFITO 3/123456-F');
  assert.equal(m.credito, '<script>alert(1)</script>', 'guardado como texto; a página mostra com textContent');
  assert.equal(m.foto, f.dados.foto);
});

test('mudar a ordem, esconder e remover', async () => {
  assert.equal((await equipe('POST', `/api/admin/profissionais/${novo}/mover`, { para: 'cima' })).status, 200);
  let nomes = (await visitante('GET', '/api/profissionais')).dados.profissionais.map((p) => p.nome);
  assert.deepEqual(nomes.slice(-2), ['Marina Duarte', 'Elisangela Almeida']);
  assert.equal((await equipe('POST', '/api/admin/profissionais/prof-vanessa/mover', { para: 'cima' })).status, 200, 'primeira não sobe mais, sem erro');
  assert.equal((await equipe('PATCH', '/api/admin/profissionais/prof-emily', { ativo: false })).status, 200);
  nomes = (await visitante('GET', '/api/profissionais')).dados.profissionais.map((p) => p.nome);
  assert.ok(!nomes.includes('Emily Almeida'), 'escondida não aparece no site');
  const painel = await equipe('GET', '/api/admin/dados');
  assert.ok(painel.dados.profissionais.find((p) => p.id === 'prof-emily' && p.ativo === false), 'mas continua no painel');
  assert.equal((await equipe('DELETE', `/api/admin/profissionais/${novo}`)).status, 200);
  assert.equal((await equipe('DELETE', `/api/admin/profissionais/${novo}`)).status, 404);
});

test('editar o parceiro (mesmo e-mail) não apaga o "É ela mesma"', async () => {
  assert.equal((await paula('POST', '/api/auth/cadastro', { nome: 'Paula Parceira', email: 'paula@exemplo.com', telefone: '19990000002', senha: 'Senha-Paula-1' })).status, 201);
  const c = await equipe('POST', '/api/admin/parceiros', { nome: 'Paula Parceira', email: 'paula@exemplo.com', descontoAluguel: 30, pctAtendimento: 20 });
  assert.equal(c.status, 201);
  assert.equal((await paula('GET', '/api/agenda')).dados.parceria, null, 'conta sem verificação: ainda sem desconto');
  assert.equal((await equipe('PATCH', `/api/admin/parceiros/${c.dados.id}`, { conferirConta: true })).status, 200);
  assert.equal((await paula('GET', '/api/agenda')).dados.parceria.descontoAluguel, 30);
  // o formulário do painel manda todos os campos, inclusive o mesmo e-mail
  assert.equal((await equipe('PATCH', `/api/admin/parceiros/${c.dados.id}`, { nome: 'Paula Parceira', email: 'paula@exemplo.com', descontoAluguel: 40, pctAtendimento: 20, observacao: '' })).status, 200);
  assert.equal((await paula('GET', '/api/agenda')).dados.parceria.descontoAluguel, 40, 'desconto continua valendo e já com o valor novo');
  // trocou o e-mail: a conferência antiga deixa de valer
  assert.equal((await equipe('PATCH', `/api/admin/parceiros/${c.dados.id}`, { email: 'outra@exemplo.com' })).status, 200);
  assert.equal((await equipe('PATCH', `/api/admin/parceiros/${c.dados.id}`, { email: 'paula@exemplo.com' })).status, 200);
  assert.equal((await paula('GET', '/api/agenda')).dados.parceria, null, 'precisa conferir de novo');
});
