// Todas as rotas da API. Cada uma recebe (req, params, corpo) e devolve [status, dados, cabeçalhos?].
import { randomUUID, randomBytes } from 'node:crypto';
import { q, tx, violouUnico } from './db.js';
import { Falha, texto } from './http.js';
import {
  gerarHash, conferirSenha, cookieSessao, cookieSair, publico, usuarioAtual, exigirLogin, exigirEquipe,
  ehEquipe, checarBloqueio, registrarFalha, limparFalhas, codigoEquipeConfere, codigoEquipeFraco, checarSenhaNova, limitar, exigir2fa,
} from './auth.js';
import { ipDe, ipLimite } from './http.js';
import { correioAtivo, enviarEmail, emailCodigo, emailJaTemConta } from './correio.js';
import { criarCodigo, usarCodigo } from './codigos.js';
import { agoraLocal, dataValida, diaSemana, somarDias, fixoOcupa, horasValidas } from './agenda.js';
import { GERAL_PADRAO } from './esquema.js';
import { guardarFoto } from './armazenamento.js';
import { validarPrecos, calcularValor, comDesconto, porcentagem, dinheiro } from './precos.js';

const EXPIRA_MIN = 90;          // pré-reserva sem confirmação expira em 1h30
const MAX_PRE_POR_CLIENTE = 3;  // pré-reservas abertas ao mesmo tempo por conta

/* ===== Consultas que se repetem ===== */
const EXPIRAR = [
  ["UPDATE reservas SET status = 'expirada' WHERE status = 'pre' AND expira_em IS NOT NULL AND expira_em < now()"],
  ["DELETE FROM reserva_horas h USING reservas r WHERE h.reserva_id = r.id AND r.status = 'expirada'"],
];
const SQL_GERAL = ["SELECT valor FROM config WHERE chave = 'geral'"];
const COLS_PROF = `id, nome, especialidade, registro, whatsapp, foto_url AS foto, credito_foto AS credito, ativo, ordem`;
const SQL_SALAS = ['SELECT id, nome, tipo, descricao, foto_url AS foto, disponivel, ordem, precos FROM salas ORDER BY ordem, nome'];
const SQL_FIXOS = ['SELECT id, sala, repete, dia_semana AS "diaSemana", a_cada_dias AS "aCadaDias", de, ate, desde::text AS desde FROM fixos ORDER BY sala, de'];
const COLS_RESERVA = `r.id, r.sala, r.data::text AS data, r.horas, r.nome, r.especialidade, r.telefone, r.status, r.origem,
  r.expira_em AS "expiraEm", r.criado_em AS "criadoEm", r.confirmada_em AS "confirmadaEm",
  r.valor::float8 AS valor, r.valor_cheio::float8 AS "valorCheio", r.desconto_pct::float8 AS "descontoPct", r.parceiro_id AS "parceiroId"`;
const COLS_PARCEIRO = `p.id, p.email, p.nome, p.desconto_aluguel::float8 AS "descontoAluguel", p.pct_atendimento::float8 AS "pctAtendimento",
  p.ativo, p.observacao`;
const COLS_ATENDIMENTO = `a.id, a.parceiro_id AS "parceiroId", a.reserva_id AS "reservaId", a.data::text AS data, a.quantidade,
  a.valor_total::float8 AS "valorTotal", a.pct::float8 AS pct, a.repasse::float8 AS repasse, a.status, a.recebido_em AS "recebidoEm", a.observacao`;

/* ===== Parceria =====
   Vale só se a parceria está ativa e a conta é mesmo da pessoa: e-mail confirmado por código
   ou conta conferida pela equipe no painel. Assim ninguém ganha o desconto criando conta com o e-mail de outra pessoa. */
async function parceriaDe(u) {
  if (!u) return null;
  const [p] = await q(
    `SELECT ${COLS_PARCEIRO}, (us.email_verificado OR p.usuario_confirmado = us.id) AS valida
       FROM parceiros p JOIN usuarios us ON us.email = p.email
      WHERE us.id = $1 AND p.ativo`, [u.id]);
  return p && p.valida ? p : null;
}

// Valor da reserva calculado no servidor (o navegador só mostra; nunca decide o preço)
function precoDaReserva(sala, nHoras, parceria) {
  const cheio = calcularValor(sala.precos, nHoras);
  const desc = parceria ? Number(parceria.descontoAluguel) : null;
  return { valor: parceria ? comDesconto(cheio, desc) : cheio, valorCheio: cheio, descontoPct: desc, parceiroId: parceria ? parceria.id : null };
}

const geralDe = (linhas) => ({ ...GERAL_PADRAO, ...((linhas[0] && linhas[0].valor) || {}) });
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
    salas,
    fixos,
    ocupados,
    parceria: await parceriaPublica(u),
  }];
}

async function parceriaPublica(u) {
  const p = await parceriaDe(u);
  return p ? { descontoAluguel: p.descontoAluguel, pctAtendimento: p.pctAtendimento } : null;
}

