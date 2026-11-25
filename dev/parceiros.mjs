// Testes de preços por quantidade de horas, parceiros e atendimentos (inclusive tentativas de fraude). `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar, caixaDeEntrada } from './preparar.mjs';
import handler from '../api/index.js';
import { usarCorreio } from '../api/_lib/correio.js';
import { agoraLocal, somarDias, diaSemana } from '../api/_lib/agenda.js';
import { calcularValor, validarPrecos } from '../api/_lib/precos.js';

let pg, servidor, base;
before(async () => {
  pg = await preparar();
  servidor = http.createServer(handler).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

let ipSeq = 1;
function cliente(ip = `100.64.0.${ipSeq++}`) {
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
const hoje = agoraLocal().data;
let dia = somarDias(hoje, 5);
while ([2, 3, 4].includes(diaSemana(dia))) dia = somarDias(dia, 1);
const equipe = cliente(), comum = cliente(), parceira = cliente(), impostora = cliente();
const PRECOS = [{ horas: 1, valor: 50 }, { horas: 4, valor: 180 }, { horas: 8, valor: 320 }];

test('cálculo do total pela tabela de horas', () => {
  assert.equal(calcularValor(PRECOS, 1), 50);
  assert.equal(calcularValor(PRECOS, 3), 150);
  assert.equal(calcularValor(PRECOS, 4), 180);
  assert.equal(calcularValor(PRECOS, 5), 230);
  assert.equal(calcularValor(PRECOS, 8), 320, 'usa o pacote de 8h, mais barato que 4h + 4h');
  assert.equal(calcularValor(PRECOS, 13), 550);
  assert.equal(calcularValor([{ horas: 4, valor: 180 }], 3), null, 'sem linha que forme 3h: valor a combinar');
  assert.equal(calcularValor([], 2), null);
  assert.equal(calcularValor([{ horas: 1, valor: 33.33 }], 3), 99.99, 'centavos certos');
  assert.throws(() => validarPrecos([{ horas: 1, valor: 50 }, { horas: 1, valor: 40 }]));
  assert.throws(() => validarPrecos([{ horas: 0, valor: 50 }]));
  assert.throws(() => validarPrecos([{ horas: 2, valor: -5 }]));
  assert.throws(() => validarPrecos([{ horas: 2, valor: 'abc' }]));
  assert.throws(() => validarPrecos(new Array(13).fill(0).map((_, i) => ({ horas: i + 1, valor: 10 }))));
});

test('preparação: equipe, cliente comum e a parceira', async () => {
  assert.equal((await equipe('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: 'equipe@casalumiere.com.br', telefone: '19992487347', senha: 'Casa-Forte-2026', codigoEquipe: 'lumiere' })).status, 201);
  assert.equal((await comum('POST', '/api/auth/cadastro', { nome: 'Cliente Comum', email: 'comum@exemplo.com', telefone: '19990000001', senha: 'Senha-Comum-1' })).status, 201);
  assert.equal((await parceira('POST', '/api/auth/cadastro', { nome: 'Paula Parceira', email: 'paula@exemplo.com', telefone: '19990000002', senha: 'Senha-Paula-1' })).status, 201);
});

test('a equipe monta a tabela de preços e o site mostra', async () => {
  assert.equal((await equipe('PATCH', '/api/admin/salas/sala-02', { precos: PRECOS })).status, 200);
  assert.equal((await equipe('PATCH', '/api/admin/salas/sala-04', { precos: [{ horas: 1, valor: 60 }] })).status, 200);
  assert.equal((await equipe('PATCH', '/api/admin/salas/sala-02', { precos: [{ horas: 1, valor: '50; DROP TABLE salas' }] })).status, 400);
  assert.equal((await comum('PATCH', '/api/admin/salas/sala-02', { precos: [{ horas: 1, valor: 1 }] })).status, 403, 'cliente não muda preço');
  const ag = await comum('GET', '/api/agenda');
  assert.deepEqual(ag.dados.salas.find((s) => s.id === 'sala-02').precos, PRECOS);
});

test('o cliente comum paga o preço da tabela, calculado pelo servidor', async () => {
  const r = await comum('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [8, 9, 10, 11, 12], valor: 1, valorCheio: 1, descontoPct: 100, parceiroId: 'x' });
  assert.equal(r.status, 201);
  assert.equal(r.dados.reserva.valor, 230, 'o valor mandado pelo navegador é ignorado');
  assert.equal(r.dados.reserva.descontoPct, null);
});

test('a equipe cadastra a parceira; com o e-mail sem verificação, o desconto só vale depois de conferir', async () => {
  let r = await equipe('POST', '/api/admin/parceiros', { nome: 'Paula Parceira', email: 'Paula@Exemplo.com', descontoAluguel: 30, pctAtendimento: 20 });
  assert.equal(r.status, 201);
  const idParceira = r.dados.id;
  assert.equal((await equipe('POST', '/api/admin/parceiros', { nome: 'Dupla', email: 'paula@exemplo.com', descontoAluguel: 10, pctAtendimento: 10 })).status, 409);
  assert.equal((await equipe('POST', '/api/admin/parceiros', { nome: 'X', email: 'x@exemplo.com', descontoAluguel: 150, pctAtendimento: 10 })).status, 400, 'desconto acima de 100%');
  assert.equal((await comum('POST', '/api/admin/parceiros', { nome: 'Eu mesma', email: 'comum@exemplo.com', descontoAluguel: 100, pctAtendimento: 0 })).status, 403, 'cliente não se faz parceiro');
  let d = await equipe('GET', '/api/admin/dados');
  assert.equal(d.dados.parceiros.find((p) => p.id === idParceira).conta, 'nao_verificada');
  assert.equal((await parceira('GET', '/api/agenda')).dados.parceria, null, 'ainda sem desconto');
  r = await equipe('PATCH', '/api/admin/parceiros/' + idParceira, { conferirConta: true });
  assert.equal(r.status, 200);
  d = await equipe('GET', '/api/admin/dados');
  assert.equal(d.dados.parceiros.find((p) => p.id === idParceira).conta, 'conferida');
  assert.deepEqual((await parceira('GET', '/api/agenda')).dados.parceria, { pctAtendimento: 20 }, 'o site recebe só a porcentagem dos atendimentos');
});

test('a parceira não paga aluguel: a reserva sai sem valor, com a porcentagem dos atendimentos', async () => {
  const r = await parceira('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [14, 15, 16, 17] });
  assert.equal(r.status, 201);
  assert.equal(r.dados.reserva.valorCheio, 180, 'o preço normal fica guardado só para referência');
  assert.equal(r.dados.reserva.valor, null);
  assert.equal(r.dados.reserva.pctParceiro, 20);
  assert.ok(r.dados.reserva.parceiroId);
  const outras = (await comum('GET', '/api/agenda')).dados;
  assert.equal(outras.parceria, null, 'a parceria de uma não aparece para outra pessoa');
});

test('fraude: criar conta com o e-mail da parceira depois que a conferida saiu não herda o desconto', async () => {
  // A parceira apaga a conta; alguém cria outra com o mesmo e-mail (sem verificação por e-mail)
  await parceira('POST', '/api/reservas', {}).catch(() => {});
  const [{ id }] = (await pg.query("SELECT id FROM usuarios WHERE email = 'paula@exemplo.com'")).rows;
  await pg.query("DELETE FROM reservas WHERE usuario_id = $1 AND status <> 'confirmada'", [id]);
  await pg.query('DELETE FROM usuarios WHERE id = $1', [id]);
  assert.equal((await impostora('POST', '/api/auth/cadastro', { nome: 'Impostora', email: 'paula@exemplo.com', telefone: '19990000003', senha: 'Senha-Falsa-1' })).status, 201);
  assert.equal((await impostora('GET', '/api/agenda')).dados.parceria, null);
  const r = await impostora('POST', '/api/reservas', { sala: 'sala-04', data: dia, horas: [9] });
  assert.equal(r.dados.reserva.valor, 60, 'paga o preço cheio');
  assert.equal((await impostora('GET', '/api/parceria')).dados.parceria, null, 'e não vê o extrato');
});

test('com o e-mail confirmado por código, a parceria vale direto', async () => {
  usarCorreio(async (m) => caixaDeEntrada.push(m));
  const nova = cliente();
  await equipe('POST', '/api/admin/parceiros', { nome: 'Rita', email: 'rita@exemplo.com', descontoAluguel: 50, pctAtendimento: 15 });
  await nova('POST', '/api/auth/codigo', { email: 'rita@exemplo.com', finalidade: 'cadastro' });
  const codigo = /(\d{6})/.exec([...caixaDeEntrada].reverse().find((m) => m.para === 'rita@exemplo.com').assunto)[1];
  assert.equal((await nova('POST', '/api/auth/cadastro', { nome: 'Rita', email: 'rita@exemplo.com', telefone: '19990000004', senha: 'Senha-Rita-1', codigo })).status, 201);
  assert.deepEqual((await nova('GET', '/api/agenda')).dados.parceria, { pctAtendimento: 15 });
  usarCorreio(null);
});

test('a equipe lança atendimentos, o sistema calcula o repasse e a parceira vê o extrato', async () => {
  const d = (await equipe('GET', '/api/admin/dados')).dados;
  const rita = d.parceiros.find((p) => p.email === 'rita@exemplo.com');
  let r = await equipe('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: hoje, quantidade: 6, valorTotal: 1200, repasse: 1 });
  assert.equal(r.status, 201);
  assert.equal(r.dados.repasse, 180, '15% de 1200, calculado no servidor');
  const idAt = r.dados.id;
  assert.equal((await equipe('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: somarDias(hoje, 10), quantidade: 1, valorTotal: 100 })).status, 400, 'atendimento no futuro');
  assert.equal((await equipe('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: hoje, quantidade: 0, valorTotal: 100 })).status, 400);
  assert.equal((await equipe('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: hoje, quantidade: 2, valorTotal: -50 })).status, 400);
  assert.equal((await equipe('POST', '/api/admin/atendimentos', { parceiro: 'nao-existe', data: hoje, quantidade: 2, valorTotal: 50 })).status, 400);
  r = await equipe('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: hoje, quantidade: 2, valorTotal: 300, pct: 10 });
  assert.equal(r.dados.repasse, 30, 'porcentagem diferente só neste lançamento');
  // mudar a porcentagem da parceria não muda o que já foi lançado
  await equipe('PATCH', '/api/admin/parceiros/' + rita.id, { pctAtendimento: 40 });
  r = await equipe('PATCH', '/api/admin/atendimentos/' + idAt, { valorTotal: 1000 });
  assert.equal(r.status, 200);
  let lista = (await equipe('GET', '/api/admin/dados')).dados.atendimentos;
  assert.equal(lista.find((a) => a.id === idAt).repasse, 150, 'continua 15% do lançamento');
  assert.equal((await equipe('PATCH', '/api/admin/atendimentos/' + idAt, { status: 'recebido' })).status, 200);
  assert.equal((await equipe('PATCH', '/api/admin/atendimentos/' + idAt, { status: 'pago-por-mim' })).status, 400);
  lista = (await equipe('GET', '/api/admin/dados')).dados.atendimentos;
  assert.equal(lista.find((a) => a.id === idAt).status, 'recebido');
  // a parceira vê o extrato; não altera nada
  const rita2 = cliente();
  await rita2('POST', '/api/auth/entrar', { email: 'rita@exemplo.com', senha: 'Senha-Rita-1' });
  const ex = (await rita2('GET', '/api/parceria')).dados;
  assert.equal(ex.parceria.pctAtendimento, 40);
  const mes = ex.meses.find((m) => m.mes === hoje.slice(0, 7));
  assert.equal(mes.atendimentos, 8);
  assert.equal(mes.repasse, 180);
  assert.equal(mes.repassePendente, 30);
  assert.equal((await rita2('PATCH', '/api/admin/atendimentos/' + idAt, { status: 'pendente' })).status, 403);
  assert.equal((await rita2('POST', '/api/admin/atendimentos', { parceiro: rita.id, data: hoje, quantidade: 1, valorTotal: 1 })).status, 403);
  // outra pessoa não vê o extrato da parceira
  assert.equal((await comum('GET', '/api/parceria')).dados.parceria, null);
});

test('parceiro com histórico não é apagado, só desativado; desativado perde o desconto', async () => {
  const d = (await equipe('GET', '/api/admin/dados')).dados;
  const rita = d.parceiros.find((p) => p.email === 'rita@exemplo.com');
  assert.equal((await equipe('DELETE', '/api/admin/parceiros/' + rita.id)).status, 409);
  assert.equal((await equipe('PATCH', '/api/admin/parceiros/' + rita.id, { ativo: false })).status, 200);
  const rita2 = cliente();
  await rita2('POST', '/api/auth/entrar', { email: 'rita@exemplo.com', senha: 'Senha-Rita-1' });
  assert.equal((await rita2('GET', '/api/agenda')).dados.parceria, null);
});

test('a equipe lança uma reserva de parceiro pelo painel e pode ajustar o valor', async () => {
  const d = (await equipe('GET', '/api/admin/dados')).dados;
  const paula = d.parceiros.find((p) => p.email === 'paula@exemplo.com');
  let r = await equipe('POST', '/api/admin/reservas', { sala: 'sala-02', data: dia, horas: [18, 19], nome: 'Paula', parceiro: paula.id, status: 'confirmada' });
  assert.equal(r.status, 201);
  let res = (await equipe('GET', '/api/admin/dados')).dados.reservas.find((x) => x.id === r.dados.id);
  assert.equal(res.valor, null, 'parceiro: sem aluguel');
  assert.equal(res.pctParceiro, 20);
  r = await equipe('PATCH', '/api/admin/reservas/' + res.id, { sala: 'sala-02', data: dia, horas: [18, 19], nome: 'Paula', parceiro: paula.id, valor: '65.5', status: 'confirmada' });
  assert.equal(r.status, 200);
  res = (await equipe('GET', '/api/admin/dados')).dados.reservas.find((x) => x.id === res.id);
  assert.equal(res.valor, 65.5);
  assert.equal((await equipe('PATCH', '/api/admin/reservas/' + res.id, { sala: 'sala-02', data: dia, horas: [18, 19], nome: 'Paula', valor: -10 })).status, 400);
});
