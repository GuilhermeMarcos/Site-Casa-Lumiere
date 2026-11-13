// Testes da API com um banco em memória: `npm test`
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { preparar } from './preparar.mjs';
import handler from '../api/index.js';
import { agoraLocal, somarDias, diaSemana, fixoOcupa } from '../api/_lib/agenda.js';

let pg, servidor, base;
before(async () => {
  pg = await preparar();
  servidor = http.createServer(handler).listen(0);
  base = `http://127.0.0.1:${servidor.address().port}`;
});
after(() => servidor.close());

// Cliente com cookie próprio, como um navegador
function cliente() {
  let cookie = '';
  return async (metodo, caminho, corpo, extra = {}) => {
    const r = await fetch(base + caminho, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extra },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return { status: r.status, dados: await r.json() };
  };
}

// Um dia livre de horário fixo, alguns dias à frente, numa terça-feira não (Esmeralda tem fixo)
const hoje = agoraLocal().data;
let dia = somarDias(hoje, 3);
while (diaSemana(dia) === 2 || diaSemana(dia) === 3 || diaSemana(dia) === 4) dia = somarDias(dia, 1);

const ana = cliente(), bia = cliente(), equipe = cliente(), anonimo = cliente();

test('agenda pública com as salas e horários fixos iniciais', async () => {
  const { status, dados } = await anonimo('GET', '/api/agenda');
  assert.equal(status, 200);
  assert.deepEqual(dados.salas.map((s) => s.id), ['sala-02', 'sala-04', 'sala-06', 'sala-08', 'safira']);
  assert.equal(dados.salas.find((s) => s.id === 'safira').disponivel, false);
  assert.equal(dados.fixos.length, 4);
  assert.equal(dados.salas[0].valorHora, undefined, 'valor por hora não aparece no site');
  assert.equal(dados.geral.whatsappAgatha, '5519992487347');
});

test('regras dos horários fixos', async () => {
  const { dados } = await anonimo('GET', '/api/agenda');
  const f = dados.fixos;
  assert.ok(fixoOcupa(f, 'sala-08', '2026-11-17', 14), 'Esmeralda terça 14h');
  assert.ok(!fixoOcupa(f, 'sala-08', '2026-11-17', 19), 'Esmeralda terça 19h livre');
  assert.ok(fixoOcupa(f, 'sala-08', '2026-11-28', 8), 'Esmeralda a cada 15 dias, dia inteiro');
  assert.ok(!fixoOcupa(f, 'sala-04', '2026-11-25', 15), 'Estética só a partir de dezembro');
  assert.ok(fixoOcupa(f, 'sala-04', '2026-12-02', 15), 'Estética quarta em dezembro');
  assert.ok(!fixoOcupa(f, 'sala-06', '2027-01-28', 15) && fixoOcupa(f, 'sala-06', '2027-02-04', 15), 'Psicologia a partir de fevereiro');
});

