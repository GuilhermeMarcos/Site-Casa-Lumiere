// Regras de agenda: hora de Holambra, dias, horários fixos e conflitos.
// O mesmo cálculo de horário fixo existe em js/salas.js e js/painel.js para desenhar a tela.

const TZ = 'America/Sao_Paulo';
const fmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Data (AAAA-MM-DD), hora e minuto agora em Holambra, independente do fuso do servidor
export function agoraLocal() {
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { data: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour) % 24, minuto: Number(p.minute) };
}

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
export function dataValida(k) {
  if (typeof k !== 'string' || !DATA_RE.test(k)) return false;
  const d = new Date(k + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === k;
}

const utc = (k) => Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10));
export const diaSemana = (k) => new Date(utc(k)).getUTCDay();
export const diferencaDias = (a, b) => Math.round((utc(a) - utc(b)) / 86400000);
export function somarDias(k, n) {
  return new Date(utc(k) + n * 86400000).toISOString().slice(0, 10);
}

// Um horário fixo ocupa esta sala, neste dia, nesta hora?
export function fixoOcupa(fixos, sala, data, h) {
  return fixos.some((f) => {
    if (f.sala !== sala || h < f.de || h >= f.ate) return false;
    if (f.repete === 'unico') return data === f.desde;
    if (f.desde && data < f.desde) return false;
    if (f.repete === 'semanal') return diaSemana(data) === Number(f.diaSemana);
    if (f.repete === 'aCadaDias') {
      if (!f.desde) return false;
      const dif = diferencaDias(data, f.desde);
      return dif >= 0 && dif % (Number(f.aCadaDias) || 15) === 0;
    }
    return false;
  });
}

// "9h às 12h, 14h às 15h"
export function faixa(horas) {
  const h = [...horas].sort((a, b) => a - b);
  if (!h.length) return '';
  const out = [];
  let ini = h[0], fim = h[0];
  for (let i = 1; i <= h.length; i++) {
    if (h[i] === fim + 1) fim = h[i];
    else { out.push(`${ini}h às ${fim + 1}h`); ini = fim = h[i]; }
  }
  return out.join(', ');
}

// Lista de horas válida: inteiros, sem repetição, dentro do funcionamento
export function horasValidas(horas, geral) {
  if (!Array.isArray(horas) || !horas.length || horas.length > 24) return null;
  const lista = [...new Set(horas.map(Number))].sort((a, b) => a - b);
  if (lista.some((h) => !Number.isInteger(h) || h < geral.abre || h >= geral.fecha)) return null;
  return lista;
}
