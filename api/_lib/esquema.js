// Cria as tabelas na primeira chamada e coloca os dados iniciais da Casa.
// Pode rodar várias vezes sem estragar nada (IF NOT EXISTS e ON CONFLICT).
import { q, tx } from './db.js';

const TABELAS = [
  `CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    telefone TEXT NOT NULL DEFAULT '',
    especialidade TEXT NOT NULL DEFAULT '',
    senha_hash TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS config (
    chave TEXT PRIMARY KEY,
    valor JSONB NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS salas (
    id TEXT PRIMARY KEY,
    nome TEXT NOT NULL,
    tipo TEXT NOT NULL DEFAULT '',
    descricao TEXT NOT NULL DEFAULT '',
    foto_url TEXT NOT NULL DEFAULT '',
    valor_hora NUMERIC(10,2),
    disponivel BOOLEAN NOT NULL DEFAULT true,
    ordem INT NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS fixos (
    id TEXT PRIMARY KEY,
    sala TEXT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
    repete TEXT NOT NULL CHECK (repete IN ('semanal', 'aCadaDias', 'unico')),
    dia_semana SMALLINT,
    a_cada_dias SMALLINT,
    de SMALLINT NOT NULL,
    ate SMALLINT NOT NULL,
    desde DATE,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS reservas (
    id TEXT PRIMARY KEY,
    sala TEXT NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
    usuario_id TEXT REFERENCES usuarios(id) ON DELETE SET NULL,
    data DATE NOT NULL,
    horas SMALLINT[] NOT NULL,
    nome TEXT NOT NULL,
    especialidade TEXT NOT NULL DEFAULT '',
    telefone TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK (status IN ('pre', 'confirmada', 'expirada')),
    origem TEXT NOT NULL DEFAULT 'site',
    expira_em TIMESTAMPTZ,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    confirmada_em TIMESTAMPTZ
  )`,
  'CREATE INDEX IF NOT EXISTS reservas_data ON reservas (data)',
  'CREATE INDEX IF NOT EXISTS reservas_usuario ON reservas (usuario_id)',
  // Uma linha por hora ocupada. A chave sala + dia + hora é o que impede duas reservas no mesmo horário.
  `CREATE TABLE IF NOT EXISTS reserva_horas (
    sala TEXT NOT NULL,
    data DATE NOT NULL,
    hora SMALLINT NOT NULL,
    reserva_id TEXT NOT NULL REFERENCES reservas(id) ON DELETE CASCADE,
    PRIMARY KEY (sala, data, hora)
  )`,
  'CREATE INDEX IF NOT EXISTS reserva_horas_reserva ON reserva_horas (reserva_id)',
  `CREATE TABLE IF NOT EXISTS tentativas (
    email TEXT PRIMARY KEY,
    falhas INT NOT NULL DEFAULT 0,
    bloqueado_ate TIMESTAMPTZ
  )`,
];

export const GERAL_PADRAO = {
  abre: 7,
  fecha: 20,
  diasAFrente: 100,
  diasAbertos: [0, 1, 2, 3, 4, 5, 6],
  whatsappAgatha: '5519992487347',
  botaoTeste: true,
};

const SALAS = [
  ['sala-02', 'Sala 02', 'Reunião', true, 1],
  ['sala-04', 'Sala 04', 'Estética Corporal', true, 2],
  ['sala-06', 'Sala 06', 'Psicologia', true, 3],
  ['sala-08', 'Sala 08', 'Esmeralda', true, 4],
  ['safira', 'Safira', '', false, 5],
];

const FIXOS = [
  ['esmeralda-terca', 'sala-08', 'semanal', 2, null, 14, 19, '2026-11-10'],
  ['esmeralda-15-dias', 'sala-08', 'aCadaDias', null, 15, 7, 20, '2026-11-13'],
  ['estetica-quarta', 'sala-04', 'semanal', 3, null, 14, 19, '2026-12-01'],
  ['psicologia-quinta', 'sala-06', 'semanal', 4, null, 14, 19, '2027-02-01'],
];

let pronto = null;

export function garantirEsquema() {
  if (!pronto) {
    pronto = criar().catch((e) => { pronto = null; throw e; });
  }
  return pronto;
}

async function criar() {
  await tx(TABELAS.map((t) => [t]));
  const ja = await q("SELECT 1 FROM config WHERE chave = 'geral'");
  if (ja.length) return;
  await tx([
    ...SALAS.map((s) => [
      'INSERT INTO salas (id, nome, tipo, disponivel, ordem) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING', s,
    ]),
    ...FIXOS.map((f) => [
      `INSERT INTO fixos (id, sala, repete, dia_semana, a_cada_dias, de, ate, desde)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (id) DO NOTHING`, f,
    ]),
    ["INSERT INTO config (chave, valor) VALUES ('geral', $1) ON CONFLICT (chave) DO NOTHING", [JSON.stringify(GERAL_PADRAO)]],
  ]);
}