test('reservar exige conta', async () => {
  const r = await anonimo('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [9] });
  assert.equal(r.status, 401);
});

test('cadastro, sessão e login', async () => {
  let r = await ana('POST', '/api/auth/cadastro', { nome: 'Ana Souza', email: 'Ana@Exemplo.com', telefone: '(19) 99999-1111', especialidade: 'Psicologia', senha: 'senha-forte-1' });
  assert.equal(r.status, 201);
  assert.equal(r.dados.conta.email, 'ana@exemplo.com');
  assert.equal(r.dados.conta.equipe, false);
  r = await ana('GET', '/api/auth/eu');
  assert.equal(r.dados.conta.nome, 'Ana Souza');
  r = await bia('POST', '/api/auth/cadastro', { nome: 'Bia', email: 'ana@exemplo.com', telefone: '19999992222', senha: 'outra-senha' });
  assert.equal(r.status, 409, 'e-mail repetido');
  r = await bia('POST', '/api/auth/cadastro', { nome: 'Bia Lima', email: 'bia@exemplo.com', telefone: '19999992222', senha: 'curta' });
  assert.equal(r.status, 400, 'senha curta');
  r = await bia('POST', '/api/auth/cadastro', { nome: 'Bia Lima', email: 'bia@exemplo.com', telefone: '19999992222', senha: 'outra-senha' });
  assert.equal(r.status, 201);
  await bia('POST', '/api/auth/sair');
  r = await bia('GET', '/api/auth/eu');
  assert.equal(r.dados.conta, null);
  r = await bia('POST', '/api/auth/entrar', { email: 'bia@exemplo.com', senha: 'errada-123' });
  assert.equal(r.status, 401);
  r = await bia('POST', '/api/auth/entrar', { email: 'BIA@exemplo.com', senha: 'outra-senha', lembrar: true });
  assert.equal(r.status, 200);
});

test('trava depois de 8 senhas erradas', async () => {
  const c = cliente();
  await c('POST', '/api/auth/cadastro', { nome: 'Teste Trava', email: 'trava@exemplo.com', telefone: '19999993333', senha: 'senha-certa-1' });
  for (let i = 0; i < 8; i++) await c('POST', '/api/auth/entrar', { email: 'trava@exemplo.com', senha: 'x' + i });
  const r = await c('POST', '/api/auth/entrar', { email: 'trava@exemplo.com', senha: 'senha-certa-1' });
  assert.equal(r.status, 429);
});

test('pré-reserva e horário disputado', async () => {
  let r = await ana('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [10, 9, 11] });
  assert.equal(r.status, 201);
  assert.equal(r.dados.reserva.status, 'pre');
  assert.deepEqual(r.dados.reserva.horas, [9, 10, 11]);
  const minutos = (new Date(r.dados.reserva.expiraEm) - Date.now()) / 60000;
  assert.ok(minutos > 85 && minutos <= 90, 'expira em 1h30');
  r = await bia('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [11, 12] });
  assert.equal(r.status, 409, 'Bia não pega as 11h da Ana');
  r = await bia('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [12, 13] });
  assert.equal(r.status, 201);
  const ag = await ana('GET', '/api/agenda');
  const meus = ag.dados.ocupados.filter((o) => o.data === dia && o.sala === 'sala-02');
  assert.equal(meus.length, 5);
  assert.equal(meus.filter((o) => o.minha).length, 3);
  assert.equal(ag.dados.ocupados[0].nome, undefined, 'a agenda não mostra nomes');
});

test('várias pré-reservas ao mesmo tempo no mesmo horário: só uma passa', async () => {
  const pessoas = [];
  for (let i = 0; i < 5; i++) {
    const c = cliente();
    await c('POST', '/api/auth/cadastro', { nome: 'Pessoa ' + i, email: `p${i}@exemplo.com`, telefone: '1999999000' + i, senha: 'senha-teste-1' });
    pessoas.push(c);
  }
  const res = await Promise.all(pessoas.map((c) => c('POST', '/api/reservas', { sala: 'sala-06', data: dia, horas: [15, 16] })));
  assert.equal(res.filter((r) => r.status === 201).length, 1);
  assert.equal(res.filter((r) => r.status === 409).length, 4);
});

test('horário fixo, sala indisponível e dia fora do prazo são recusados', async () => {
  let terca = somarDias(hoje, 1);
  while (diaSemana(terca) !== 2) terca = somarDias(terca, 1);
  let r = await ana('POST', '/api/reservas', { sala: 'sala-08', data: terca, horas: [15] });
  assert.equal(r.status, 409);
  r = await ana('POST', '/api/reservas', { sala: 'safira', data: dia, horas: [9] });
  assert.equal(r.status, 409);
  r = await ana('POST', '/api/reservas', { sala: 'sala-02', data: somarDias(hoje, 200), horas: [9] });
  assert.equal(r.status, 400);
  r = await ana('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [6] });
  assert.equal(r.status, 400, 'antes de abrir');
});

test('limite de pré-reservas abertas por conta', async () => {
  await ana('POST', '/api/reservas', { sala: 'sala-04', data: dia, horas: [8] });
  await ana('POST', '/api/reservas', { sala: 'sala-04', data: dia, horas: [9] });
  const r = await ana('POST', '/api/reservas', { sala: 'sala-04', data: dia, horas: [10] });
  assert.equal(r.status, 429);
});

test('cliente cancela a própria pré-reserva, não a dos outros', async () => {
  const { dados } = await ana('GET', '/api/reservas');
  const minha = dados.reservas.find((x) => x.sala === 'sala-04' && x.horas[0] === 9);
  let r = await bia('DELETE', '/api/reservas/' + minha.id);
  assert.equal(r.status, 404);
  r = await ana('DELETE', '/api/reservas/' + minha.id);
  assert.equal(r.status, 200);
});

test('pré-reserva expira e o horário volta a ficar livre', async () => {
  const { dados } = await bia('GET', '/api/reservas');
  const id = dados.reservas[0].id;
  await pg.query("UPDATE reservas SET expira_em = now() - interval '1 minute' WHERE id = $1", [id]);
  const ag = await anonimo('GET', '/api/agenda');
  assert.equal(ag.dados.ocupados.filter((o) => o.sala === 'sala-02' && o.data === dia && o.hora === 12).length, 0);
  const minhas = await bia('GET', '/api/reservas');
  assert.equal(minhas.dados.reservas[0].status, 'expirada');
});

test('equipe: e-mail da equipe precisa do código', async () => {
  let r = await equipe('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: 'equipe@casalumiere.com.br', telefone: '19992487347', senha: 'senha-da-casa' });
  assert.equal(r.status, 403);
  assert.equal(r.dados.erro, 'codigo_equipe');
  r = await equipe('POST', '/api/auth/cadastro', { nome: 'Luiza e Agatha', email: 'equipe@casalumiere.com.br', telefone: '19992487347', senha: 'senha-da-casa', codigoEquipe: 'lumiere' });
  assert.equal(r.status, 201);
  assert.equal(r.dados.conta.equipe, true);
  r = await ana('GET', '/api/admin/dados');
  assert.equal(r.status, 403, 'cliente não vê o painel');
});

test('equipe confirma, edita, cria e remove reservas', async () => {
  let r = await equipe('GET', '/api/admin/dados');
  assert.equal(r.status, 200);
  assert.equal(r.dados.conta.nome, 'Luiza e Agatha');
  const daAna = r.dados.reservas.find((x) => x.nome === 'Ana Souza' && x.sala === 'sala-02');
  assert.equal(daAna.emailConta, 'ana@exemplo.com');
  r = await equipe('POST', `/api/admin/reservas/${daAna.id}/confirmar`);
  assert.equal(r.status, 200);
  r = await ana('GET', '/api/reservas');
  assert.equal(r.dados.reservas.find((x) => x.id === daAna.id).status, 'confirmada');
  r = await ana('DELETE', '/api/reservas/' + daAna.id);
  assert.equal(r.status, 409, 'confirmada só a Agatha cancela');
  // reserva feita por WhatsApp
  r = await equipe('POST', '/api/admin/reservas', { sala: 'sala-02', data: dia, horas: [14, 15], nome: 'Cliente do WhatsApp', telefone: '19999990000', status: 'confirmada' });
  assert.equal(r.status, 201);
  const nova = r.dados.id;
  r = await equipe('PATCH', '/api/admin/reservas/' + nova, { sala: 'sala-02', data: dia, horas: [11, 12], nome: 'Cliente do WhatsApp', status: 'confirmada' });
  assert.equal(r.status, 409, 'não edita por cima da Ana');
  r = await equipe('PATCH', '/api/admin/reservas/' + nova, { sala: 'sala-02', data: dia, horas: [16, 17], nome: 'Cliente do WhatsApp', status: 'confirmada' });
  assert.equal(r.status, 200);
  r = await anonimo('GET', '/api/agenda');
  const h = r.dados.ocupados.filter((o) => o.sala === 'sala-02' && o.data === dia).map((o) => o.hora).sort((a, b) => a - b);
  assert.deepEqual(h, [9, 10, 11, 16, 17]);
  r = await equipe('DELETE', '/api/admin/reservas/' + nova);
  assert.equal(r.status, 200);
});

test('equipe confirma pré-reserva que expirou se o horário continua livre', async () => {
  const { dados } = await bia('GET', '/api/reservas');
  const exp = dados.reservas.find((x) => x.status === 'expirada');
  const r = await equipe('POST', `/api/admin/reservas/${exp.id}/confirmar`);
  assert.equal(r.status, 200);
  const ag = await anonimo('GET', '/api/agenda');
  assert.ok(ag.dados.ocupados.some((o) => o.sala === 'sala-02' && o.data === dia && o.hora === 12 && o.status === 'confirmada'));
});

test('equipe altera salas, fotos, horários fixos e funcionamento', async () => {
  let r = await equipe('PATCH', '/api/admin/salas/safira', { disponivel: true, tipo: 'Atendimento', valorHora: 45.5, descricao: 'Sala clara' });
  assert.equal(r.status, 200);
  r = await anonimo('GET', '/api/agenda');
  assert.equal(r.dados.salas.find((s) => s.id === 'safira').disponivel, true);
  r = await equipe('GET', '/api/admin/dados');
  assert.equal(r.dados.salas.find((s) => s.id === 'safira').valorHora, 45.5);
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  r = await equipe('POST', '/api/admin/salas/safira/foto', { imagem: png });
  assert.equal(r.status, 200);
  assert.match(r.dados.foto, /safira/);
  r = await equipe('POST', '/api/admin/salas/safira/foto', { imagem: 'data:text/html;base64,PGgxPg==' });
  assert.equal(r.status, 400);
  r = await equipe('POST', '/api/admin/fixos', { sala: 'safira', repete: 'unico', de: 9, ate: 11, desde: dia });
  assert.equal(r.status, 201);
  r = await ana('POST', '/api/reservas', { sala: 'safira', data: dia, horas: [10] });
  assert.ok(r.status === 409);
  r = await equipe('PUT', '/api/admin/config', { abre: 8, fecha: 21, diasAFrente: 60, diasAbertos: [1, 2, 3, 4, 5, 6], whatsappAgatha: '(19) 99248-7347', botaoTeste: false });
  assert.equal(r.status, 200);
  assert.equal(r.dados.geral.whatsappAgatha, '5519992487347');
  r = await anonimo('GET', '/api/agenda');
  assert.equal(r.dados.geral.abre, 8);
  assert.equal(r.dados.geral.botaoTeste, false);
  r = await equipe('POST', '/api/admin/salas');
  assert.equal(r.status, 201);
});

test('senhas: equipe redefine a de um cliente e a própria com o código', async () => {
  let r = await equipe('POST', '/api/admin/usuarios/senha', { email: 'bia@exemplo.com', senhaNova: 'nova-senha-bia' });
  assert.equal(r.status, 200);
  r = await cliente()('POST', '/api/auth/entrar', { email: 'bia@exemplo.com', senha: 'nova-senha-bia' });
  assert.equal(r.status, 200);
  r = await anonimo('POST', '/api/auth/redefinir-equipe', { email: 'equipe@casalumiere.com.br', codigo: 'errado', senhaNova: 'nova-senha-casa' });
  assert.equal(r.status, 403);
  r = await anonimo('POST', '/api/auth/redefinir-equipe', { email: 'equipe@casalumiere.com.br', codigo: 'lumiere', senhaNova: 'nova-senha-casa' });
  assert.equal(r.status, 200);
  r = await cliente()('POST', '/api/auth/entrar', { email: 'equipe@casalumiere.com.br', senha: 'nova-senha-casa' });
  assert.equal(r.status, 200);
});

test('pedido vindo de outro site é recusado', async () => {
  const r = await ana('POST', '/api/reservas', { sala: 'sala-02', data: dia, horas: [18] }, { Origin: 'https://site-estranho.com' });
  assert.equal(r.status, 403);
});

test('rota inexistente e rota da Vercel com ?rota=', async () => {
  let r = await anonimo('GET', '/api/nada');
  assert.equal(r.status, 404);
  r = await anonimo('GET', '/api/index?rota=agenda');
  assert.equal(r.status, 200);
});
