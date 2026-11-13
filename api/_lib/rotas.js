// Todas as rotas da API. Cada uma recebe (req, params, corpo) e devolve [status, dados, cabeçalhos?].
import { randomUUID, randomBytes } from 'node:crypto';
import { q, tx, violouUnico } from './db.js';
import { Falha, texto } from './http.js';
import {
  gerarHash, conferirSenha, cookieSessao, cookieSair, publico, usuarioAtual, exigirLogin, exigirEquipe,
  ehEquipe, checarBloqueio, registrarFalha, limparFalhas, codigoEquipeConfere,
} from './auth.js';
import { agoraLocal, dataValida, diaSemana, somarDias, fixoOcupa, horasValidas } from './agenda.js';
import { GERAL_PADRAO } from './esquema.js';
import { guardarFoto } from './armazenamento.js';

const EXPIRA_MIN = 90;          // pré-reserva sem confirmação expira em 1h30
const MAX_PRE_POR_CLIENTE = 3;  // pré-reservas abertas ao mesmo tempo por conta

/* ===== Consultas que se repetem ===== */
const EXPIRAR = [
  ["UPDATE reservas SET status = 'expirada' WHERE status = 'pre' AND expira_em IS NOT NULL AND expira_em < now()"],
  ["DELETE FROM reserva_horas h USING reservas r WHERE h.reserva_id = r.id AND r.status = 'expirada'"],
];
const SQL_GERAL = ["SELECT valor FROM config WHERE chave = 'geral'"];
const SQL_SALAS = ['SELECT id, nome, tipo, descricao, foto_url AS foto, disponivel, ordem, valor_hora::float8 AS "valorHora" FROM salas ORDER BY ordem, nome'];
const SQL_FIXOS = ['SELECT id, sala, repete, dia_semana AS "diaSemana", a_cada_dias AS "aCadaDias", de, ate, desde::text AS desde FROM fixos ORDER BY sala, de'];
const COLS_RESERVA = `r.id, r.sala, r.data::text AS data, r.horas, r.nome, r.especialidade, r.telefone, r.status, r.origem,
  r.expira_em AS "expiraEm", r.criado_em AS "criadoEm", r.confirmada_em AS "confirmadaEm"`;

const geralDe = (linhas) => ({ ...GERAL_PADRAO, ...((linhas[0] && linhas[0].valor) || {}) });
const semValor = ({ valorHora, ...s }) => s;
const novoId = (pre) => `${pre}${randomBytes(5).toString('hex')}`;

function soDigitos(v) { return String(v || '').replace(/\D/g, ''); }
function emailOk(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120; }
function telefoneOk(t) { const n = soDigitos(t); return n.length >= 10 && n.length <= 13; }

/* ===== Validação de um pedido de reserva ===== */
async function validarPedido({ sala, data, horas }, { equipe }) {
  const [, , g, salas, fixos] = await tx([...EXPIRAR, SQL_GERAL, SQL_SALAS, SQL_FIXOS]);
  const geral = geralDe(g);
  const s = salas.find((x) => x.id === sala);
  if (!s) throw new Falha(404, 'sala', 'Essa sala não existe.');
  if (!s.disponivel && !equipe) throw new Falha(409, 'sala_indisponivel', 'Essa sala não está disponível para reserva.');
  if (!dataValida(data)) throw new Falha(400, 'data', 'Escolha um dia válido.');
  const lista = horasValidas(horas, geral);
  if (!lista) throw new Falha(400, 'horas', `Escolha horários entre ${geral.abre}h e ${geral.fecha}h.`);
  if (!equipe) {
    const agora = agoraLocal();
    if (data < agora.data || data > somarDias(agora.data, geral.diasAFrente)) throw new Falha(400, 'data', 'Esse dia não está aberto para reserva.');
    if (!geral.diasAbertos.includes(diaSemana(data))) throw new Falha(400, 'dia_fechado', 'A Casa não abre nesse dia da semana.');
    if (data === agora.data && lista.some((h) => h <= agora.hora)) throw new Falha(409, 'passou', 'Um dos horários já começou. Escolha outro.');
  }
  const fixo = lista.find((h) => fixoOcupa(fixos, sala, data, h));
  if (fixo !== undefined) throw new Falha(409, 'fixo', `${fixo}h é um horário fixo dessa sala.`);
  return { geral, sala: s, horas: lista };
}

