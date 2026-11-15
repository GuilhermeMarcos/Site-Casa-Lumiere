// Preços: cada sala tem uma tabela "quantidade de horas → valor" que a equipe monta no painel.
// O total de uma reserva é a combinação mais barata dessas linhas que soma exatamente as horas pedidas.
// Ex.: 1h R$ 50 e 4h R$ 180. Para 5h: 180 + 50 = R$ 230. Para 8h: 180 + 180 = R$ 360.
// O mesmo cálculo existe em js/salas.js e js/painel.js só para mostrar na tela; quem decide o valor é o servidor.
import { Falha } from './http.js';

const centavos = (v) => Math.round(Number(v) * 100);

// Valida e normaliza a tabela que vem do painel
export function validarPrecos(lista) {
  if (!Array.isArray(lista) || lista.length > 12) throw new Falha(400, 'precos', 'Use até 12 linhas de preço por sala.');
  const vistas = new Set();
  const out = lista.map((l) => {
    const horas = Number(l && l.horas), valor = Number(l && l.valor);
    if (!Number.isInteger(horas) || horas < 1 || horas > 24) throw new Falha(400, 'precos', 'A quantidade de horas vai de 1 a 24.');
    if (!Number.isFinite(valor) || valor < 0 || valor > 99999) throw new Falha(400, 'precos', 'Digite o valor só com números, como 50,00.');
    if (vistas.has(horas)) throw new Falha(400, 'precos', `A quantidade de ${horas}h está repetida.`);
    vistas.add(horas);
    return { horas, valor: centavos(valor) / 100 };
  });
  return out.sort((a, b) => a.horas - b.horas);
}

// Total em reais para n horas, ou null se a tabela não consegue formar esse total
export function calcularValor(precos, n) {
  if (!Array.isArray(precos) || !precos.length || !(n > 0)) return null;
  const melhor = new Array(n + 1).fill(Infinity);
  melhor[0] = 0;
  for (let i = 1; i <= n; i++) {
    for (const p of precos) {
      if (p.horas <= i && melhor[i - p.horas] + centavos(p.valor) < melhor[i]) melhor[i] = melhor[i - p.horas] + centavos(p.valor);
    }
  }
  return Number.isFinite(melhor[n]) ? melhor[n] / 100 : null;
}

// Desconto de parceiro sobre o aluguel, em porcentagem (0 a 100)
export function comDesconto(valor, descontoPct) {
  if (valor == null) return null;
  return Math.round(centavos(valor) * (100 - Number(descontoPct || 0)) / 100) / 100;
}

export function porcentagem(v, nome) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new Falha(400, 'porcentagem', `${nome} vai de 0 a 100%.`);
  return Math.round(n * 100) / 100;
}

export function dinheiro(v, nome = 'O valor') {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 999999) throw new Falha(400, 'valor', `${nome} precisa ser um número, como 150,00.`);
  return centavos(n) / 100;
}