/* ===== Conta ===== */
async function cadastro(req, _p, c) {
  const nome = texto(c.nome, 80), email = texto(c.email, 120).toLowerCase();
  const telefone = texto(c.telefone, 20), especialidade = texto(c.especialidade, 80), senha = String(c.senha || '');
  if (nome.length < 2) throw new Falha(400, 'nome', 'Digite o seu nome.');
  if (!emailOk(email)) throw new Falha(400, 'email', 'Digite um e-mail válido.');
  if (!telefoneOk(telefone)) throw new Falha(400, 'telefone', 'Digite o WhatsApp com DDD.');
  checarSenhaNova(senha, email);
  isca(c);
  await limitar('cadastro|' + ipLimite(req), 10, 3600, 'Muitas contas criadas daqui em pouco tempo. Tente de novo mais tarde.');
  await limitar('cadastro|geral', 60, 3600, 'Muitas contas novas agora. Tente de novo em alguns minutos.');
  if (ehEquipe(email) && !codigoEquipeConfere(c.codigoEquipe)) {
    await checarBloqueio(email, req);
    if (c.codigoEquipe) await registrarFalha(email, req);
    throw new Falha(403, 'codigo_equipe', c.codigoEquipe ? 'O código da equipe não confere.' : 'Este e-mail é da equipe da Casa. Digite o código da equipe para criar a conta.');
  }
  // Com o e-mail ligado, a conta só nasce depois de confirmar o código enviado para o e-mail
  if (correioAtivo()) {
    const [ja] = await q('SELECT 1 FROM usuarios WHERE email = $1', [email]);
    if (ja) throw new Falha(409, 'email_existe', 'Já existe uma conta com este e-mail. Use "Entrar".');
    await usarCodigo(email, 'cadastro', c.codigo);
  }
  const id = randomUUID();
  try {
    await q('INSERT INTO usuarios (id, nome, email, telefone, especialidade, senha_hash, email_verificado) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [id, nome, email, telefone, especialidade, await gerarHash(senha), correioAtivo()]);
  } catch (e) {
    if (violouUnico(e)) throw new Falha(409, 'email_existe', 'Já existe uma conta com este e-mail. Use "Entrar".');
    throw e;
  }
  return [201, { conta: publico({ id, nome, email, telefone, especialidade }) }, { 'Set-Cookie': cookieSessao(req, id, 0, c.lembrar !== false, ehEquipe(email)) }];
}

async function entrar(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase(), senha = String(c.senha || '');
  if (!email || !senha) throw new Falha(400, 'campos', 'Digite o e-mail e a senha.');
  await limitar('entrar|' + ipLimite(req), 40, 900);
  await checarBloqueio(email, req);
  const [u] = await q('SELECT id, nome, email, telefone, especialidade, senha_hash, sessao_versao FROM usuarios WHERE email = $1', [email]);
  const equipe = ehEquipe(email);
  if (!(await conferirSenha(senha, u && u.senha_hash)) || !u) {
    await registrarFalha(email, req);
    if (u && equipe) await registrarAcesso(req, u.id, 'senha_errada');
    throw new Falha(401, 'senha', 'E-mail ou senha incorretos.');
  }
  await limparFalhas(email, req);
  const mfa = equipe && exigir2fa();
  if (mfa) await segundaEtapa(req, u, c);
  if (equipe) await registrarAcesso(req, u.id, 'entrou');
  return [200, { conta: publico(u) }, { 'Set-Cookie': cookieSessao(req, u.id, u.sessao_versao, !!c.lembrar, mfa) }];
}

/* ===== Segurança da conta da equipe ===== */
// Campo escondido no formulário: pessoas não veem e não preenchem; robôs costumam preencher tudo
function isca(c) {
  if (texto(c.site, 200)) throw new Falha(400, 'campos', 'Não foi possível concluir agora. Recarregue a página e tente de novo.');
}

async function registrarAcesso(req, usuarioId, resultado) {
  const h = req.headers || {};
  let cidade = '';
  try { cidade = decodeURIComponent(String(h['x-vercel-ip-city'] || '')); } catch { /* nome de cidade malformado */ }
  const local = [cidade, h['x-vercel-ip-country-region'], h['x-vercel-ip-country']].filter(Boolean).join(', ').slice(0, 80);
  try {
    await tx([
      ['INSERT INTO acessos (usuario_id, ip, local, aparelho, resultado) VALUES ($1, $2, $3, $4, $5)', [usuarioId, ipDe(req), local, texto(h['user-agent'], 200), resultado]],
      ["DELETE FROM acessos WHERE quando < now() - interval '90 days'"],
    ]);
  } catch (e) { console.error('acessos:', e && e.message); }
}

const mascarar = (e) => { const [n, d] = String(e).split('@'); return (n.length <= 2 ? n[0] + '*' : n.slice(0, 2) + '*'.repeat(Math.min(6, n.length - 2))) + '@' + d; };

/* Segunda etapa da equipe, depois da senha certa:
   com o e-mail do site ligado, um código de 6 números vai para o e-mail da equipe (vale 10 minutos, 5 tentativas, uso único);
   enquanto o e-mail não estiver ligado, pede o código da equipe. */
async function segundaEtapa(req, u, c) {
  if (correioAtivo()) {
    if (!String(c.codigoEmail || '').trim()) {
      try {
        const codigo = await criarCodigo(u.email, 'entrar');
        await enviarEmail({ para: u.email, ...emailCodigo('entrar', codigo) });
      } catch (e) {
        if (!(e instanceof Falha && e.status === 429)) throw e; // pediu de novo em menos de 1 minuto: o código anterior ainda vale
      }
      throw new Falha(401, 'precisa_codigo', `Enviamos um código de 6 números para ${mascarar(u.email)}. Confira também o spam.`);
    }
    try { await usarCodigo(u.email, 'entrar', c.codigoEmail); } catch (e) { await registrarAcesso(req, u.id, 'codigo_errado'); throw e; }
    return;
  }
  if (!String(c.codigoEquipe || '').trim()) throw new Falha(401, 'precisa_codigo_equipe', 'Digite também o código da equipe.');
  if (!codigoEquipeConfere(c.codigoEquipe)) {
    await registrarFalha(u.email, req);
    await registrarAcesso(req, u.id, 'codigo_errado');
    throw new Falha(401, 'codigo_equipe', codigoEquipeFraco() ? 'O código da equipe na Vercel é fraco e foi desligado. Troque CODIGO_EQUIPE por um com pelo menos 10 caracteres e faça Redeploy.' : 'O código da equipe não confere.');
  }
}

// Desconecta a conta da equipe de todos os aparelhos, menos deste
async function sairDeTodos(req) {
  const u = await exigirEquipe(req);
  const [r] = await q('UPDATE usuarios SET sessao_versao = sessao_versao + 1 WHERE id = $1 RETURNING sessao_versao', [u.id]);
  await registrarAcesso(req, u.id, 'saiu_de_todos');
  return [200, { ok: true }, { 'Set-Cookie': cookieSessao(req, u.id, r.sessao_versao, true, true) }];
}

const sair = async (req) => [200, { ok: true }, { 'Set-Cookie': cookieSair(req) }];

async function eu(req) {
  const u = await usuarioAtual(req);
  return [200, { conta: u ? publico(u) : null, emailAtivo: correioAtivo() }];
}

// Envia o código por e-mail. A resposta é sempre a mesma, exista conta ou não, para ninguém descobrir quem é cliente.
async function pedirCodigo(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase();
  const finalidade = c.finalidade === 'senha' ? 'senha' : 'cadastro';
  if (!emailOk(email)) throw new Falha(400, 'email', 'Digite um e-mail válido.');
  if (!correioAtivo()) throw new Falha(503, 'sem_email', 'O envio de e-mail ainda não foi configurado. Fale com a Casa pelo WhatsApp.');
  isca(c);
  await limitar('codigo-ip|' + ipLimite(req), 15, 3600, 'Muitos códigos pedidos daqui. Tente de novo mais tarde.');
  // Teto geral: protege a cota de e-mails do Gmail (cerca de 500 por dia) contra ataque de muitos lugares
  await limitar('codigo|geral', 80, 3600, 'Muitos pedidos de código agora. Tente de novo em alguns minutos.');
  const [conta] = await q('SELECT id FROM usuarios WHERE email = $1', [email]);
  if (finalidade === 'cadastro' && conta) {
    await limitar('ja-tem-conta|' + email, 1, 600);
    await enviarEmail({ para: email, ...emailJaTemConta() });
  } else if (finalidade === 'cadastro' || conta) {
    const codigo = await criarCodigo(email, finalidade);
    await enviarEmail({ para: email, ...emailCodigo(finalidade, codigo) });
  }
  return [200, { ok: true }];
}

// Senha nova com o código do e-mail. Desconecta os outros aparelhos e já entra na conta.
async function recuperarSenha(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase(), nova = String(c.senhaNova || '');
  if (!emailOk(email)) throw new Falha(400, 'email', 'Digite um e-mail válido.');
  checarSenhaNova(nova, email);
  await limitar('recuperar|' + ipLimite(req), 20, 3600);
  await usarCodigo(email, 'senha', c.codigo);
  const [u] = await q(`UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1, email_verificado = true WHERE email = $1
    RETURNING id, nome, email, telefone, especialidade, sessao_versao`, [email, await gerarHash(nova)]);
  if (!u) throw new Falha(400, 'codigo_vencido', 'Esse código venceu ou já foi usado. Peça um novo.');
  await q("DELETE FROM tentativas WHERE split_part(email, '|', 1) = $1", [email]);
  return [200, { conta: publico(u) }, { 'Set-Cookie': cookieSessao(req, u.id, u.sessao_versao, true) }];
}

async function atualizarEu(req, _p, c) {
  const u = await exigirLogin(req);
  const nome = c.nome !== undefined ? texto(c.nome, 80) : u.nome;
  const telefone = c.telefone !== undefined ? texto(c.telefone, 20) : u.telefone;
  const especialidade = c.especialidade !== undefined ? texto(c.especialidade, 80) : u.especialidade;
  if (nome.length < 2) throw new Falha(400, 'nome', 'Digite o seu nome.');
  if (!telefoneOk(telefone)) throw new Falha(400, 'telefone', 'Digite o WhatsApp com DDD.');
  let cab;
  if (c.senhaNova) {
    const nova = String(c.senhaNova);
    checarSenhaNova(nova, u.email);
    await limitar('trocar-senha|' + u.id, 10, 900);
    const [s] = await q('SELECT senha_hash FROM usuarios WHERE id = $1', [u.id]);
    if (!(await conferirSenha(String(c.senhaAtual || ''), s.senha_hash))) throw new Falha(400, 'senha_atual', 'A senha atual não confere.');
    // Senha nova derruba as sessões abertas em outros aparelhos; este aparelho recebe um cookie novo
    const [r] = await q('UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1 WHERE id = $1 RETURNING sessao_versao', [u.id, await gerarHash(nova)]);
    cab = { 'Set-Cookie': cookieSessao(req, u.id, r.sessao_versao, true, u.mfa) };
  }
  await q('UPDATE usuarios SET nome = $2, telefone = $3, especialidade = $4 WHERE id = $1', [u.id, nome, telefone, especialidade]);
  return [200, { conta: publico({ ...u, nome, telefone, especialidade }) }, cab];
}

// A equipe esqueceu a senha: com o código da equipe, cria uma senha nova
async function redefinirEquipe(req, _p, c) {
  const email = texto(c.email, 120).toLowerCase(), nova = String(c.senhaNova || '');
  if (!ehEquipe(email)) throw new Falha(400, 'nao_equipe', 'Este e-mail não é da equipe. Clientes pedem a senha nova para a Casa pelo WhatsApp.');
  await limitar('redefinir|' + ipLimite(req), 10, 3600);
  await checarBloqueio(email, req);
  if (!codigoEquipeConfere(c.codigo)) { await registrarFalha(email, req); throw new Falha(403, 'codigo_equipe', codigoEquipeFraco() ? 'O código da equipe na Vercel é fraco e foi desligado. Troque CODIGO_EQUIPE por um com pelo menos 10 caracteres e faça Redeploy.' : 'O código da equipe não confere.'); }
  checarSenhaNova(nova, email);
  const r = await q('UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1 WHERE email = $1 RETURNING id', [email, await gerarHash(nova)]);
  if (!r.length) throw new Falha(404, 'sem_conta', 'Ainda não existe conta com este e-mail. Use "Criar conta".');
  await limparFalhas(email, req);
  return [200, { ok: true }];
}

// LGPD: a pessoa apaga a própria conta. Pré-reservas abertas somem; reservas confirmadas ficam só com nome e
// telefone para a Casa honrar o horário, sem ligação com a conta.
async function excluirEu(req, _p, c) {
  const u = await exigirLogin(req);
  if (ehEquipe(u.email)) throw new Falha(400, 'equipe', 'A conta da equipe não pode ser apagada pelo site.');
  await limitar('excluir|' + u.id, 10, 900);
  const [s] = await q('SELECT senha_hash FROM usuarios WHERE id = $1', [u.id]);
  if (!(await conferirSenha(String(c.senha || ''), s.senha_hash))) throw new Falha(400, 'senha_atual', 'A senha não confere.');
  await tx([
    ["DELETE FROM reservas WHERE usuario_id = $1 AND status <> 'confirmada'", [u.id]],
    ['DELETE FROM usuarios WHERE id = $1', [u.id]],
  ]);
  return [200, { ok: true }, { 'Set-Cookie': cookieSair(req) }];
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
  await limitar('pre|' + ipLimite(req), 20, 3600, 'Muitas pré-reservas daqui em pouco tempo. Fale com a Casa Lumière pelo WhatsApp.');
  await limitar('pre|conta|' + u.id, 15, 3600, 'Muitas pré-reservas seguidas. Fale com a Casa Lumière pelo WhatsApp.');
  await limitar('pre|geral', 150, 3600, 'Muitas pré-reservas agora. Tente de novo em alguns minutos.');
  const v = await validarPedido({ sala: texto(c.sala, 40), data: texto(c.data, 10), horas: c.horas }, { equipe: false });
  const [abertas] = await q("SELECT count(*)::int AS n FROM reservas WHERE usuario_id = $1 AND status = 'pre'", [u.id]);
  if (abertas.n >= MAX_PRE_POR_CLIENTE) throw new Falha(429, 'limite_pre', 'Você já tem pré-reservas esperando a confirmação da Casa Lumière. Fale com a equipe antes de fazer outra.');
  const id = randomUUID();
  const data = texto(c.data, 10);
  const preco = precoDaReserva(v.sala, v.horas.length, await parceriaDe(u));
  try {
    await tx([
      ...EXPIRAR,
      [`INSERT INTO reservas (id, sala, usuario_id, data, horas, nome, especialidade, telefone, status, origem, expira_em,
          valor, valor_cheio, desconto_pct, parceiro_id)
        VALUES ($1, $2, $3, $4::date, $5::smallint[], $6, $7, $8, 'pre', 'site', now() + interval '${EXPIRA_MIN} minutes', $9, $10, $11, $12)`,
      [id, v.sala.id, u.id, data, v.horas, u.nome, u.especialidade, u.telefone, preco.valor, preco.valorCheio, preco.descontoPct, preco.parceiroId]],
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
  if (r.status === 'confirmada') throw new Falha(409, 'confirmada', 'Esta reserva já foi confirmada. Para cancelar, fale com a Casa Lumière.');
  await q('DELETE FROM reservas WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

/* ===== Equipe ===== */
async function dadosEquipe(req) {
  const u = await exigirEquipe(req);
  const desde = somarDias(agoraLocal().data, -60);
  const umAno = somarDias(agoraLocal().data, -366);
  const [, , g, salas, fixos, profissionais, reservas, parceiros, atendimentos, acessos] = await tx([...EXPIRAR, SQL_GERAL, SQL_SALAS, SQL_FIXOS, [
    `SELECT ${COLS_PROF} FROM profissionais ORDER BY ordem, nome`,
  ], [
    `SELECT ${COLS_RESERVA}, us.email AS "emailConta"
       FROM reservas r LEFT JOIN usuarios us ON us.id = r.usuario_id
      WHERE r.data >= $1::date ORDER BY r.data, r.horas[1]`, [desde],
  ], [
    `SELECT ${COLS_PARCEIRO},
            CASE WHEN us.id IS NULL THEN 'sem_conta' WHEN us.email_verificado THEN 'verificada'
                 WHEN p.usuario_confirmado = us.id THEN 'conferida' ELSE 'nao_verificada' END AS conta
       FROM parceiros p LEFT JOIN usuarios us ON us.email = p.email ORDER BY p.ativo DESC, p.nome`,
  ], [
    `SELECT ${COLS_ATENDIMENTO} FROM atendimentos a WHERE a.data >= $1::date OR a.status = 'pendente' ORDER BY a.data DESC, a.criado_em DESC`, [umAno],
  ], [
    `SELECT quando, ip, local, aparelho, resultado FROM acessos WHERE usuario_id = $1 ORDER BY quando DESC LIMIT 25`, [u.id],
  ]]);
  const seguranca = { acessos, segundaEtapa: !exigir2fa() ? 'desligada' : correioAtivo() ? 'email' : 'codigo_equipe', email: mascarar(u.email) };
  return [200, { conta: publico(u), agora: agoraLocal(), geral: geralDe(g), salas, fixos, profissionais, reservas, parceiros, atendimentos, seguranca }];
}

// Valor de uma reserva lançada pela equipe: parceiro opcional e valor ajustado à mão (opcional)
async function precoEquipe(c, sala, nHoras) {
  let parceria = null;
  if (c.parceiro) {
    const [p] = await q(`SELECT ${COLS_PARCEIRO} FROM parceiros p WHERE p.id = $1`, [texto(c.parceiro, 40)]);
    if (!p) throw new Falha(400, 'parceiro', 'Parceiro não encontrado.');
    parceria = p;
  }
  const preco = precoDaReserva(sala, nHoras, parceria);
  if (c.valor !== undefined && c.valor !== null && c.valor !== '') preco.valor = dinheiro(c.valor, 'O valor da reserva');
  return preco;
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
  const preco = await precoEquipe(c, v.sala, v.horas.length);
  try {
    await tx([
      ...EXPIRAR,
      [`INSERT INTO reservas (id, sala, data, horas, nome, especialidade, telefone, status, origem, confirmada_em,
          valor, valor_cheio, desconto_pct, parceiro_id)
        VALUES ($1, $2, $3::date, $4::smallint[], $5, $6, $7, $8, 'painel', CASE WHEN $8 = 'confirmada' THEN now() END, $9, $10, $11, $12)`,
      [id, v.sala.id, data, v.horas, pessoa.nome, pessoa.especialidade, pessoa.telefone, status, preco.valor, preco.valorCheio, preco.descontoPct, preco.parceiroId]],
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
  const preco = await precoEquipe(c, v.sala, v.horas.length);
  try {
    await tx([
      ['DELETE FROM reserva_horas WHERE reserva_id = $1', [p.id]],
      [`UPDATE reservas SET sala = $2, data = $3::date, horas = $4::smallint[], nome = $5, especialidade = $6, telefone = $7,
          status = $8, expira_em = NULL,
          confirmada_em = CASE WHEN $8 = 'confirmada' THEN COALESCE(confirmada_em, now()) END,
          valor = $9, valor_cheio = $10, desconto_pct = $11, parceiro_id = $12
        WHERE id = $1`,
      [p.id, v.sala.id, data, v.horas, pessoa.nome, pessoa.especialidade, pessoa.telefone, status, preco.valor, preco.valorCheio, preco.descontoPct, preco.parceiroId]],
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

// Uma reserva só, para a página de confirmação em 1 clique (link que vai na mensagem para a Agatha)
async function reservaEquipe(req, p) {
  await exigirEquipe(req);
  const [, , r] = await tx([...EXPIRAR, [
    `SELECT ${COLS_RESERVA}, s.nome AS "salaNome", s.tipo AS "salaTipo"
       FROM reservas r LEFT JOIN salas s ON s.id = r.sala WHERE r.id = $1`, [p.id],
  ]]);
  if (!r.length) throw new Falha(404, 'reserva', 'Reserva não encontrada. Ela pode ter sido cancelada.');
  return [200, { reserva: r[0], agora: agoraLocal() }];
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
  if (c.precos !== undefined) {
    valores.push(JSON.stringify(validarPrecos(c.precos)));
    campos.push(`precos = $${valores.length}::jsonb`);
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

/* ===== Profissionais (página Profissionais e galeria do início) ===== */
async function profissionaisPublico() {
  const lista = await q(`SELECT id, nome, especialidade, registro, whatsapp, foto_url AS foto, credito_foto AS credito
                           FROM profissionais WHERE ativo ORDER BY ordem, nome`);
  return [200, { profissionais: lista }];
}

function dadosProfissional(c, parcial) {
  const out = {};
  if (!parcial || c.nome !== undefined) { out.nome = texto(c.nome, 80); if (out.nome.length < 2) throw new Falha(400, 'nome', 'Digite o nome do profissional.'); }
  if (c.especialidade !== undefined) out.especialidade = texto(c.especialidade, 120);
  if (c.registro !== undefined) out.registro = texto(c.registro, 120);
  if (c.credito !== undefined) out.credito_foto = texto(c.credito, 120);
  if (c.whatsapp !== undefined) {
    const w = soDigitos(c.whatsapp);
    if (w && (w.length < 10 || w.length > 13)) throw new Falha(400, 'whatsapp', 'Digite o WhatsApp com DDD, como (19) 99999-9999, ou deixe em branco.');
    out.whatsapp = w;
  }
  if (c.ativo !== undefined) out.ativo = !!c.ativo;
  return out;
}

async function criarProfissional(req, _p, c) {
  await exigirEquipe(req);
  const d = dadosProfissional(c, false);
  const id = novoId('prof-');
  await q(`INSERT INTO profissionais (id, nome, especialidade, registro, whatsapp, credito_foto, ativo, ordem)
           SELECT $1, $2, $3, $4, $5, $6, $7, COALESCE(max(ordem), 0) + 1 FROM profissionais`,
    [id, d.nome, d.especialidade || '', d.registro || '', d.whatsapp || '', d.credito_foto || '', d.ativo !== false]);
  return [201, { id }];
}

async function editarProfissional(req, p, c) {
  await exigirEquipe(req);
  const d = dadosProfissional(c, true);
  const campos = [], valores = [p.id];
  for (const [col, v] of Object.entries(d)) { valores.push(v); campos.push(`${col} = $${valores.length}`); }
  if (!campos.length) return [200, { ok: true }];
  const r = await q(`UPDATE profissionais SET ${campos.join(', ')} WHERE id = $1 RETURNING id`, valores);
  if (!r.length) throw new Falha(404, 'profissional', 'Profissional não encontrado.');
  return [200, { ok: true }];
}

// Sobe ou desce uma posição na página (troca a ordem com o vizinho)
async function moverProfissional(req, p, c) {
  await exigirEquipe(req);
  const lista = await q('SELECT id, ordem FROM profissionais ORDER BY ordem, nome');
  const i = lista.findIndex((x) => x.id === p.id);
  if (i < 0) throw new Falha(404, 'profissional', 'Profissional não encontrado.');
  const j = c.para === 'cima' ? i - 1 : c.para === 'baixo' ? i + 1 : -1;
  if (j < 0 || j >= lista.length) return [200, { ok: true }];
  [lista[i], lista[j]] = [lista[j], lista[i]];
  await tx(lista.map((x, k) => ['UPDATE profissionais SET ordem = $2 WHERE id = $1', [x.id, k + 1]]));
  return [200, { ok: true }];
}

async function removerProfissional(req, p) {
  await exigirEquipe(req);
  const r = await q('DELETE FROM profissionais WHERE id = $1 RETURNING id', [p.id]);
  if (!r.length) throw new Falha(404, 'profissional', 'Profissional não encontrado.');
  return [200, { ok: true }];
}

async function fotoProfissional(req, p, c) {
  await exigirEquipe(req);
  const [x] = await q('SELECT id FROM profissionais WHERE id = $1', [p.id]);
  if (!x) throw new Falha(404, 'profissional', 'Profissional não encontrado.');
  const url = await guardarFoto(p.id, c.imagem, 'profissionais');
  await q('UPDATE profissionais SET foto_url = $2 WHERE id = $1', [p.id, url]);
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
  if (ehEquipe(email)) throw new Falha(400, 'equipe', 'A senha da equipe se troca em "Minha conta", com a senha atual.');
  checarSenhaNova(nova, email);
  const r = await q('UPDATE usuarios SET senha_hash = $2, sessao_versao = sessao_versao + 1 WHERE email = $1 RETURNING nome', [email, await gerarHash(nova)]);
  if (!r.length) throw new Falha(404, 'sem_conta', 'Não existe conta com este e-mail.');
  await q("DELETE FROM tentativas WHERE split_part(email, '|', 1) = $1", [email]);
  return [200, { nome: r[0].nome }];
}

/* ===== Parceiros (equipe) ===== */
function dadosParceiro(c, parcial) {
  const out = {};
  if (!parcial || c.nome !== undefined) { out.nome = texto(c.nome, 80); if (out.nome.length < 2) throw new Falha(400, 'nome', 'Digite o nome do parceiro.'); }
  if (!parcial || c.email !== undefined) { out.email = texto(c.email, 120).toLowerCase(); if (!emailOk(out.email)) throw new Falha(400, 'email', 'Digite um e-mail válido.'); }
  if (!parcial || c.descontoAluguel !== undefined) out.desconto_aluguel = porcentagem(c.descontoAluguel ?? 0, 'O desconto no aluguel');
  if (!parcial || c.pctAtendimento !== undefined) out.pct_atendimento = porcentagem(c.pctAtendimento ?? 0, 'A porcentagem dos atendimentos');
  if (c.observacao !== undefined) out.observacao = texto(c.observacao, 400);
  if (parcial && c.ativo !== undefined) out.ativo = !!c.ativo;
  return out;
}

async function criarParceiro(req, _p, c) {
  await exigirEquipe(req);
  const d = dadosParceiro(c, false);
  if (ehEquipe(d.email)) throw new Falha(400, 'email', 'O e-mail da equipe não pode ser parceiro.');
  const id = novoId('parc-');
  try {
    await q('INSERT INTO parceiros (id, email, nome, desconto_aluguel, pct_atendimento, observacao) VALUES ($1, $2, $3, $4, $5, $6)',
      [id, d.email, d.nome, d.desconto_aluguel, d.pct_atendimento, d.observacao || '']);
  } catch (e) {
    if (violouUnico(e)) throw new Falha(409, 'email_existe', 'Já existe um parceiro com este e-mail.');
    throw e;
  }
  return [201, { id }];
}

async function editarParceiro(req, p, c) {
  await exigirEquipe(req);
  const d = dadosParceiro(c, true);
  if (d.email && ehEquipe(d.email)) throw new Falha(400, 'email', 'O e-mail da equipe não pode ser parceiro.');
  const campos = [], valores = [p.id];
  for (const [col, v] of Object.entries(d)) { valores.push(v); campos.push(`${col} = $${valores.length}`); }
  // Trocou o e-mail: a conferência antiga não vale mais. Mesmo e-mail (o formulário sempre manda): mantém.
  if (d.email && c.conferirConta === undefined) campos.push(`usuario_confirmado = CASE WHEN parceiros.email = $${valores.indexOf(d.email) + 1} THEN parceiros.usuario_confirmado ELSE NULL END`);
  // "É ela mesma": a equipe confere a conta com a pessoa quando o e-mail não foi verificado por código
  if (c.conferirConta === true) campos.push('usuario_confirmado = (SELECT id FROM usuarios WHERE email = parceiros.email)');
  if (c.conferirConta === false) campos.push('usuario_confirmado = NULL');
  if (!campos.length) return [200, { ok: true }];
  try {
    const r = await q(`UPDATE parceiros SET ${campos.join(', ')} WHERE id = $1 RETURNING id`, valores);
    if (!r.length) throw new Falha(404, 'parceiro', 'Parceiro não encontrado.');
  } catch (e) {
    if (violouUnico(e)) throw new Falha(409, 'email_existe', 'Já existe um parceiro com este e-mail.');
    throw e;
  }
  return [200, { ok: true }];
}

async function removerParceiro(req, p) {
  await exigirEquipe(req);
  const [n] = await q('SELECT count(*)::int AS n FROM atendimentos WHERE parceiro_id = $1', [p.id]);
  if (n.n) throw new Falha(409, 'tem_atendimentos', 'Este parceiro tem atendimentos lançados. Desative em vez de apagar, para não perder o histórico.');
  await q('DELETE FROM parceiros WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

/* ===== Atendimentos dos parceiros: a porcentagem que eles repassam para a Casa ===== */
async function dadosAtendimento(c, atual) {
  const parceiroId = texto(c.parceiro ?? (atual && atual.parceiro_id), 40);
  const [parc] = await q('SELECT id, pct_atendimento::float8 AS pct FROM parceiros WHERE id = $1', [parceiroId]);
  if (!parc) throw new Falha(400, 'parceiro', 'Escolha o parceiro.');
  const data = texto(c.data ?? (atual && atual.data), 10);
  if (!dataValida(data) || data > somarDias(agoraLocal().data, 1)) throw new Falha(400, 'data', 'Escolha o dia do atendimento (hoje ou antes).');
  const quantidade = Number(c.quantidade ?? (atual && atual.quantidade));
  if (!Number.isInteger(quantidade) || quantidade < 1 || quantidade > 500) throw new Falha(400, 'quantidade', 'Digite quantos atendimentos foram feitos.');
  const valorTotal = dinheiro(c.valorTotal ?? (atual && atual.valor_total), 'O valor dos atendimentos');
  // A porcentagem fica gravada no lançamento: mudar a parceria depois não altera o que já foi lançado
  const pct = c.pct !== undefined && c.pct !== '' && c.pct !== null ? porcentagem(c.pct, 'A porcentagem') : (atual && !c.parceiro ? Number(atual.pct) : parc.pct);
  const repasse = Math.round(valorTotal * pct) / 100;
  let reserva = null;
  if (c.reserva) {
    const [r] = await q('SELECT id FROM reservas WHERE id = $1', [texto(c.reserva, 64)]);
    if (!r) throw new Falha(400, 'reserva', 'Reserva não encontrada.');
    reserva = r.id;
  }
  return { parceiroId: parc.id, data, quantidade, valorTotal, pct, repasse, reserva, observacao: texto(c.observacao ?? (atual && atual.observacao) ?? '', 400) };
}

async function criarAtendimento(req, _p, c) {
  await exigirEquipe(req);
  const a = await dadosAtendimento(c, null);
  const id = novoId('at-');
  await q(`INSERT INTO atendimentos (id, parceiro_id, reserva_id, data, quantidade, valor_total, pct, repasse, observacao)
           VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)`,
  [id, a.parceiroId, a.reserva, a.data, a.quantidade, a.valorTotal, a.pct, a.repasse, a.observacao]);
  return [201, { id, repasse: a.repasse }];
}

async function editarAtendimento(req, p, c) {
  await exigirEquipe(req);
  const [atual] = await q('SELECT parceiro_id, data::text AS data, quantidade, valor_total::float8 AS valor_total, pct::float8 AS pct, observacao FROM atendimentos WHERE id = $1', [p.id]);
  if (!atual) throw new Falha(404, 'atendimento', 'Lançamento não encontrado.');
  const so = Object.keys(c).filter((k) => k !== 'status');
  if (so.length) {
    const a = await dadosAtendimento(c, atual);
    await q(`UPDATE atendimentos SET parceiro_id = $2, data = $3::date, quantidade = $4, valor_total = $5, pct = $6, repasse = $7, observacao = $8
             ${c.reserva !== undefined ? ', reserva_id = $9' : ''} WHERE id = $1`,
    [p.id, a.parceiroId, a.data, a.quantidade, a.valorTotal, a.pct, a.repasse, a.observacao, ...(c.reserva !== undefined ? [a.reserva] : [])]);
  }
  if (c.status !== undefined) {
    if (!['pendente', 'recebido'].includes(c.status)) throw new Falha(400, 'status', 'Situação inválida.');
    await q(`UPDATE atendimentos SET status = $2, recebido_em = CASE WHEN $2 = 'recebido' THEN COALESCE(recebido_em, now()) END WHERE id = $1`, [p.id, c.status]);
  }
  return [200, { ok: true }];
}

async function removerAtendimento(req, p) {
  await exigirEquipe(req);
  await q('DELETE FROM atendimentos WHERE id = $1', [p.id]);
  return [200, { ok: true }];
}

/* ===== Extrato do parceiro (o próprio parceiro vê) ===== */
async function minhaParceria(req) {
  const u = await exigirLogin(req);
  const p = await parceriaDe(u);
  if (!p) return [200, { parceria: null }];
  const desde = somarDias(agoraLocal().data, -186);
  const [reservas, atend] = await tx([
    [`SELECT r.data::text AS data, r.valor::float8 AS valor FROM reservas r
       WHERE r.usuario_id = $1 AND r.status = 'confirmada' AND r.data >= $2::date`, [u.id, desde]],
    [`SELECT ${COLS_ATENDIMENTO} FROM atendimentos a WHERE a.parceiro_id = $1 AND (a.data >= $2::date OR a.status = 'pendente') ORDER BY a.data DESC`, [p.id, desde]],
  ]);
  const meses = {};
  const mes = (k) => (meses[k] ||= { mes: k, aluguel: 0, atendimentos: 0, valorAtendimentos: 0, repasse: 0, repassePendente: 0 });
  for (const r of reservas) mes(r.data.slice(0, 7)).aluguel += r.valor || 0;
  for (const a of atend) {
    const m = mes(a.data.slice(0, 7));
    m.atendimentos += a.quantidade; m.valorAtendimentos += a.valorTotal; m.repasse += a.repasse;
    if (a.status === 'pendente') m.repassePendente += a.repasse;
  }
  const lista = Object.values(meses).sort((x, y) => (x.mes < y.mes ? 1 : -1))
    .map((m) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v * 100) / 100 : v])));
  return [200, {
    parceria: { nome: p.nome, descontoAluguel: p.descontoAluguel, pctAtendimento: p.pctAtendimento },
    meses: lista,
    atendimentos: atend.map(({ parceiroId, reservaId, ...a }) => a),
  }];
}

/* ===== Tabela de rotas ===== */
export const ROTAS = [
  ['GET', '/api/agenda', agenda],
  ['POST', '/api/auth/cadastro', cadastro],
  ['POST', '/api/auth/entrar', entrar],
  ['POST', '/api/auth/sair', sair],
  ['GET', '/api/auth/eu', eu],
  ['PATCH', '/api/auth/eu', atualizarEu],
  ['POST', '/api/auth/excluir', excluirEu],
  ['POST', '/api/auth/redefinir-equipe', redefinirEquipe],
  ['POST', '/api/auth/codigo', pedirCodigo],
  ['POST', '/api/auth/recuperar', recuperarSenha],
  ['GET', '/api/reservas', minhas],
  ['POST', '/api/reservas', preReservar],
  ['DELETE', '/api/reservas/:id', cancelarMinha],
  ['GET', '/api/admin/dados', dadosEquipe],
  ['POST', '/api/admin/reservas', criarReservaEquipe],
  ['GET', '/api/admin/reservas/:id', reservaEquipe],
  ['PATCH', '/api/admin/reservas/:id', editarReservaEquipe],
  ['POST', '/api/admin/reservas/:id/confirmar', confirmarEquipe],
  ['DELETE', '/api/admin/reservas/:id', removerReservaEquipe],
  ['POST', '/api/admin/salas', criarSala],
  ['PATCH', '/api/admin/salas/:id', editarSala],
  ['POST', '/api/admin/salas/:id/foto', fotoSala],
  ['GET', '/api/profissionais', profissionaisPublico],
  ['POST', '/api/admin/sair-todos', sairDeTodos],
  ['POST', '/api/admin/profissionais', criarProfissional],
  ['PATCH', '/api/admin/profissionais/:id', editarProfissional],
  ['DELETE', '/api/admin/profissionais/:id', removerProfissional],
  ['POST', '/api/admin/profissionais/:id/foto', fotoProfissional],
  ['POST', '/api/admin/profissionais/:id/mover', moverProfissional],
  ['POST', '/api/admin/fixos', criarFixo],
  ['DELETE', '/api/admin/fixos/:id', removerFixo],
  ['PUT', '/api/admin/config', salvarConfig],
  ['POST', '/api/admin/usuarios/senha', senhaCliente],
  ['POST', '/api/admin/parceiros', criarParceiro],
  ['PATCH', '/api/admin/parceiros/:id', editarParceiro],
  ['DELETE', '/api/admin/parceiros/:id', removerParceiro],
  ['POST', '/api/admin/atendimentos', criarAtendimento],
  ['PATCH', '/api/admin/atendimentos/:id', editarAtendimento],
  ['DELETE', '/api/admin/atendimentos/:id', removerAtendimento],
  ['GET', '/api/parceria', minhaParceria],
];