const INSERIR_HORAS = 'INSERT INTO reserva_horas (sala, data, hora, reserva_id) SELECT $1, $2::date, unnest($3::smallint[]), $4';

function ocupado(e) {
  if (violouUnico(e)) return new Falha(409, 'ocupado', 'Alguém acabou de reservar um desses horários. Escolha outro.');
  return e;
}

/* ===== Público ===== */
async function agenda(req) {
  const u = await usuarioAtual(req);
  const agora = agoraLocal();
  const [, , g, salas, fixos] = await tx([...EXPIRAR, SQL_GERAL, SQL_SALAS, SQL_FIXOS]);
  const geral = geralDe(g);
  const ate = somarDias(agora.data, geral.diasAFrente + 1);
  const ocupados = await q(
    `SELECT h.sala, h.data::text AS data, h.hora, r.status, COALESCE(r.usuario_id = $1, false) AS minha
       FROM reserva_horas h JOIN reservas r ON r.id = h.reserva_id
      WHERE h.data >= $2::date AND h.data <= $3::date`,
    [u ? u.id : null, agora.data, ate],
  );
  return [200, {
    agora,
    geral: { abre: geral.abre, fecha: geral.fecha, diasAFrente: geral.diasAFrente, diasAbertos: geral.diasAbertos, whatsappAgatha: geral.whatsappAgatha },
    salas: salas.map(semValor),
    fixos,
    ocupados,
  }];
}

/* ===== Conta ===== */
async function cadastro(req, _p, c) {
  const nome = texto(c.nome, 80), email = texto(c.email, 120).toLowerCase();
  const telefone = texto(c.telefone, 20), especialidade = texto(c.especialidade, 80), senha = String(c.senha || '');
  if (nome.length < 2) throw new Falha(400, 'nome', 'Digite o seu nome.');
  if (!emailOk(email)) throw new Falha(400, 'email', 'Digite um e-mail válido.');
  if (!telefoneOk(telefone)) throw new Falha(400, 'telefone', 'Digite o WhatsApp com DDD.');
  if (senha.length < 8 || senha.length > 200) throw new Falha(400, 'senha', 'A senha precisa ter pelo menos 8 caracteres.');
  if (ehEquipe(email) && !codigoEquipeConfere(c.codigoEquipe)) {
    await checarBloqueio(email);
    if (c.codigoEquipe) await registrarFalha(email);
    throw new Falha(403, 'codigo_equipe', c.codigoEquipe ? 'O código da equipe não confere.' : 'Este e-mail é da equipe da Casa. Digite o código da equipe para criar a conta.');
  }
  const id = randomUUID();
  try {
    await q('INSERT INTO usuarios (id, nome, email, telefone, especialidade, senha_hash) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, nome, email, telefone, especialidade, await gerarHash(senha)]);
  } catch (e) {
    if (violouUnico(e)) throw new Falha(409, 'email_existe', 'Já existe uma conta com este e-mail. Use "Entrar".');
    throw e;
  }
  return [201, { conta: publico({ id, nome, email, telefone, especialidade }) }, { 'Set-Cookie': cookieSessao(req, id, c.lembrar !== false) }];
}

async function entrar(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase(), senha = String(c.senha || '');
  if (!email || !senha) throw new Falha(400, 'campos', 'Digite o e-mail e a senha.');
  await checarBloqueio(email);
  const [u] = await q('SELECT id, nome, email, telefone, especialidade, senha_hash FROM usuarios WHERE email = $1', [email]);
  if (!u || !(await conferirSenha(senha, u.senha_hash))) {
    await registrarFalha(email);
    throw new Falha(401, 'senha', 'E-mail ou senha incorretos.');
  }
  await limparFalhas(email);
  return [200, { conta: publico(u) }, { 'Set-Cookie': cookieSessao(req, u.id, !!c.lembrar) }];
}

const sair = async (req) => [200, { ok: true }, { 'Set-Cookie': cookieSair(req) }];

async function eu(req) {
  const u = await usuarioAtual(req);
  return [200, { conta: u ? publico(u) : null }];
}

async function atualizarEu(req, _p, c) {
  const u = await exigirLogin(req);
  const nome = c.nome !== undefined ? texto(c.nome, 80) : u.nome;
  const telefone = c.telefone !== undefined ? texto(c.telefone, 20) : u.telefone;
  const especialidade = c.especialidade !== undefined ? texto(c.especialidade, 80) : u.especialidade;
  if (nome.length < 2) throw new Falha(400, 'nome', 'Digite o seu nome.');
  if (!telefoneOk(telefone)) throw new Falha(400, 'telefone', 'Digite o WhatsApp com DDD.');
  if (c.senhaNova) {
    const nova = String(c.senhaNova);
    if (nova.length < 8 || nova.length > 200) throw new Falha(400, 'senha', 'A senha nova precisa ter pelo menos 8 caracteres.');
    const [s] = await q('SELECT senha_hash FROM usuarios WHERE id = $1', [u.id]);
    if (!(await conferirSenha(String(c.senhaAtual || ''), s.senha_hash))) throw new Falha(400, 'senha_atual', 'A senha atual não confere.');
    await q('UPDATE usuarios SET senha_hash = $2 WHERE id = $1', [u.id, await gerarHash(nova)]);
  }
  await q('UPDATE usuarios SET nome = $2, telefone = $3, especialidade = $4 WHERE id = $1', [u.id, nome, telefone, especialidade]);
  return [200, { conta: publico({ ...u, nome, telefone, especialidade }) }];
}

// A equipe esqueceu a senha: com o código da equipe, cria uma senha nova
async function redefinirEquipe(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase(), nova = String(c.senhaNova || '');
  if (!ehEquipe(email)) throw new Falha(400, 'nao_equipe', 'Este e-mail não é da equipe. Clientes pedem a senha nova para a Casa pelo WhatsApp.');
  await checarBloqueio(email);
  if (!codigoEquipeConfere(c.codigo)) { await registrarFalha(email); throw new Falha(403, 'codigo_equipe', 'O código da equipe não confere.'); }
  if (nova.length < 8 || nova.length > 200) throw new Falha(400, 'senha', 'A senha nova precisa ter pelo menos 8 caracteres.');
  const r = await q('UPDATE usuarios SET senha_hash = $2 WHERE email = $1 RETURNING id', [email, await gerarHash(nova)]);
  if (!r.length) throw new Falha(404, 'sem_conta', 'Ainda não existe conta com este e-mail. Use "Criar conta".');
  await limparFalhas(email);
  return [200, { ok: true }];
}

/* ===== Reservas do cliente ===== */
async function minhas(req) {
  const u = await exigirLogin(req);
  const hoje = agoraLocal().data;
  const [, , reservas] = await tx([...EXPIRAR, [
    `SELECT ${COLS_RESERVA} FROM reservas r WHERE r.usuario_id = $1 AND r.data >= $2::date ORDER BY r.data, r.horas[1]`, [u.id, hoje],
  ]]);
  return [200, { reservas }];
}

async function preReservar(req, _p, c) {
  const u = await exigirLogin(req);
  if (!telefoneOk(u.telefone)) throw new Falha(400, 'telefone', 'Coloque o seu WhatsApp na sua conta antes de reservar.');
  const v = await validarPedido({ sala: texto(c.sala, 40), data: texto(c.data, 10), horas: c.horas }, { equipe: false });
  const [abertas] = await q("SELECT count(*)::int AS n FROM reservas WHERE usuario_id = $1 AND status = 'pre'", [u.id]);
  if (abertas.n >= MAX_PRE_POR_CLIENTE) throw new Falha(429, 'limite_pre', 'Você já tem pré-reservas esperando a Agatha. Fale com ela antes de fazer outra.');
  const id = randomUUID();
  const data = texto(c.data, 10);
  try {
    await tx([
      ...EXPIRAR,
      [`INSERT INTO reservas (id, sala, usuario_id, data, horas, nome, especialidade, telefone, status, origem, expira_em)
        VALUES ($1, $2, $3, $4::date, $5::smallint[], $6, $7, $8, 'pre', 'site', now() + interval '${EXPIRA_MIN} minutes')`,
      [id, v.sala.id, u.id, data, v.horas, u.nome, u.especialidade, u.telefone]],
      [INSERIR_HORAS, [v.sala.id, data, v.horas, id]],
    ]);
  } catch (e) { throw ocupado(e); }
  const [reserva] = await q(`SELECT ${COLS_RESERVA} FROM reservas r WHERE r.id = $1`, [id]);
  return [201, { reserva }];
}

async function cancelarMinha(req, p) {
  const u = await exigirLogin(req);
  const [r] = await q('SELECT status FROM reservas WHERE id = $1 AND usuario_id = $2', [p.id, u.id]);
  if (!r) throw new Falha(404, 'reserva', 'Reserva não encontrada.');
  if (r.status === 'confirmada') throw new Falha(409, 'confirmada', 'Esta reserva já foi confirmada. Para cancelar, fale com a Agatha.');
  await q('DELETE FROM reservas WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

/* ===== Equipe ===== */
async function dadosEquipe(req) {
  const u = await exigirEquipe(req);
  const desde = somarDias(agoraLocal().data, -60);
  const [, , g, salas, fixos, reservas] = await tx([...EXPIRAR, SQL_GERAL, SQL_SALAS, SQL_FIXOS, [
    `SELECT ${COLS_RESERVA}, us.email AS "emailConta"
       FROM reservas r LEFT JOIN usuarios us ON us.id = r.usuario_id
      WHERE r.data >= $1::date ORDER BY r.data, r.horas[1]`, [desde],
  ]]);
  return [200, { conta: publico(u), agora: agoraLocal(), geral: geralDe(g), salas, fixos, reservas }];
}

function dadosPessoa(c) {
  const nome = texto(c.nome, 80);
  if (!nome) throw new Falha(400, 'nome', 'Digite o nome de quem vai usar a sala.');
  return { nome, especialidade: texto(c.especialidade, 80), telefone: texto(c.telefone, 20) };
}

async function criarReservaEquipe(req, _p, c) {
  await exigirEquipe(req);
  const pessoa = dadosPessoa(c);
  const v = await validarPedido({ sala: texto(c.sala, 40), data: texto(c.data, 10), horas: c.horas }, { equipe: true });
  const status = c.status === 'pre' ? 'pre' : 'confirmada';
  const id = randomUUID(), data = texto(c.data, 10);
  try {
    await tx([
      ...EXPIRAR,
      [`INSERT INTO reservas (id, sala, data, horas, nome, especialidade, telefone, status, origem, confirmada_em)
        VALUES ($1, $2, $3::date, $4::smallint[], $5, $6, $7, $8, 'painel', CASE WHEN $8 = 'confirmada' THEN now() END)`,
      [id, v.sala.id, data, v.horas, pessoa.nome, pessoa.especialidade, pessoa.telefone, status]],
      [INSERIR_HORAS, [v.sala.id, data, v.horas, id]],
    ]);
  } catch (e) { throw ocupado(e); }
  return [201, { id }];
}

async function editarReservaEquipe(req, p, c) {
  await exigirEquipe(req);
  const [atual] = await q('SELECT id, status FROM reservas WHERE id = $1', [p.id]);
  if (!atual) throw new Falha(404, 'reserva', 'Reserva não encontrada.');
  const pessoa = dadosPessoa(c);
  const v = await validarPedido({ sala: texto(c.sala, 40), data: texto(c.data, 10), horas: c.horas }, { equipe: true });
  const status = c.status === 'pre' ? 'pre' : 'confirmada';
  const data = texto(c.data, 10);
  try {
    await tx([
      ['DELETE FROM reserva_horas WHERE reserva_id = $1', [p.id]],
      [`UPDATE reservas SET sala = $2, data = $3::date, horas = $4::smallint[], nome = $5, especialidade = $6, telefone = $7,
          status = $8, expira_em = NULL,
          confirmada_em = CASE WHEN $8 = 'confirmada' THEN COALESCE(confirmada_em, now()) END
        WHERE id = $1`,
      [p.id, v.sala.id, data, v.horas, pessoa.nome, pessoa.especialidade, pessoa.telefone, status]],
      [INSERIR_HORAS, [v.sala.id, data, v.horas, p.id]],
    ]);
  } catch (e) { throw ocupado(e); }
  return [200, { ok: true }];
}

async function confirmarEquipe(req, p) {
  await exigirEquipe(req);
  const [r] = await q('SELECT sala, data::text AS data, horas, status FROM reservas WHERE id = $1', [p.id]);
  if (!r) throw new Falha(404, 'reserva', 'Reserva não encontrada.');
  if (r.status === 'confirmada') return [200, { ok: true }];
  const [fixos] = await tx([SQL_FIXOS]);
  if (r.horas.some((h) => fixoOcupa(fixos, r.sala, r.data, h))) throw new Falha(409, 'fixo', 'Esse horário virou horário fixo. Edite a reserva antes de confirmar.');
  try {
    await tx([
      ["UPDATE reservas SET status = 'confirmada', confirmada_em = now(), expira_em = NULL WHERE id = $1", [p.id]],
      ['DELETE FROM reserva_horas WHERE reserva_id = $1', [p.id]],
      [INSERIR_HORAS, [r.sala, r.data, r.horas, p.id]],
    ]);
  } catch (e) {
    if (violouUnico(e)) throw new Falha(409, 'ocupado', 'A pré-reserva expirou e outra pessoa já pegou um desses horários. Edite a reserva para outro horário.');
    throw e;
  }
  return [200, { ok: true }];
}

async function removerReservaEquipe(req, p) {
  await exigirEquipe(req);
  await q('DELETE FROM reservas WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

async function criarSala(req) {
  await exigirEquipe(req);
  const id = novoId('sala-');
  await q('INSERT INTO salas (id, nome, disponivel, ordem) SELECT $1, $2, false, COALESCE(max(ordem), 0) + 1 FROM salas', [id, 'Nova sala']);
  return [201, { id }];
}

async function editarSala(req, p, c) {
  await exigirEquipe(req);
  const campos = [], valores = [p.id];
  const add = (col, v) => { valores.push(v); campos.push(`${col} = $${valores.length}`); };
  if (c.nome !== undefined) { const n = texto(c.nome, 60); if (!n) throw new Falha(400, 'nome', 'A sala precisa de um nome.'); add('nome', n); }
  if (c.tipo !== undefined) add('tipo', texto(c.tipo, 60));
  if (c.descricao !== undefined) add('descricao', texto(c.descricao, 600));
  if (c.disponivel !== undefined) add('disponivel', !!c.disponivel);
  if (c.ordem !== undefined) add('ordem', Math.trunc(Number(c.ordem)) || 0);
  if (c.valorHora !== undefined) {
    const v = c.valorHora === null || c.valorHora === '' ? null : Number(c.valorHora);
    if (v !== null && (!Number.isFinite(v) || v < 0 || v > 99999)) throw new Falha(400, 'valor', 'Digite o valor só com números, como 45,00.');
    add('valor_hora', v);
  }
  if (!campos.length) return [200, { ok: true }];
  const r = await q(`UPDATE salas SET ${campos.join(', ')} WHERE id = $1 RETURNING id`, valores);
  if (!r.length) throw new Falha(404, 'sala', 'Sala não encontrada.');
  return [200, { ok: true }];
}

async function fotoSala(req, p, c) {
  await exigirEquipe(req);
  const [s] = await q('SELECT id FROM salas WHERE id = $1', [p.id]);
  if (!s) throw new Falha(404, 'sala', 'Sala não encontrada.');
  const url = await guardarFoto(p.id, c.imagem);
  await q('UPDATE salas SET foto_url = $2 WHERE id = $1', [p.id, url]);
  return [200, { foto: url }];
}

async function criarFixo(req, _p, c) {
  await exigirEquipe(req);
  const repete = ['semanal', 'aCadaDias', 'unico'].includes(c.repete) ? c.repete : null;
  if (!repete) throw new Falha(400, 'repete', 'Escolha como o horário se repete.');
  const de = Number(c.de), ate = Number(c.ate);
  if (!Number.isInteger(de) || !Number.isInteger(ate) || de < 0 || ate > 24 || ate <= de) throw new Falha(400, 'horas', 'O horário final precisa ser depois do inicial.');
  const desde = c.desde ? texto(c.desde, 10) : agoraLocal().data;
  if (!dataValida(desde)) throw new Falha(400, 'data', 'Escolha um dia válido.');
  const dia = repete === 'semanal' ? Number(c.diaSemana) : null;
  if (repete === 'semanal' && !(dia >= 0 && dia <= 6)) throw new Falha(400, 'dia', 'Escolha o dia da semana.');
  const [s] = await q('SELECT id FROM salas WHERE id = $1', [texto(c.sala, 40)]);
  if (!s) throw new Falha(400, 'sala', 'Escolha a sala.');
  const id = novoId('fixo-');
  await q(`INSERT INTO fixos (id, sala, repete, dia_semana, a_cada_dias, de, ate, desde) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date)`,
    [id, s.id, repete, dia, repete === 'aCadaDias' ? (Number(c.aCadaDias) || 15) : null, de, ate, desde]);
  return [201, { id }];
}

async function removerFixo(req, p) {
  await exigirEquipe(req);
  await q('DELETE FROM fixos WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

async function salvarConfig(req, _p, c) {
  await exigirEquipe(req);
  const abre = Number(c.abre), fecha = Number(c.fecha), diasAFrente = Number(c.diasAFrente);
  if (!Number.isInteger(abre) || !Number.isInteger(fecha) || abre < 0 || fecha > 24 || fecha <= abre) throw new Falha(400, 'horas', 'O horário de fechar precisa ser depois do de abrir.');
  if (!Number.isInteger(diasAFrente) || diasAFrente < 7 || diasAFrente > 365) throw new Falha(400, 'dias', 'Escolha a antecedência.');
  const diasAbertos = [...new Set((Array.isArray(c.diasAbertos) ? c.diasAbertos : []).map(Number))].filter((d) => d >= 0 && d <= 6).sort();
  if (!diasAbertos.length) throw new Falha(400, 'dias', 'Deixe pelo menos um dia aberto.');
  let w = soDigitos(c.whatsappAgatha);
  if (w && w.length < 10) throw new Falha(400, 'whatsapp', 'Digite o WhatsApp com DDD.');
  if (w && w.length <= 11) w = '55' + w;
  const valor = { abre, fecha, diasAFrente, diasAbertos, whatsappAgatha: w };
  await q("INSERT INTO config (chave, valor) VALUES ('geral', $1) ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor", [JSON.stringify(valor)]);
  return [200, { geral: valor }];
}

async function senhaCliente(req, _p, c) {
  await exigirEquipe(req);
  const email = texto(c.email, 120).toLowerCase(), nova = String(c.senhaNova || '');
  if (nova.length < 8) throw new Falha(400, 'senha', 'A senha nova precisa ter pelo menos 8 caracteres.');
  const r = await q('UPDATE usuarios SET senha_hash = $2 WHERE email = $1 RETURNING nome', [email, await gerarHash(nova)]);
  if (!r.length) throw new Falha(404, 'sem_conta', 'Não existe conta com este e-mail.');
  await limparFalhas(email);
  return [200, { nome: r[0].nome }];
}

/* ===== Tabela de rotas ===== */
export const ROTAS = [
  ['GET', '/api/agenda', agenda],
  ['POST', '/api/auth/cadastro', cadastro],
  ['POST', '/api/auth/entrar', entrar],
  ['POST', '/api/auth/sair', sair],
  ['GET', '/api/auth/eu', eu],
  ['PATCH', '/api/auth/eu', atualizarEu],
  ['POST', '/api/auth/redefinir-equipe', redefinirEquipe],
  ['GET', '/api/reservas', minhas],
  ['POST', '/api/reservas', preReservar],
  ['DELETE', '/api/reservas/:id', cancelarMinha],
  ['GET', '/api/admin/dados', dadosEquipe],
  ['POST', '/api/admin/reservas', criarReservaEquipe],
  ['PATCH', '/api/admin/reservas/:id', editarReservaEquipe],
  ['POST', '/api/admin/reservas/:id/confirmar', confirmarEquipe],
  ['DELETE', '/api/admin/reservas/:id', removerReservaEquipe],
  ['POST', '/api/admin/salas', criarSala],
  ['PATCH', '/api/admin/salas/:id', editarSala],
  ['POST', '/api/admin/salas/:id/foto', fotoSala],
  ['POST', '/api/admin/fixos', criarFixo],
  ['DELETE', '/api/admin/fixos/:id', removerFixo],
  ['PUT', '/api/admin/config', salvarConfig],
  ['POST', '/api/admin/usuarios/senha', senhaCliente],
];
