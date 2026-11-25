/* Painel da equipe da Casa Lumière: reservas, salas, horários fixos e funcionamento, ligado à API */
(function(){
  var MONO = 'assets/img/monograma.webp';
  var WA_ICONE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C6.5 2.5 2.2 6.4 2.2 11.2c0 2.6 1.2 4.9 3.2 6.5L4.5 21.5l4.4-2.2c1 .3 2 .4 3.1.4 5.5 0 9.8-3.9 9.8-8.6S17.5 2.5 12 2.5z"/></svg>';
  var ICONES = {
    inicio: 'M3 11l9-7 9 7M5 10v10h14V10',
    reservas: 'M5 5h14v15H5zM5 9h14M9 3v4M15 3v4',
    salas: 'M6 20V10a6 6 0 0 1 12 0v10M4 20h16M14 14v1',
    fixos: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    seguranca: 'M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6zM9 12l2 2 4-4',
    funcionamento: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
    profissionais: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    parceiros: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM2 20a6 6 0 0 1 12 0M10 20a6 6 0 0 1 12 0'
  };
  var SECOES = [['inicio', 'Início'], ['reservas', 'Reservas'], ['salas', 'Salas e valores'], ['profissionais', 'Profissionais'], ['parceiros', 'Parceiros'], ['fixos', 'Horários fixos'], ['funcionamento', 'Funcionamento'], ['seguranca', 'Segurança']];
  var DIAS_SEM = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  var d = document, $ = function(id){ return d.getElementById(id); };
  function el(tag, cls, txt){ var e = d.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }
  function pad(n){ return (n < 10 ? '0' : '') + n; }
  function chave(dt){ return dt.getFullYear() + '-' + pad(dt.getMonth() + 1) + '-' + pad(dt.getDate()); }
  function deChave(k){ var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  var hoje = new Date(); hoje.setHours(0,0,0,0); var HOJE = chave(hoje); /* trocado pela data de Holambra quando os dados chegam */
  var fmtDia = new Intl.DateTimeFormat('pt-BR', {weekday:'short', day:'numeric', month:'short'});
  var fmtLongo = new Intl.DateTimeFormat('pt-BR', {weekday:'long', day:'numeric', month:'long'});
  function limpa(s){ return String(s).replace(/\./g, ''); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function diaCurto(k){ var dt = deChave(k); return cap(limpa(fmtDia.format(dt))) + (dt.getFullYear() !== hoje.getFullYear() ? ' de ' + dt.getFullYear() : ''); }
  function diaLongo(k){ return cap(limpa(fmtLongo.format(deChave(k)))); }
  var fmtBRL = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
  function brl(v){ return v == null ? '' : fmtBRL.format(v); }
  /* "1.234,56" ou "1234.56" vira número; vazio vira null */
  function numero(txt){ var t = String(txt == null ? '' : txt).trim().replace(/[R$\s]/g, ''); if(t === '') return null; if(t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.'); var n = Number(t); return isFinite(n) ? n : NaN; }
  function emReais(v){ return v == null ? '' : String(Math.round(v * 100) / 100).replace('.', ','); }
  /* Mesmo cálculo do servidor: a combinação mais barata das linhas da tabela que soma as horas */
  function calcularValor(precos, n){
    if(!precos || !precos.length || !(n > 0)) return null;
    var m = [0]; for(var i = 1; i <= n; i++){ m[i] = Infinity; precos.forEach(function(p){ if(p.horas <= i && m[i - p.horas] + Math.round(p.valor * 100) < m[i]) m[i] = m[i - p.horas] + Math.round(p.valor * 100); }); }
    return isFinite(m[n]) ? m[n] / 100 : null;
  }
  function faixa(horas){ horas = (horas || []).slice().sort(function(a,b){return a-b;}); if(!horas.length) return ''; var out = [], i0 = horas[0], f = horas[0];
    for(var i = 1; i <= horas.length; i++){ if(horas[i] === f + 1) f = horas[i]; else { out.push(i0 + 'h às ' + (f + 1) + 'h'); i0 = f = horas[i]; } } return out.join(', '); }

  /* ===== Estado ===== */
  var st = { aba: 'inicio', filtro: 'todas', filtroSala: '', geral: null, salas: [], fixos: [], reservas: [], parceiros: [], atendimentos: [], filtroMes: '', filtroParc: '', carregado: false, acesso: null, nome: '' };

  function api(metodo, caminho, corpo){
    return fetch(caminho, {
      method: metodo, credentials: 'same-origin',
      headers: corpo ? {'Content-Type': 'application/json'} : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(dados){
        if(!r.ok){ var e = new Error(dados.mensagem || 'Não foi possível salvar agora. Tente de novo.'); e.status = r.status; e.erro = dados.erro; throw e; }
        return dados;
      });
    }, function(){ var e = new Error('Sem conexão com a internet. Confira e tente de novo.'); e.status = 0; throw e; });
  }

  function toast(txt, erro){
    var v = d.querySelector('.toast'); if(v) v.remove();
    var t = el('div', 'toast' + (erro ? ' erro' : '')); t.setAttribute('role', erro ? 'alert' : 'status');
    var i = el('img'); i.src = MONO; i.alt = ''; t.appendChild(i); t.appendChild(el('span', null, txt));
    d.body.appendChild(t); setTimeout(function(){ t.remove(); }, 4200);
  }
  function falha(e){
    if(e && e.status === 401){ st.acesso = null; st.carregado = false; desenhar(); toast('A sua sessão terminou. Entre de novo.', true); return; }
    toast((e && e.message) || 'Não foi possível salvar agora. Tente de novo.', true);
  }

  /* ===== Menu ===== */
  function desenharMenu(){
    var m = $('menu'); m.textContent = '';
    if(st.acesso !== true || !st.carregado) return;
    var pre = st.reservas.filter(function(r){ return r.status === 'pre' && r.data >= HOJE; }).length;
    SECOES.forEach(function(s){
      var b = el('button'); b.type = 'button'; b.setAttribute('role', 'tab'); b.id = 'tab-' + s[0];
      b.setAttribute('aria-selected', st.aba === s[0] ? 'true' : 'false'); b.tabIndex = st.aba === s[0] ? 0 : -1;
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="' + ICONES[s[0]] + '"/></svg>';
      b.appendChild(d.createTextNode(s[1]));
      if(s[0] === 'reservas' && pre){ b.appendChild(el('span', 'badge', pre)); b.setAttribute('aria-label', s[1] + ', ' + pre + ' para confirmar'); }
      b.addEventListener('click', function(){ ir(s[0]); });
      b.addEventListener('keydown', function(e){ var k = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1}[e.key]; if(!k) return; e.preventDefault(); var i = SECOES.findIndex(function(x){ return x[0] === st.aba; }); ir(SECOES[(i + k + SECOES.length) % SECOES.length][0], true); });
      m.appendChild(b);
    });
  }
  function ir(aba, foco){ st.aba = aba; desenhar(); window.scrollTo(0, 0); if(foco){ var t = $('tab-' + aba); if(t) t.focus(); } }

  /* ===== Ajudas de dados ===== */
  function salaPorId(id){ return st.salas.filter(function(s){ return s.id === id; })[0]; }
  function nomeSala(id){ var s = salaPorId(id); return s ? (s.nome + (s.tipo ? ' ' + s.tipo : '')) : 'Sala removida'; }
  function salasOrdenadas(){ return st.salas.slice().sort(function(a,b){ return (a.ordem || 0) - (b.ordem || 0); }); }
  function fixoOcupa(salaId, data, h){
    var dt = deChave(data);
    return st.fixos.some(function(f){
      if(f.sala !== salaId || h < f.de || h >= f.ate) return false;
      if(f.desde && data < f.desde) return false;
      if(f.repete === 'semanal') return dt.getDay() === +f.diaSemana;
      if(f.repete === 'aCadaDias'){ var dd = Math.round((dt - deChave(f.desde)) / 86400000); return dd >= 0 && dd % (f.aCadaDias || 15) === 0; }
      if(f.repete === 'unico') return data === f.desde;
      return false;
    });
  }
  function conflito(salaId, data, horas, ignorarId){
    for(var i = 0; i < horas.length; i++){
      var h = horas[i];
      if(fixoOcupa(salaId, data, h)) return h + 'h é horário fixo';
      var outra = st.reservas.filter(function(r){ return r.id !== ignorarId && r.status !== 'expirada' && r.sala === salaId && r.data === data && (r.horas || []).indexOf(h) >= 0; })[0];
      if(outra) return h + 'h já está com ' + (outra.nome || 'outra reserva');
    }
    return '';
  }
  function linkWhats(tel, msg, web){
    var n = String(tel || '').replace(/\D/g, ''); if(!n) return '';
    if(n.length <= 11) n = '55' + n;
    return (web ? 'https://web.whatsapp.com/send?phone=' : 'https://wa.me/') + n + (web ? '&text=' : '?text=') + encodeURIComponent(msg || '');
  }

  /* ===== Escrita ===== */
  /* Cada alteração chama a API e depois recarrega os dados; a mesma chave não roda duas vezes ao mesmo tempo */
  var ocupado = {};
  function escrever(chave, fn){
    if(ocupado[chave]) return Promise.resolve(false);
    ocupado[chave] = true;
    return fn().then(function(){ ocupado[chave] = false; return recarregar().then(function(){ return true; }); }, function(e){ ocupado[chave] = false; falha(e); return false; });
  }

  /* ===== Telas ===== */
  function desenhar(){
    desenharMenu();
    var area = $('area'); area.textContent = '';
    var titulo = $('titulo'), sub = $('sub');
    if(st.acesso === false){ titulo.innerHTML = 'Painel da <em>Casa</em>'; sub.textContent = ''; area.appendChild(semAcesso()); return; }
    if(st.acesso === null){ titulo.innerHTML = 'Painel da <em>Casa</em>'; sub.textContent = 'Entre com o e-mail da equipe.'; area.appendChild(telaLogin()); return; }
    if(!st.carregado){ titulo.innerHTML = 'Painel da <em>Casa</em>'; sub.textContent = ''; return; }
    var nomeCurto = /\s(e|E)\s/.test(st.nome || '') ? st.nome.trim() : (st.nome || '').trim().split(/\s+/)[0]; /* conta da dupla: "Luiza e Agatha" */
    if(st.aba === 'inicio'){ titulo.innerHTML = 'Olá, <em></em>'; titulo.querySelector('em').textContent = nomeCurto || 'equipe'; sub.textContent = 'Hoje é ' + limpa(fmtLongo.format(hoje)) + '.'; }
    else { titulo.textContent = SECOES.filter(function(s){ return s[0] === st.aba; })[0][1]; sub.textContent = {reservas:'Confirme pré-reservas, crie e altere reservas.', salas:'Nome, tipo, foto, preços e disponibilidade de cada sala.', profissionais:'Quem aparece na página Profissionais do site, com foto e especialidade.', parceiros:'Desconto no aluguel, atendimentos lançados e repasses.', fixos:'Horários que já ficam reservados e se repetem.', seguranca:'Verificação em duas etapas, aparelhos conectados e últimos acessos.', funcionamento:'Horário de abertura, dias e contato que recebe as pré-reservas.'}[st.aba]; }
    var s = el('div', 'secao'); s.setAttribute('role', 'tabpanel'); s.setAttribute('aria-labelledby', 'tab-' + st.aba);
    ({inicio: telaInicio, reservas: telaReservas, salas: telaSalas, profissionais: telaProfissionais, parceiros: telaParceiros, fixos: telaFixos, funcionamento: telaFuncionamento, seguranca: telaSeguranca})[st.aba](s);
    area.appendChild(s);
  }
  function semAcesso(){
    var a = el('div', 'aviso-tela'); var i = el('img'); i.src = MONO; i.alt = ''; a.appendChild(i);
    a.appendChild(el('h2', null, 'Painel só para a equipe'));
    a.appendChild(el('p', null, 'Você entrou com uma conta de cliente. Para alterar salas e reservas, entre com o e-mail da equipe.'));
    var ir = el('a', 'btn-borda', 'Voltar ao site'); ir.href = 'index.html'; a.appendChild(ir);
    var sa = el('button', 'btn-texto', 'Entrar com outra conta'); sa.type = 'button'; sa.addEventListener('click', sair); a.appendChild(sa);
    return a;
  }
  function telaLogin(){
    var a = el('div', 'login-painel'); var i = el('img'); i.src = MONO; i.alt = ''; a.appendChild(i);
    var f = el('form'); f.noValidate = true;
    var em = entrada('l-email', 'email', '', {autocomplete:'username', inputmode:'email'});
    var se = entrada('l-senha', 'password', '', {autocomplete:'current-password'});
    f.appendChild(campo('E-mail', em)); f.appendChild(campo('Senha', se));
    var lm = el('label', 'lembrar'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = true; lm.appendChild(cb); lm.appendChild(d.createTextNode('Manter conectado')); f.appendChild(lm);
    /* Segunda etapa: código que chega no e-mail da equipe (ou o código da equipe, enquanto o e-mail não estiver ligado) */
    var modo = '';
    var cod = entrada('l-cod', 'text', '', {autocomplete:'one-time-code'});
    var cCod = campo('Código', cod); cCod.hidden = true; f.appendChild(cCod);
    var reenviar = el('button', 'btn-texto', 'Não chegou? Enviar outro código'); reenviar.type = 'button'; reenviar.hidden = true;
    reenviar.addEventListener('click', function(){ cod.value = ''; enviar(true); });
    f.appendChild(reenviar);
    var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); f.appendChild(msg);
    var bt = el('button', 'btn', 'Entrar'); bt.type = 'submit'; f.appendChild(bt);
    var aj = el('p', 'ajuda-login'); aj.appendChild(d.createTextNode('Esqueceu a senha? No site, toque em Entrar e depois em "Esqueci minha senha". ')); var vs = el('a', null, 'Voltar ao site'); vs.href = 'index.html'; aj.appendChild(vs); f.appendChild(aj);
    function enviar(semCodigo){
      msg.textContent = '';
      if(!em.value.trim() || !se.value){ msg.textContent = 'Digite o e-mail e a senha.'; return; }
      var corpo = {email: em.value.trim(), senha: se.value, lembrar: cb.checked};
      if(!semCodigo && modo && cod.value.trim()){ if(modo === 'email') corpo.codigoEmail = cod.value.trim(); else corpo.codigoEquipe = cod.value.trim(); }
      bt.disabled = true; bt.textContent = 'Entrando…';
      api('POST', '/api/auth/entrar', corpo).then(function(r){ entrouComo(r.conta); }).catch(function(err){
        bt.disabled = false; bt.textContent = 'Entrar';
        if(err.erro === 'precisa_codigo' || err.erro === 'precisa_codigo_equipe'){
          modo = err.erro === 'precisa_codigo' ? 'email' : 'equipe';
          cCod.hidden = false; reenviar.hidden = modo !== 'email';
          cCod.querySelector('label').textContent = modo === 'email' ? 'Código que chegou no e-mail' : 'Código da equipe';
          cod.type = modo === 'email' ? 'text' : 'password';
          cod.setAttribute('inputmode', modo === 'email' ? 'numeric' : 'text');
          cod.placeholder = modo === 'email' ? '000000' : '';
          var aj = cCod.querySelector('.ajuda'); if(!aj){ aj = el('span', 'ajuda'); cCod.appendChild(aj); } aj.textContent = err.message;
          cod.focus(); return;
        }
        if(err.erro === 'codigo_errado' || err.erro === 'codigo_vencido' || err.erro === 'codigo_equipe') cod.value = '';
        msg.textContent = err.message;
      });
    }
    f.addEventListener('submit', function(e){ e.preventDefault(); enviar(false); });
    a.appendChild(f);
    setTimeout(function(){ em.focus(); }, 30);
    return a;
  }

  /* Início */
  function telaInicio(s){
    var futuras = st.reservas.filter(function(r){ return r.data >= HOJE; });
    var pre = futuras.filter(function(r){ return r.status !== 'confirmada'; });
    var hojeRes = st.reservas.filter(function(r){ return r.data === HOJE; });
    var semana = chave(new Date(hoje.getTime() + 7 * 86400000));
    var horasSemana = futuras.filter(function(r){ return r.data < semana; }).reduce(function(t, r){ return t + (r.horas || []).length; }, 0);
    var ativas = st.salas.filter(function(x){ return x.disponivel !== false; }).length;
    var nums = el('div', 'numeros');
    [[pre.length, pre.length === 1 ? 'Pré-reserva para confirmar' : 'Pré-reservas para confirmar', 'reservas', true, 'pre'],
     [hojeRes.length, hojeRes.length === 1 ? 'Reserva hoje' : 'Reservas hoje', 'reservas', false, 'todas'],
     [horasSemana + 'h', 'Reservadas nos próximos 7 dias', 'reservas', false, 'todas'],
     [ativas + ' de ' + st.salas.length, 'Salas disponíveis', 'salas', false]].concat(st.parceiros.length ? [[brl(aReceber()), 'A receber dos parceiros', 'parceiros', false]] : []).forEach(function(n){
      var b = el('button', 'numero' + (n[3] ? ' destaque' : '')); b.type = 'button';
      b.appendChild(el('strong', null, n[0])); b.appendChild(el('span', null, n[1]));
      b.addEventListener('click', function(){ if(n[4]) st.filtro = n[4]; ir(n[2]); });
      nums.appendChild(b);
    });
    s.appendChild(nums);
    var b1 = bloco('Para confirmar', pre.length ? 'Fale com a pessoa, combine o pagamento e confirme' : '');
    if(pre.length) b1.appendChild(listaReservas(pre.sort(ordem), false));
    else b1.appendChild(vazio('Nada para confirmar', 'Quando alguém pré-reservar uma sala pelo site, a pré-reserva aparece aqui.'));
    s.appendChild(b1);
    var b2 = bloco('Hoje', ''); var acao = el('button', 'btn-borda', 'Nova reserva'); acao.type = 'button'; acao.addEventListener('click', function(){ formReserva(null); }); b2.querySelector('.bloco-cab').appendChild(acao);
    if(hojeRes.length) b2.appendChild(listaReservas(hojeRes.sort(ordem), false));
    else b2.appendChild(vazio('Nenhuma reserva hoje', 'As salas estão livres hoje, fora os horários fixos.'));
    s.appendChild(b2);
  }
  function ordem(a, b){ return (a.data + pad(Math.min.apply(null, a.horas || [0]))).localeCompare(b.data + pad(Math.min.apply(null, b.horas || [0]))); }
  function bloco(t, p){ var b = el('section', 'bloco'); var c = el('div', 'bloco-cab'); var h = el('div'); h.appendChild(el('h2', null, t)); if(p) h.appendChild(el('p', null, p)); c.appendChild(h); b.appendChild(c); return b; }
  function vazio(t, p){ var v = el('div', 'vazio'); v.appendChild(el('strong', null, t)); v.appendChild(d.createTextNode(p)); return v; }

  /* Lista de reservas */
  function listaReservas(lista, agrupar){
    var ul = el('ul', 'lista'), ultimo = '';
    lista.forEach(function(r){
      if(agrupar && r.data !== ultimo){ ultimo = r.data; var g = el('li', 'dia-grupo', diaLongo(r.data)); ul.appendChild(g); }
      var li = el('li', 'res');
      var q = el('div', 'quando'); if(!agrupar) q.appendChild(el('strong', null, diaCurto(r.data))); q.appendChild(el('span', null, faixa(r.horas))); li.appendChild(q);
      var meio = el('div'); meio.appendChild(el('div', 'sala-nome', nomeSala(r.sala)));
      var p = el('div', 'pessoa'); p.appendChild(d.createTextNode((r.nome || 'Sem nome') + (r.especialidade ? ', ' + r.especialidade : '') + (r.telefone ? ' · ' : '')));
      if(r.telefone){
        var texto = 'Olá, ' + (r.nome || '').split(' ')[0] + '! Aqui é da Casa Lumière, sobre a sua reserva da ' + nomeSala(r.sala) + ' em ' + diaLongo(r.data).toLowerCase() + ', ' + faixa(r.horas) + '.';
        var a = el('a', null, formatarTel(r.telefone)); a.href = linkWhats(r.telefone, texto); a.target = '_blank'; a.rel = 'noopener'; a.title = 'Abrir no WhatsApp'; p.appendChild(a);
        p.appendChild(d.createTextNode(' '));
        var w = el('a', 'link-web', 'WhatsApp Web'); w.href = linkWhats(r.telefone, texto, true); w.target = '_blank'; w.rel = 'noopener'; p.appendChild(w);
      }
      meio.appendChild(p);
      var chip = el('span', 'chip ' + ({confirmada:'ok', pre:'pre', expirada:'exp'})[r.status], ({confirmada:'Reservada', pre:'Pré-reserva', expirada:'Pré-reserva expirou'})[r.status]); meio.appendChild(chip);
      if(r.status === 'pre' && r.expiraEm){ meio.appendChild(el('span', 'expira', 'Vale até ' + fmtHora.format(new Date(r.expiraEm)))); }
      if(r.origem === 'painel') meio.appendChild(el('span', 'origem', 'Feita pelo painel'));
      var vl = el('span', 'valor-res', r.valor != null ? brl(r.valor) : r.parceiroId ? pctTxt(r.pctParceiro != null ? r.pctParceiro : 0) + ' do procedimento' : 'Valor a combinar');
      if(r.parceiroId){ var pc = parceiroPorId(r.parceiroId); vl.appendChild(el('small', null, ' parceiro' + (pc ? ' ' + pc.nome.split(' ')[0] : ''))); }
      meio.appendChild(vl);
      li.appendChild(meio);
      var ac = el('div', 'acoes');
      if(r.status !== 'confirmada'){
        var c = el('button', 'btn', 'Confirmar'); c.type = 'button';
        c.addEventListener('click', function(){ c.disabled = true; escrever('r' + r.id, function(){ return api('POST', '/api/admin/reservas/' + r.id + '/confirmar'); }).then(function(ok){ if(ok) toast('Reserva confirmada: ' + nomeSala(r.sala) + ', ' + diaCurto(r.data) + '.'); else c.disabled = false; }); });
        ac.appendChild(c);
      }
      var e = el('button', 'btn-texto', 'Editar'); e.type = 'button'; e.addEventListener('click', function(){ formReserva(r); }); ac.appendChild(e);
      var x = el('button', 'btn-texto perigo', r.status === 'confirmada' ? 'Cancelar' : (r.status === 'expirada' ? 'Remover' : 'Recusar')); x.type = 'button';
      x.addEventListener('click', function(){
        if(!x.dataset.ok){ x.dataset.ok = '1'; x.textContent = 'Confirmar ' + (r.status === 'confirmada' ? 'cancelamento' : (r.status === 'expirada' ? 'remoção' : 'recusa')); setTimeout(function(){ if(x.isConnected){ delete x.dataset.ok; x.textContent = r.status === 'confirmada' ? 'Cancelar' : (r.status === 'expirada' ? 'Remover' : 'Recusar'); } }, 5000); return; }
        x.disabled = true;
        escrever('r' + r.id, function(){ return api('DELETE', '/api/admin/reservas/' + r.id); }).then(function(ok){ if(ok) toast('Reserva removida. O horário voltou a ficar livre.'); else x.disabled = false; });
      });
      ac.appendChild(x);
      li.appendChild(ac);
      ul.appendChild(li);
    });
    return ul;
  }

  /* Reservas */
  function telaReservas(s){
    var b = bloco('Agenda de reservas', ''); var nova = el('button', 'btn', 'Nova reserva'); nova.type = 'button'; nova.addEventListener('click', function(){ formReserva(null); }); b.querySelector('.bloco-cab').appendChild(nova);
    var f = el('div', 'filtros');
    var pil = el('div', 'pilulas'); pil.setAttribute('role', 'group'); pil.setAttribute('aria-label', 'Situação');
    [['todas', 'Próximas'], ['pre', 'Pré-reservas'], ['ok', 'Confirmadas'], ['passadas', 'Passadas']].forEach(function(o){
      var x = el('button', null, o[1]); x.type = 'button'; x.setAttribute('aria-pressed', st.filtro === o[0] ? 'true' : 'false');
      x.addEventListener('click', function(){ st.filtro = o[0]; desenhar(); }); pil.appendChild(x);
    });
    f.appendChild(pil);
    var cs = el('div', 'campo'); var lb = el('label', null, 'Sala'); lb.htmlFor = 'filtro-sala'; var sel = el('select'); sel.id = 'filtro-sala';
    var o0 = el('option', null, 'Todas as salas'); o0.value = ''; sel.appendChild(o0);
    salasOrdenadas().forEach(function(x){ var o = el('option', null, nomeSala(x.id)); o.value = x.id; if(st.filtroSala === x.id) o.selected = true; sel.appendChild(o); });
    sel.addEventListener('change', function(){ st.filtroSala = sel.value; desenhar(); });
    cs.appendChild(lb); cs.appendChild(sel); f.appendChild(cs);
    b.appendChild(f);
    var lista = st.reservas.filter(function(r){
      if(st.filtroSala && r.sala !== st.filtroSala) return false;
      if(st.filtro === 'passadas') return r.data < HOJE;
      if(r.data < HOJE) return false;
      if(st.filtro === 'pre') return r.status !== 'confirmada';
      if(st.filtro === 'ok') return r.status === 'confirmada';
      return true;
    }).sort(ordem);
    if(st.filtro === 'passadas') lista.reverse();
    if(lista.length) b.appendChild(listaReservas(lista, true));
    else b.appendChild(vazio('Nenhuma reserva aqui', st.filtro === 'pre' ? 'Não há pré-reservas esperando confirmação.' : 'Use "Nova reserva" para registrar uma reserva feita por telefone ou WhatsApp.'));
    s.appendChild(b);
  }

  /* Janela: criar ou editar reserva */
  function campo(rotulo, input, cls, ajuda){ var c = el('div', 'campo' + (cls ? ' ' + cls : '')); var l = el('label', null, rotulo); l.htmlFor = input.id; c.appendChild(l); c.appendChild(input); if(ajuda) c.appendChild(el('span', 'ajuda', ajuda)); return c; }
  function entrada(id, tipo, valor, attrs){ var i = el('input'); i.id = id; i.type = tipo || 'text'; if(valor != null) i.value = valor; for(var k in (attrs || {})) i.setAttribute(k, attrs[k]); return i; }
  function seletor(id, opcoes, valor){ var s = el('select'); s.id = id; opcoes.forEach(function(o){ var op = el('option', null, o[1]); op.value = o[0]; if(String(o[0]) === String(valor)) op.selected = true; s.appendChild(op); }); return s; }
  function horasAbertas(){ var g = st.geral || {}; var a = g.abre != null ? g.abre : 7, f = g.fecha != null ? g.fecha : 20; var out = []; for(var h = a; h <= f; h++) out.push(h); return out; }
  function abrirJanela(titulo, montar){
    var antes = d.activeElement;
    var fundo = el('div', 'fundo'); var j = el('div', 'janela'); j.setAttribute('role', 'dialog'); j.setAttribute('aria-modal', 'true'); j.setAttribute('aria-labelledby', 'janela-titulo');
    var c = el('div', 'janela-cab'); var h = el('h2', null, titulo); h.id = 'janela-titulo'; var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar');
    c.appendChild(h); c.appendChild(x); j.appendChild(c);
    function fechar(){ fundo.remove(); d.removeEventListener('keydown', esc); if(antes && antes.focus) antes.focus(); }
    function esc(e){ if(e.key === 'Escape') fechar(); }
    x.addEventListener('click', fechar); fundo.addEventListener('click', function(e){ if(e.target === fundo) fechar(); }); d.addEventListener('keydown', esc);
    montar(j, fechar); fundo.appendChild(j); $('camada').appendChild(fundo);
    var p = j.querySelector('input, select'); if(p) p.focus();
  }
  function formReserva(r){
    abrirJanela(r ? 'Editar reserva' : 'Nova reserva', function(j, fechar){
      var f = el('form'); f.noValidate = true;
      var hs = horasAbertas();
      var ini = r ? Math.min.apply(null, r.horas) : hs[0], fim = r ? Math.max.apply(null, r.horas) + 1 : hs[0] + 1;
      var cs = el('div', 'campos');
      var sSala = seletor('r-sala', salasOrdenadas().filter(function(x){ return x.disponivel !== false || (r && r.sala === x.id); }).map(function(x){ return [x.id, nomeSala(x.id)]; }), r ? r.sala : '');
      cs.appendChild(campo('Sala', sSala, 'largo'));
      cs.appendChild(campo('Dia', entrada('r-dia', 'date', r ? r.data : HOJE)));
      cs.appendChild(campo('Das', seletor('r-de', hs.slice(0, -1).map(function(h){ return [h, pad(h) + 'h']; }), ini)));
      cs.appendChild(campo('Até', seletor('r-ate', hs.slice(1).map(function(h){ return [h, pad(h) + 'h']; }), fim)));
      cs.appendChild(campo('Nome', entrada('r-nome', 'text', r ? r.nome : '', {autocomplete:'off'})));
      cs.appendChild(campo('Especialidade', entrada('r-esp', 'text', r ? r.especialidade : '')));
      cs.appendChild(campo('WhatsApp', entrada('r-tel', 'tel', r && r.telefone ? formatarTel(r.telefone) : '', {inputmode:'tel', placeholder:'(19) 99999-9999'})));
      cs.appendChild(campo('Situação', seletor('r-status', [['confirmada', 'Reservada'], ['pre', 'Pré-reserva']], r ? (r.status === 'confirmada' ? 'confirmada' : 'pre') : 'confirmada')));
      var opsParc = [['', 'Não é parceiro']].concat(st.parceiros.filter(function(p){ return p.ativo || (r && r.parceiroId === p.id); }).map(function(p){ return [p.id, p.nome + ' (' + pctTxt(p.pctAtendimento) + ' do procedimento)']; }));
      cs.appendChild(campo('Parceiro', seletor('r-parc', opsParc, r ? (r.parceiroId || '') : '')));
      var iVal = entrada('r-valor', 'text', '', {inputmode:'decimal', placeholder:'0,00'});
      var pv = el('div', 'prefixo'); pv.appendChild(el('span', null, 'R$')); pv.appendChild(iVal);
      var cVal = el('div', 'campo'); var lVal = el('label', null, 'Valor do aluguel'); lVal.htmlFor = 'r-valor'; cVal.appendChild(lVal); cVal.appendChild(pv);
      var ajudaVal = el('span', 'ajuda'); cVal.appendChild(ajudaVal); cs.appendChild(cVal);
      function valorAuto(){
        var sala = salaPorId($('r-sala').value), n = (+$('r-ate').value) - (+$('r-de').value), pc = parceiroPorId($('r-parc').value);
        var cheio = sala ? calcularValor(sala.precos, n) : null;
        return pc ? null : cheio;
      }
      function mostrarAuto(){
        var pc = parceiroPorId($('r-parc').value), v = valorAuto();
        if(pc){ ajudaVal.textContent = 'Parceiro não paga aluguel: repassa ' + pctTxt(pc.pctAtendimento) + ' do procedimento. Deixe em branco.'; return; }
        ajudaVal.textContent = 'Em branco: ' + (v != null ? brl(v) + ' pela tabela da sala' : 'a tabela da sala não tem preço para essas horas') + '.';
      }
      if(r && r.valor != null && r.valor !== valorAuto()) iVal.value = emReais(r.valor);
      ['r-sala', 'r-de', 'r-ate', 'r-parc'].forEach(function(id){ cs.querySelector('#' + id).addEventListener('change', mostrarAuto); });
      setTimeout(mostrarAuto, 0);
      f.appendChild(cs);
      var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
      var cancelar = el('button', 'btn-borda', 'Cancelar'); cancelar.type = 'button'; cancelar.addEventListener('click', fechar); rod.appendChild(cancelar);
      var salvar = el('button', 'btn', r ? 'Salvar alterações' : 'Criar reserva'); salvar.type = 'submit'; rod.appendChild(salvar);
      f.appendChild(rod);
      f.addEventListener('submit', function(e){
        e.preventDefault();
        var sala = $('r-sala').value, dia = $('r-dia').value, de = +$('r-de').value, ate = +$('r-ate').value, nome = $('r-nome').value.trim();
        if(!sala || !dia){ msg.textContent = 'Escolha a sala e o dia.'; return; }
        if(ate <= de){ msg.textContent = 'O horário final precisa ser depois do inicial.'; return; }
        if(!nome){ msg.textContent = 'Digite o nome de quem vai usar a sala.'; return; }
        var horas = []; for(var h = de; h < ate; h++) horas.push(h);
        var c = conflito(sala, dia, horas, r && r.id); if(c){ msg.textContent = 'Esse horário não está livre: ' + c + '.'; return; }
        var vManual = numero($('r-valor').value);
        if(vManual !== null && (isNaN(vManual) || vManual < 0)){ msg.textContent = 'Digite o valor só com números, como 150,00.'; return; }
        var dados = { sala: sala, data: dia, horas: horas, nome: nome, especialidade: $('r-esp').value.trim(), telefone: $('r-tel').value.trim(), status: $('r-status').value, parceiro: $('r-parc').value, valor: vManual === null ? '' : vManual };
        salvar.disabled = true;
        escrever('form-reserva', function(){ return r ? api('PATCH', '/api/admin/reservas/' + r.id, dados) : api('POST', '/api/admin/reservas', dados); }).then(function(ok){
          salvar.disabled = false;
          if(ok){ fechar(); toast((r ? 'Reserva atualizada: ' : 'Reserva criada: ') + nomeSala(sala) + ', ' + diaCurto(dia) + ', ' + faixa(horas) + '.'); }
        });
      });
      j.appendChild(f);
    });
  }

  /* Salas */
  function telaSalas(s){
    var b = bloco('Salas', 'O que aparece aqui é o que as pessoas veem na página de salas');
    var add = el('button', 'btn-borda', 'Adicionar sala'); add.type = 'button';
    add.addEventListener('click', function(){
      escrever('nova-sala', function(){ return api('POST', '/api/admin/salas'); }).then(function(ok){ if(ok) toast('Sala criada como indisponível. Preencha os dados e ative quando estiver pronta.'); });
    });
    b.querySelector('.bloco-cab').appendChild(add);
    if(!st.salas.length) b.appendChild(vazio('Nenhuma sala cadastrada', 'Use "Adicionar sala" para cadastrar a primeira.'));
    salasOrdenadas().forEach(function(x){ b.appendChild(cartaoSala(x)); });
    s.appendChild(b);
  }
  function cartaoSala(x){
    var art = el('article', 'sala' + (x.disponivel === false ? ' off' : ''));
    var foto = el('div', 'foto');
    if(x.foto){ var im = el('img'); im.src = x.foto; im.alt = 'Foto da ' + nomeSala(x.id); im.onerror = function(){ im.remove(); }; foto.appendChild(im); }
    var inp = el('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp'; inp.id = 'foto-' + x.id;
    var lab = el('label'); lab.htmlFor = inp.id; lab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-2h4l2 2h4v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>'; lab.appendChild(d.createTextNode(x.foto ? 'Trocar foto' : 'Enviar foto'));
    inp.addEventListener('change', function(){
      var file = inp.files && inp.files[0]; if(!file) return;
      if(!/^image\/(jpeg|png|webp)$/.test(file.type)){ toast('Use uma foto em JPG, PNG ou WebP.', true); return; }
      if(file.size > 25 * 1024 * 1024){ toast('A foto é grande demais. Use uma de até 25 MB.', true); return; }
      lab.lastChild.nodeValue = 'Enviando…';
      reduzirFoto(file).then(function(dataUrl){
        return escrever('foto-' + x.id, function(){ return api('POST', '/api/admin/salas/' + x.id + '/foto', {imagem: dataUrl}); }).then(function(ok){ if(ok) toast('Foto da ' + nomeSala(x.id) + ' atualizada.'); else lab.lastChild.nodeValue = x.foto ? 'Trocar foto' : 'Enviar foto'; });
      }).catch(function(){ lab.lastChild.nodeValue = x.foto ? 'Trocar foto' : 'Enviar foto'; toast('Não foi possível ler essa foto. Tente outra.', true); });
    });
    foto.appendChild(inp); foto.appendChild(lab);
    art.appendChild(foto);
    var corpo = el('div');
    var cab = el('div', 'sala-cab'); cab.appendChild(el('h3', null, x.nome || 'Sala'));
    var ch = el('label', 'chave'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = x.disponivel !== false; cb.id = 'disp-' + x.id;
    ch.appendChild(cb); ch.appendChild(el('span', 'trilho')); var rot = el('span', null, cb.checked ? 'Disponível' : 'Indisponível'); ch.appendChild(rot);
    cb.addEventListener('change', function(){ var v = cb.checked; rot.textContent = v ? 'Disponível' : 'Indisponível'; escrever('s' + x.id, function(){ return api('PATCH', '/api/admin/salas/' + x.id, {disponivel: v}); }).then(function(ok){ if(ok) toast(nomeSala(x.id) + (v ? ' agora está disponível no site.' : ' ficou indisponível no site.')); else { cb.checked = !v; rot.textContent = !v ? 'Disponível' : 'Indisponível'; } }); });
    cab.appendChild(ch); corpo.appendChild(cab);
    var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
    var iNome = entrada('n-' + x.id, 'text', x.nome || ''), iTipo = entrada('t-' + x.id, 'text', x.tipo || '', {placeholder:'Ex.: Psicologia'});
    var iDesc = el('textarea'); iDesc.id = 'd-' + x.id; iDesc.rows = 2; iDesc.placeholder = 'Como a sala é equipada'; iDesc.value = x.descricao || '';
    cs.appendChild(campo('Nome', iNome)); cs.appendChild(campo('Tipo de sala', iTipo));
    cs.appendChild(campo('Descrição', iDesc, 'largo'));
    f.appendChild(cs);
    var tabela = tabelaPrecos(x);
    f.appendChild(tabela.el);
    var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); rod.appendChild(msg); var salvo = el('span', 'salvo'); salvo.setAttribute('role', 'status'); rod.appendChild(salvo);
    var bt = el('button', 'btn', 'Salvar sala'); bt.type = 'submit'; rod.appendChild(bt); f.appendChild(rod);
    f.addEventListener('submit', function(e){
      e.preventDefault(); msg.textContent = ''; salvo.textContent = '';
      if(!iNome.value.trim()){ msg.textContent = 'A sala precisa de um nome.'; return; }
      var precos = tabela.ler(); if(typeof precos === 'string'){ msg.textContent = precos; return; }
      bt.disabled = true;
      escrever('s' + x.id, function(){ return api('PATCH', '/api/admin/salas/' + x.id, {nome: iNome.value.trim(), tipo: iTipo.value.trim(), precos: precos, descricao: iDesc.value.trim()}); }).then(function(ok){ bt.disabled = false; if(ok) toast(nomeSala(x.id) + ': dados e preços salvos.'); });
    });
    corpo.appendChild(f); art.appendChild(corpo);
    return art;
  }

  /* Profissionais: o que aparece na página Profissionais e na galeria do início */
  function telaProfissionais(s){
    var b = bloco('Profissionais', 'A ordem daqui é a ordem do site. Quem está escondido não aparece para as pessoas');
    var novo = el('button', 'btn', 'Novo profissional'); novo.type = 'button'; novo.addEventListener('click', function(){ formProfissional(null); });
    b.querySelector('.bloco-cab').appendChild(novo);
    var lista = st.profissionais || [];
    if(!lista.length) b.appendChild(vazio('Nenhum profissional ainda', 'Use "Novo profissional" para cadastrar nome, especialidade e foto.'));
    lista.forEach(function(x, i){ b.appendChild(cartaoProfissional(x, i, lista.length)); });
    s.appendChild(b);
  }
  function botaoFoto(id, temFoto, rota, nome){
    var inp = el('input'); inp.type = 'file'; inp.accept = 'image/png,image/jpeg,image/webp'; inp.id = id;
    var lab = el('label'); lab.htmlFor = id; lab.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h4l2-2h4l2 2h4v12H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/></svg>'; lab.appendChild(d.createTextNode(temFoto ? 'Trocar foto' : 'Enviar foto'));
    inp.addEventListener('change', function(){
      var file = inp.files && inp.files[0]; if(!file) return;
      enviarFoto(file, rota, function(t){ lab.lastChild.nodeValue = t; }, temFoto).then(function(ok){ if(ok) toast('Foto de ' + nome + ' atualizada.'); });
    });
    return [inp, lab];
  }
  /* Reduz a foto no navegador e envia. Devolve true se deu certo */
  function enviarFoto(file, rota, rotulo, temFoto){
    var volta = function(){ rotulo(temFoto ? 'Trocar foto' : 'Enviar foto'); };
    if(!/^image\/(jpeg|png|webp)$/.test(file.type)){ toast('Use uma foto em JPG, PNG ou WebP.', true); return Promise.resolve(false); }
    if(file.size > 25 * 1024 * 1024){ toast('A foto é grande demais. Use uma de até 25 MB.', true); return Promise.resolve(false); }
    rotulo('Enviando…');
    return reduzirFoto(file).then(function(dataUrl){
      return escrever('foto-' + rota, function(){ return api('POST', rota, {imagem: dataUrl}); }).then(function(ok){ if(!ok) volta(); return ok; });
    }, function(){ volta(); toast('Não foi possível ler essa foto. Tente outra.', true); return false; });
  }
  function cartaoProfissional(x, i, total){
    var art = el('article', 'sala prof' + (x.ativo ? '' : ' off'));
    var foto = el('div', 'foto');
    if(x.foto){ var im = el('img'); im.src = x.foto; im.alt = 'Foto de ' + x.nome; im.onerror = function(){ im.remove(); }; foto.appendChild(im); }
    botaoFoto('pfoto-' + x.id, !!x.foto, '/api/admin/profissionais/' + x.id + '/foto', x.nome).forEach(function(e){ foto.appendChild(e); });
    art.appendChild(foto);
    var corpo = el('div');
    var cab = el('div', 'sala-cab'); cab.appendChild(el('h3', null, x.nome));
    var ch = el('label', 'chave'); var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!x.ativo; cb.id = 'pativo-' + x.id;
    ch.appendChild(cb); ch.appendChild(el('span', 'trilho')); var rot = el('span', null, cb.checked ? 'Aparece no site' : 'Escondido'); ch.appendChild(rot);
    cb.addEventListener('change', function(){ var v = cb.checked; rot.textContent = v ? 'Aparece no site' : 'Escondido'; escrever('p' + x.id, function(){ return api('PATCH', '/api/admin/profissionais/' + x.id, {ativo: v}); }).then(function(ok){ if(ok) toast(x.nome + (v ? ' agora aparece no site.' : ' não aparece mais no site.')); else { cb.checked = !v; rot.textContent = !v ? 'Aparece no site' : 'Escondido'; } }); });
    cab.appendChild(ch); corpo.appendChild(cab);
    if(x.especialidade) corpo.appendChild(el('p', 'prof-esp', x.especialidade));
    var info = el('div', 'regras');
    info.appendChild(el('span', null, x.registro ? 'Registro: ' + x.registro : 'Sem registro do conselho'));
    info.appendChild(el('span', null, x.whatsapp ? 'WhatsApp: ' + formatarTel(x.whatsapp) : 'Botão leva para o contato da Casa'));
    if(!x.foto) info.appendChild(el('span', null, 'Sem foto'));
    corpo.appendChild(info);
    var ac = el('div', 'acoes prof-acoes');
    var ed = el('button', 'btn', 'Editar'); ed.type = 'button'; ed.addEventListener('click', function(){ formProfissional(x); }); ac.appendChild(ed);
    [['cima', 'Subir', i === 0], ['baixo', 'Descer', i === total - 1]].forEach(function(m){
      var bt = el('button', 'btn-borda', m[1]); bt.type = 'button'; bt.disabled = m[2];
      bt.addEventListener('click', function(){ escrever('ordem-prof', function(){ return api('POST', '/api/admin/profissionais/' + x.id + '/mover', {para: m[0]}); }); });
      ac.appendChild(bt);
    });
    var rm = el('button', 'btn-texto perigo', 'Remover'); rm.type = 'button';
    rm.addEventListener('click', function(){
      if(!rm.dataset.ok){ rm.dataset.ok = '1'; rm.textContent = 'Toque de novo para remover'; setTimeout(function(){ if(rm.isConnected){ delete rm.dataset.ok; rm.textContent = 'Remover'; } }, 5000); return; }
      escrever('p' + x.id, function(){ return api('DELETE', '/api/admin/profissionais/' + x.id); }).then(function(ok){ if(ok) toast(x.nome + ' foi removido(a) do site.'); });
    });
    ac.appendChild(rm);
    corpo.appendChild(ac);
    art.appendChild(corpo);
    return art;
  }
  function formProfissional(x){
    abrirJanela(x ? 'Editar profissional' : 'Novo profissional', function(j, fechar){
      var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
      cs.appendChild(campo('Nome', entrada('pro-nome', 'text', x ? x.nome : '', {autocomplete:'off'})));
      cs.appendChild(campo('Especialidade', entrada('pro-esp', 'text', x ? x.especialidade : '', {placeholder:'Ex.: Psicóloga Clínica'})));
      cs.appendChild(campo('Registro no conselho (opcional)', entrada('pro-reg', 'text', x ? x.registro : '', {placeholder:'Ex.: CRP 06/123456'})));
      cs.appendChild(campo('WhatsApp (opcional)', entrada('pro-tel', 'tel', x && x.whatsapp ? formatarTel(x.whatsapp) : '', {inputmode:'tel', placeholder:'(19) 99999-9999'}), null, 'Em branco, o botão do site leva para o contato da Casa.'));
      cs.appendChild(campo('Crédito da foto (opcional)', entrada('pro-cred', 'text', x ? x.credito : '', {placeholder:'Ex.: Foto: Nome do fotógrafo'})));
      var arq = entrada('pro-foto', 'file', null, {accept:'image/png,image/jpeg,image/webp'});
      cs.appendChild(campo(x && x.foto ? 'Trocar foto (opcional)' : 'Foto', arq, 'largo', 'Foto em pé (retrato) fica melhor. JPG, PNG ou WebP.'));
      f.appendChild(cs);
      var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
      var cancelar = el('button', 'btn-borda', 'Cancelar'); cancelar.type = 'button'; cancelar.addEventListener('click', fechar); rod.appendChild(cancelar);
      var salvar = el('button', 'btn', x ? 'Salvar' : 'Cadastrar profissional'); salvar.type = 'submit'; rod.appendChild(salvar); f.appendChild(rod);
      f.addEventListener('submit', function(e){
        e.preventDefault(); msg.textContent = '';
        var dados = { nome: $('pro-nome').value.trim(), especialidade: $('pro-esp').value.trim(), registro: $('pro-reg').value.trim(), whatsapp: $('pro-tel').value.trim(), credito: $('pro-cred').value.trim() };
        if(dados.nome.length < 2){ msg.textContent = 'Digite o nome.'; return; }
        var dig = dados.whatsapp.replace(/\D/g, ''); if(dig && (dig.length < 10 || dig.length > 13)){ msg.textContent = 'Digite o WhatsApp com DDD, como (19) 99999-9999, ou deixe em branco.'; return; }
        var file = arq.files && arq.files[0];
        salvar.disabled = true; salvar.textContent = 'Salvando…';
        var pedido = x ? api('PATCH', '/api/admin/profissionais/' + x.id, dados).then(function(){ return x.id; })
                       : api('POST', '/api/admin/profissionais', dados).then(function(r){ return r.id; });
        pedido.then(function(id){
          if(!file) return true;
          salvar.textContent = 'Enviando a foto…';
          return enviarFoto(file, '/api/admin/profissionais/' + id + '/foto', function(){}, !!(x && x.foto));
        }).then(function(fotoOk){
          return recarregar().then(function(){
            fechar();
            toast(fotoOk === false ? 'Dados salvos, mas a foto não foi enviada. Tente de novo em "Enviar foto".' : (x ? 'Profissional atualizado.' : dados.nome + ' agora aparece na página Profissionais.'), fotoOk === false);
          });
        }, function(err){ salvar.disabled = false; salvar.textContent = x ? 'Salvar' : 'Cadastrar profissional'; msg.textContent = err.message || 'Não foi possível salvar agora.'; });
      });
      j.appendChild(f);
    });
  }

  /* Tabela de preços da sala: cada linha é "quantidade de horas → valor" */
  function tabelaPrecos(x){
    var caixa = el('fieldset', 'precos');
    var leg = el('legend', null, 'Preços do aluguel'); caixa.appendChild(leg);
    caixa.appendChild(el('p', 'ajuda', 'Coloque quanto custa cada quantidade de horas. Ex.: 1 hora R$ 50, 4 horas R$ 180. Para um total que não está na lista, o site soma a combinação mais barata.'));
    var linhas = el('div', 'precos-linhas'); caixa.appendChild(linhas);
    var exemplo = el('p', 'precos-ex'); exemplo.setAttribute('aria-live', 'polite');
    var n = 0;
    function linha(horas, valor){
      n++;
      var l = el('div', 'preco-linha');
      var ih = entrada('ph-' + x.id + '-' + n, 'number', horas != null ? horas : '', {min:'1', max:'24', step:'1', inputmode:'numeric', 'aria-label':'Quantidade de horas'});
      var iv = entrada('pv-' + x.id + '-' + n, 'text', valor != null ? emReais(valor) : '', {inputmode:'decimal', placeholder:'0,00', 'aria-label':'Valor'});
      var ch = el('div', 'campo'); ch.appendChild(el('span', 'rot', 'Horas')); ch.appendChild(ih);
      var pv = el('div', 'prefixo'); pv.appendChild(el('span', null, 'R$')); pv.appendChild(iv);
      var cv = el('div', 'campo'); cv.appendChild(el('span', 'rot', 'Valor')); cv.appendChild(pv);
      var x2 = el('button', 'btn-texto perigo', 'Tirar'); x2.type = 'button'; x2.setAttribute('aria-label', 'Tirar esta linha');
      x2.addEventListener('click', function(){ l.remove(); atualizarEx(); });
      [ih, iv].forEach(function(i){ i.addEventListener('input', atualizarEx); });
      l.appendChild(ch); l.appendChild(cv); l.appendChild(x2); linhas.appendChild(l);
    }
    (x.precos || []).forEach(function(p){ linha(p.horas, p.valor); });
    if(!(x.precos || []).length) linha(1, null);
    var add = el('button', 'btn-borda', 'Adicionar quantidade de horas'); add.type = 'button';
    add.addEventListener('click', function(){ linha(null, null); linhas.lastChild.querySelector('input').focus(); });
    caixa.appendChild(add); caixa.appendChild(exemplo);
    function ler(){
      var out = [], vistas = {};
      var ls = linhas.querySelectorAll('.preco-linha');
      for(var i = 0; i < ls.length; i++){
        var ins = ls[i].querySelectorAll('input'), h = ins[0].value.trim(), v = numero(ins[1].value);
        if(h === '' && v === null) continue;
        h = Number(h);
        if(!(h >= 1 && h <= 24 && Math.floor(h) === h)) return 'A quantidade de horas vai de 1 a 24.';
        if(v === null || isNaN(v) || v < 0) return 'Digite o valor de ' + h + 'h só com números, como 50,00.';
        if(vistas[h]) return 'A quantidade de ' + h + 'h está repetida.';
        vistas[h] = 1; out.push({horas: h, valor: v});
      }
      return out.sort(function(a, b){ return a.horas - b.horas; });
    }
    function atualizarEx(){
      var p = ler(); if(typeof p === 'string' || !p.length){ exemplo.textContent = ''; return; }
      var ex = [1, 2, 4, 6, 8].map(function(h){ var v = calcularValor(p, h); return v != null ? h + 'h ' + brl(v) : null; }).filter(Boolean);
      exemplo.textContent = ex.length ? 'No site: ' + ex.join(' · ') : '';
    }
    atualizarEx();
    return { el: caixa, ler: ler };
  }

  /* ===== Parceiros: não pagam aluguel, repassam uma porcentagem do procedimento ===== */
  function parceiroPorId(id){ return st.parceiros.filter(function(p){ return p.id === id; })[0]; }
  function pctTxt(v){ return String(v).replace('.', ',') + '%'; }
  function aReceber(){ return st.atendimentos.filter(function(a){ return a.status === 'pendente'; }).reduce(function(t, a){ return t + a.repasse; }, 0); }
  var fmtMes = new Intl.DateTimeFormat('pt-BR', {month:'long', year:'numeric'});
  function nomeMes(m){ return cap(fmtMes.format(deChave(m + '-01'))); }
  var CONTA = {
    verificada: ['ok', 'Conta verificada pelo e-mail'],
    conferida: ['ok', 'Conta conferida pela equipe'],
    nao_verificada: ['pre', 'Conta sem verificação: a condição de parceiro ainda não vale'],
    sem_conta: ['exp', 'Ainda não criou conta no site']
  };
  function telaParceiros(s){
    var mesAtual = HOJE.slice(0, 7);
    var nums = el('div', 'numeros');
    var doMes = st.atendimentos.filter(function(a){ return a.data.slice(0, 7) === mesAtual; });
    [[brl(aReceber()), 'A receber (pendente)', true],
     [brl(doMes.reduce(function(t, a){ return t + a.repasse; }, 0)), 'Repasse de ' + nomeMes(mesAtual).toLowerCase(), false],
     [doMes.reduce(function(t, a){ return t + a.quantidade; }, 0), 'Atendimentos lançados no mês', false],
     [st.parceiros.filter(function(p){ return p.ativo; }).length, 'Parceiros ativos', false]].forEach(function(n){
      var b = el('div', 'numero' + (n[2] ? ' destaque' : '')); b.appendChild(el('strong', null, n[0])); b.appendChild(el('span', null, n[1])); nums.appendChild(b);
    });
    s.appendChild(nums);

    var b = bloco('Parceiros', 'Não pagam aluguel: repassam uma porcentagem de cada procedimento feito na sala');
    var novo = el('button', 'btn', 'Novo parceiro'); novo.type = 'button'; novo.addEventListener('click', function(){ formParceiro(null); });
    b.querySelector('.bloco-cab').appendChild(novo);
    if(!st.parceiros.length) b.appendChild(vazio('Nenhum parceiro ainda', 'Cadastre o nome, o e-mail da conta da pessoa no site e a porcentagem do procedimento. A condição vale quando ela reservar com a conta desse e-mail.'));
    var ul = el('ul', 'lista');
    st.parceiros.forEach(function(p){
      var li = el('li', 'parc' + (p.ativo ? '' : ' off'));
      var meio = el('div');
      meio.appendChild(el('div', 'sala-nome', p.nome));
      meio.appendChild(el('div', 'pessoa', p.email));
      var regras = el('div', 'regras');
      regras.appendChild(el('span', null, pctTxt(p.pctAtendimento) + ' do procedimento para a Casa'));
      regras.appendChild(el('span', null, 'Sem aluguel'));
      meio.appendChild(regras);
      var cc = CONTA[p.conta] || CONTA.sem_conta; meio.appendChild(el('span', 'chip ' + cc[0], p.ativo ? cc[1] : 'Parceria desativada'));
      if(p.observacao) meio.appendChild(el('p', 'obs', p.observacao));
      var pend = st.atendimentos.filter(function(a){ return a.parceiroId === p.id && a.status === 'pendente'; }).reduce(function(t, a){ return t + a.repasse; }, 0);
      if(pend) meio.appendChild(el('p', 'pendente', 'A receber: ' + brl(pend)));
      li.appendChild(meio);
      var ac = el('div', 'acoes');
      if(p.ativo){ var la = el('button', 'btn', 'Lançar atendimentos'); la.type = 'button'; la.addEventListener('click', function(){ formAtendimento(null, p.id); }); ac.appendChild(la); }
      if(p.ativo && p.conta === 'nao_verificada'){
        var cf = el('button', 'btn-borda', 'É ela mesma: liberar parceria'); cf.type = 'button';
        cf.title = 'Use depois de confirmar com a pessoa que a conta com este e-mail é dela';
        cf.addEventListener('click', function(){ escrever('p' + p.id, function(){ return api('PATCH', '/api/admin/parceiros/' + p.id, {conferirConta: true}); }).then(function(ok){ if(ok) toast('Conta de ' + p.nome + ' conferida. A condição de parceiro já vale no site.'); }); });
        ac.appendChild(cf);
      }
      var ed = el('button', 'btn-texto', 'Editar'); ed.type = 'button'; ed.addEventListener('click', function(){ formParceiro(p); }); ac.appendChild(ed);
      var at = el('button', 'btn-texto', p.ativo ? 'Desativar' : 'Ativar'); at.type = 'button';
      at.addEventListener('click', function(){ escrever('p' + p.id, function(){ return api('PATCH', '/api/admin/parceiros/' + p.id, {ativo: !p.ativo}); }).then(function(ok){ if(ok) toast(p.ativo ? 'Parceria de ' + p.nome + ' desativada. Ela volta a pagar o preço normal.' : 'Parceria de ' + p.nome + ' ativada.'); }); });
      ac.appendChild(at);
      if(!st.atendimentos.some(function(a){ return a.parceiroId === p.id; })){
        var rm = el('button', 'btn-texto perigo', 'Apagar'); rm.type = 'button';
        rm.addEventListener('click', function(){
          if(!rm.dataset.ok){ rm.dataset.ok = '1'; rm.textContent = 'Confirmar'; setTimeout(function(){ if(rm.isConnected){ delete rm.dataset.ok; rm.textContent = 'Apagar'; } }, 5000); return; }
          escrever('p' + p.id, function(){ return api('DELETE', '/api/admin/parceiros/' + p.id); }).then(function(ok){ if(ok) toast('Parceiro apagado.'); });
        });
        ac.appendChild(rm);
      }
      li.appendChild(ac); ul.appendChild(li);
    });
    if(st.parceiros.length) b.appendChild(ul);
    s.appendChild(b);

    /* Lançamentos */
    var b2 = bloco('Atendimentos e repasses', 'O valor do repasse é calculado sozinho pela porcentagem do parceiro');
    if(st.parceiros.some(function(p){ return p.ativo; })){ var la2 = el('button', 'btn-borda', 'Lançar atendimentos'); la2.type = 'button'; la2.addEventListener('click', function(){ formAtendimento(null, ''); }); b2.querySelector('.bloco-cab').appendChild(la2); }
    var meses = []; st.atendimentos.forEach(function(a){ var m = a.data.slice(0, 7); if(meses.indexOf(m) < 0) meses.push(m); });
    if(meses.indexOf(mesAtual) < 0) meses.unshift(mesAtual);
    meses.sort().reverse();
    var f = el('div', 'filtros');
    var cm = el('div', 'campo'); var lm = el('label', null, 'Mês'); lm.htmlFor = 'filtro-mes';
    var sm = seletor('filtro-mes', [['', 'Todos os pendentes']].concat(meses.map(function(m){ return [m, nomeMes(m)]; })), st.filtroMes);
    sm.addEventListener('change', function(){ st.filtroMes = sm.value; desenhar(); }); cm.appendChild(lm); cm.appendChild(sm); f.appendChild(cm);
    var cp = el('div', 'campo'); var lp = el('label', null, 'Parceiro'); lp.htmlFor = 'filtro-parc';
    var sp = seletor('filtro-parc', [['', 'Todos']].concat(st.parceiros.map(function(p){ return [p.id, p.nome]; })), st.filtroParc);
    sp.addEventListener('change', function(){ st.filtroParc = sp.value; desenhar(); }); cp.appendChild(lp); cp.appendChild(sp); f.appendChild(cp);
    b2.appendChild(f);
    var lista = st.atendimentos.filter(function(a){
      if(st.filtroParc && a.parceiroId !== st.filtroParc) return false;
      return st.filtroMes ? a.data.slice(0, 7) === st.filtroMes : a.status === 'pendente';
    });
    if(lista.length){
      var tot = lista.reduce(function(t, a){ t.q += a.quantidade; t.v += a.valorTotal; t.r += a.repasse; if(a.status === 'pendente') t.p += a.repasse; return t; }, {q:0, v:0, r:0, p:0});
      b2.appendChild(el('p', 'totais', tot.q + ' atendimentos · ' + brl(tot.v) + ' atendidos · repasse ' + brl(tot.r) + (tot.p ? ' · falta receber ' + brl(tot.p) : ' · tudo recebido')));
      var ul2 = el('ul', 'lista');
      lista.forEach(function(a){
        var p = parceiroPorId(a.parceiroId) || {nome: 'Parceiro removido'};
        var li = el('li', 'res at');
        var q = el('div', 'quando'); q.appendChild(el('strong', null, diaCurto(a.data))); q.appendChild(el('span', null, a.quantidade + (a.quantidade === 1 ? ' atendimento' : ' atendimentos'))); li.appendChild(q);
        var meio = el('div'); meio.appendChild(el('div', 'sala-nome', p.nome));
        meio.appendChild(el('div', 'pessoa', brl(a.valorTotal) + ' em atendimentos × ' + pctTxt(a.pct) + ' = repasse de ' + brl(a.repasse)));
        if(a.observacao) meio.appendChild(el('p', 'obs', a.observacao));
        meio.appendChild(el('span', 'chip ' + (a.status === 'recebido' ? 'ok' : 'pre'), a.status === 'recebido' ? 'Recebido' : 'A receber'));
        li.appendChild(meio);
        var ac = el('div', 'acoes');
        var tg = el('button', a.status === 'recebido' ? 'btn-texto' : 'btn', a.status === 'recebido' ? 'Voltar para a receber' : 'Marcar recebido'); tg.type = 'button';
        tg.addEventListener('click', function(){ tg.disabled = true; escrever('a' + a.id, function(){ return api('PATCH', '/api/admin/atendimentos/' + a.id, {status: a.status === 'recebido' ? 'pendente' : 'recebido'}); }).then(function(ok){ if(ok) toast(a.status === 'recebido' ? 'Voltou para a receber.' : 'Repasse de ' + brl(a.repasse) + ' marcado como recebido.'); else tg.disabled = false; }); });
        ac.appendChild(tg);
        var ed = el('button', 'btn-texto', 'Editar'); ed.type = 'button'; ed.addEventListener('click', function(){ formAtendimento(a, a.parceiroId); }); ac.appendChild(ed);
        var rm = el('button', 'btn-texto perigo', 'Apagar'); rm.type = 'button';
        rm.addEventListener('click', function(){
          if(!rm.dataset.ok){ rm.dataset.ok = '1'; rm.textContent = 'Confirmar'; setTimeout(function(){ if(rm.isConnected){ delete rm.dataset.ok; rm.textContent = 'Apagar'; } }, 5000); return; }
          escrever('a' + a.id, function(){ return api('DELETE', '/api/admin/atendimentos/' + a.id); }).then(function(ok){ if(ok) toast('Lançamento apagado.'); });
        });
        ac.appendChild(rm); li.appendChild(ac); ul2.appendChild(li);
      });
      b2.appendChild(ul2);
    } else {
      b2.appendChild(vazio(st.filtroMes ? 'Nada lançado nesse mês' : 'Nenhum repasse pendente', 'Depois que o parceiro usar a sala, lance quantos atendimentos fez e quanto cobrou. O sistema calcula a parte da Casa.'));
    }
    s.appendChild(b2);
  }

  function formParceiro(p){
    abrirJanela(p ? 'Editar parceiro' : 'Novo parceiro', function(j, fechar){
      var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
      cs.appendChild(campo('Nome', entrada('pa-nome', 'text', p ? p.nome : '', {autocomplete:'off'})));
      cs.appendChild(campo('E-mail da conta no site', entrada('pa-email', 'email', p ? p.email : '', {autocomplete:'off', inputmode:'email'}), null, 'A condição de parceiro vale quando ela reservar com a conta deste e-mail.'));
      var d2 = entrada('pa-pct', 'text', p ? emReais(p.pctAtendimento) : '', {inputmode:'decimal', placeholder:'Ex.: 30'});
      cs.appendChild(campo('Porcentagem do procedimento (%)', d2, null, 'O site mostra para ela só isto, por exemplo "30% do procedimento". Ela não paga aluguel.'));
      var ob = el('textarea'); ob.id = 'pa-obs'; ob.rows = 2; ob.placeholder = 'Ex.: Fisioterapeuta, paga até o dia 5'; ob.value = p ? p.observacao : '';
      cs.appendChild(campo('Observação (só a equipe vê)', ob, 'largo'));
      f.appendChild(cs);
      var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
      var cancelar = el('button', 'btn-borda', 'Cancelar'); cancelar.type = 'button'; cancelar.addEventListener('click', fechar); rod.appendChild(cancelar);
      var salvar = el('button', 'btn', p ? 'Salvar' : 'Cadastrar parceiro'); salvar.type = 'submit'; rod.appendChild(salvar); f.appendChild(rod);
      f.addEventListener('submit', function(e){
        e.preventDefault(); msg.textContent = '';
        var dados = { nome: $('pa-nome').value.trim(), email: $('pa-email').value.trim(), pctAtendimento: numero(d2.value), observacao: ob.value.trim() };
        if(dados.nome.length < 2){ msg.textContent = 'Digite o nome.'; return; }
        if(!/\S+@\S+\.\S+/.test(dados.email)){ msg.textContent = 'Digite o e-mail da conta da pessoa.'; return; }
        if(dados.pctAtendimento === null){ msg.textContent = 'Digite a porcentagem do procedimento.'; return; }
        if(isNaN(dados.pctAtendimento) || dados.pctAtendimento <= 0 || dados.pctAtendimento > 100){ msg.textContent = 'A porcentagem vai de 1 a 100.'; return; }
        salvar.disabled = true;
        escrever('form-parceiro', function(){ return p ? api('PATCH', '/api/admin/parceiros/' + p.id, dados) : api('POST', '/api/admin/parceiros', dados); }).then(function(ok){
          salvar.disabled = false; if(ok){ fechar(); toast(p ? 'Parceiro atualizado.' : dados.nome + ' agora é parceiro da Casa.'); }
        });
      });
      j.appendChild(f);
    });
  }

  function formAtendimento(a, parceiroId){
    abrirJanela(a ? 'Editar lançamento' : 'Lançar atendimentos', function(j, fechar){
      var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
      var ops = st.parceiros.filter(function(p){ return p.ativo || p.id === parceiroId; }).map(function(p){ return [p.id, p.nome]; });
      var sp = seletor('at-parc', ops, parceiroId || (ops[0] && ops[0][0]));
      cs.appendChild(campo('Parceiro', sp, 'largo'));
      cs.appendChild(campo('Dia', entrada('at-dia', 'date', a ? a.data : HOJE, {max: HOJE})));
      var iq = entrada('at-qtd', 'number', a ? a.quantidade : '', {min:'1', max:'500', step:'1', inputmode:'numeric', placeholder:'Ex.: 5'});
      cs.appendChild(campo('Quantos atendimentos', iq));
      var iv = entrada('at-valor', 'text', a ? emReais(a.valorTotal) : '', {inputmode:'decimal', placeholder:'0,00'});
      var pv = el('div', 'prefixo'); pv.appendChild(el('span', null, 'R$')); pv.appendChild(iv);
      var cv = el('div', 'campo'); var lv = el('label', null, 'Valor total cobrado'); lv.htmlFor = 'at-valor'; cv.appendChild(lv); cv.appendChild(pv); cv.appendChild(el('span', 'ajuda', 'Soma do que o parceiro cobrou nesses atendimentos'));
      cs.appendChild(cv);
      var ip = entrada('at-pct', 'text', a ? emReais(a.pct) : '', {inputmode:'decimal'});
      cs.appendChild(campo('Porcentagem para a Casa (%)', ip));
      var ob = el('textarea'); ob.id = 'at-obs'; ob.rows = 2; ob.value = a ? a.observacao : ''; ob.placeholder = 'Opcional';
      cs.appendChild(campo('Observação', ob, 'largo'));
      f.appendChild(cs);
      var calc = el('p', 'calculo'); calc.setAttribute('aria-live', 'polite'); f.appendChild(calc);
      function pctPadrao(){ var p = parceiroPorId(sp.value); return p ? p.pctAtendimento : 0; }
      if(!a) ip.value = emReais(pctPadrao());
      sp.addEventListener('change', function(){ if(!a) ip.value = emReais(pctPadrao()); conta(); });
      function conta(){
        var v = numero(iv.value), pc = numero(ip.value);
        calc.textContent = (v != null && !isNaN(v) && pc != null && !isNaN(pc)) ? 'Repasse para a Casa: ' + brl(Math.round(v * pc) / 100) : '';
      }
      [iv, ip].forEach(function(i){ i.addEventListener('input', conta); }); conta();
      var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
      var cancelar = el('button', 'btn-borda', 'Cancelar'); cancelar.type = 'button'; cancelar.addEventListener('click', fechar); rod.appendChild(cancelar);
      var salvar = el('button', 'btn', a ? 'Salvar' : 'Lançar'); salvar.type = 'submit'; rod.appendChild(salvar); f.appendChild(rod);
      f.addEventListener('submit', function(e){
        e.preventDefault(); msg.textContent = '';
        var dados = { parceiro: sp.value, data: $('at-dia').value, quantidade: Number(iq.value), valorTotal: numero(iv.value), pct: numero(ip.value), observacao: ob.value.trim() };
        if(!dados.parceiro){ msg.textContent = 'Escolha o parceiro.'; return; }
        if(!dados.data || dados.data > HOJE){ msg.textContent = 'Escolha o dia do atendimento (hoje ou antes).'; return; }
        if(!(dados.quantidade >= 1 && Math.floor(dados.quantidade) === dados.quantidade)){ msg.textContent = 'Digite quantos atendimentos foram feitos.'; return; }
        if(dados.valorTotal === null || isNaN(dados.valorTotal) || dados.valorTotal < 0){ msg.textContent = 'Digite o valor total, como 600,00.'; return; }
        if(dados.pct === null || isNaN(dados.pct) || dados.pct < 0 || dados.pct > 100){ msg.textContent = 'A porcentagem vai de 0 a 100.'; return; }
        salvar.disabled = true;
        escrever('form-atendimento', function(){ return a ? api('PATCH', '/api/admin/atendimentos/' + a.id, dados) : api('POST', '/api/admin/atendimentos', dados); }).then(function(ok){
          salvar.disabled = false; if(ok){ fechar(); toast((a ? 'Lançamento atualizado. ' : 'Atendimentos lançados. ') + 'Repasse: ' + brl(Math.round(dados.valorTotal * dados.pct) / 100) + '.'); }
        });
      });
      j.appendChild(f);
    });
  }

  /* Horários fixos */
  function descreverFixo(f){
    var rep = f.repete === 'semanal' ? 'Toda ' + DIAS_SEM[+f.diaSemana].toLowerCase() : (f.repete === 'aCadaDias' ? 'A cada ' + (f.aCadaDias || 15) + ' dias' : (f.repete === 'unico' ? 'Só em ' + diaCurto(f.desde) : ''));
    if(f.repete === 'semanal' && (+f.diaSemana === 0 || +f.diaSemana === 6)) rep = 'Todo ' + DIAS_SEM[+f.diaSemana].toLowerCase();
    var horas = (f.de === (st.geral ? st.geral.abre : 7) && f.ate === (st.geral ? st.geral.fecha : 20)) ? 'Dia inteiro' : f.de + 'h às ' + f.ate + 'h';
    var desde = f.repete === 'unico' ? '' : (f.desde && f.desde > HOJE ? 'A partir de ' + diaCurto(f.desde) : (f.repete === 'aCadaDias' ? 'Contando de ' + diaCurto(f.desde) : 'Em vigor'));
    return [rep, horas, desde];
  }
  function telaFixos(s){
    var b = bloco('Horários já reservados', 'Ninguém consegue reservar por cima destes horários');
    var nova = el('button', 'btn', 'Novo horário fixo'); nova.type = 'button'; nova.addEventListener('click', formFixo); b.querySelector('.bloco-cab').appendChild(nova);
    var lista = st.fixos.slice().sort(function(a, b){ return nomeSala(a.sala).localeCompare(nomeSala(b.sala)); });
    if(!lista.length) b.appendChild(vazio('Nenhum horário fixo', 'Use "Novo horário fixo" para travar um horário que se repete.'));
    lista.forEach(function(f){
      var li = el('div', 'fixo-linha'); var t = descreverFixo(f);
      li.appendChild(el('div', 'sala-nome', nomeSala(f.sala)));
      var a = el('div', null, t[0]); li.appendChild(a);
      var c = el('div', null, t[1]); if(t[2]) c.appendChild(el('small', null, t[2])); li.appendChild(c);
      var x = el('button', 'btn-texto perigo', 'Remover'); x.type = 'button';
      x.addEventListener('click', function(){
        if(!x.dataset.ok){ x.dataset.ok = '1'; x.textContent = 'Confirmar remoção'; setTimeout(function(){ if(x.isConnected){ delete x.dataset.ok; x.textContent = 'Remover'; } }, 5000); return; }
        escrever('f' + f.id, function(){ return api('DELETE', '/api/admin/fixos/' + f.id); }).then(function(ok){ if(ok) toast('Horário fixo removido.'); });
      });
      li.appendChild(x); b.appendChild(li);
    });
    s.appendChild(b);
  }
  function formFixo(){
    abrirJanela('Novo horário fixo', function(j, fechar){
      var f = el('form'); f.noValidate = true; var cs = el('div', 'campos'); var hs = horasAbertas();
      cs.appendChild(campo('Sala', seletor('fx-sala', salasOrdenadas().map(function(x){ return [x.id, nomeSala(x.id)]; }), ''), 'largo'));
      var rep = seletor('fx-rep', [['semanal', 'Toda semana'], ['aCadaDias', 'A cada 15 dias'], ['unico', 'Só uma vez']], 'semanal');
      cs.appendChild(campo('Repetição', rep));
      var dia = seletor('fx-dia', DIAS_SEM.map(function(n, i){ return [i, n]; }), 2); var cDia = campo('Dia da semana', dia); cs.appendChild(cDia);
      cs.appendChild(campo('Das', seletor('fx-de', hs.slice(0, -1).map(function(h){ return [h, pad(h) + 'h']; }), 14)));
      cs.appendChild(campo('Até', seletor('fx-ate', hs.slice(1).map(function(h){ return [h, pad(h) + 'h']; }), 19)));
      var desde = entrada('fx-desde', 'date', HOJE); var cDesde = campo('A partir de', desde); cs.appendChild(cDesde);
      function ajustar(){ var v = rep.value; cDia.hidden = v !== 'semanal'; cDesde.querySelector('label').textContent = v === 'unico' ? 'Dia' : (v === 'aCadaDias' ? 'Primeiro dia' : 'A partir de'); }
      rep.addEventListener('change', ajustar); ajustar();
      f.appendChild(cs);
      var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
      var c = el('button', 'btn-borda', 'Cancelar'); c.type = 'button'; c.addEventListener('click', fechar); rod.appendChild(c);
      var sv = el('button', 'btn', 'Adicionar'); sv.type = 'submit'; rod.appendChild(sv); f.appendChild(rod);
      f.addEventListener('submit', function(e){
        e.preventDefault();
        var de = +$('fx-de').value, ate = +$('fx-ate').value;
        if(ate <= de){ msg.textContent = 'O horário final precisa ser depois do inicial.'; return; }
        if(!$('fx-sala').value){ msg.textContent = 'Escolha a sala.'; return; }
        var dados = { sala: $('fx-sala').value, repete: rep.value, de: de, ate: ate, desde: desde.value || HOJE };
        if(rep.value === 'semanal') dados.diaSemana = +dia.value;
        if(rep.value === 'aCadaDias') dados.aCadaDias = 15;
        sv.disabled = true;
        escrever('novo-fixo', function(){ return api('POST', '/api/admin/fixos', dados); }).then(function(ok){ sv.disabled = false; if(ok){ fechar(); toast('Horário fixo adicionado.'); } });
      });
      j.appendChild(f);
    });
  }

  /* ===== Segurança ===== */
  var ROT_ACESSO = { entrou: ['ok', 'Entrou'], senha_errada: ['erro', 'Senha errada'], codigo_errado: ['erro', 'Código errado'], saiu_de_todos: ['ok', 'Saiu de todos os aparelhos'] };
  function aparelhoDe(ua){
    ua = String(ua || '');
    var so = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    var nav = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
    return [so, nav].filter(Boolean).join(' · ') || (ua ? ua.slice(0, 40) : 'Aparelho desconhecido');
  }
  var fmtAcesso = new Intl.DateTimeFormat('pt-BR', {day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'});
  function telaSeguranca(s){
    var seg = st.seguranca || {acessos: []};
    var b = bloco('Entrada em duas etapas', 'Para entrar no painel num aparelho novo: senha + um código');
    var info = el('div', 'regras seg-info');
    if(seg.segundaEtapa === 'email'){
      info.appendChild(el('span', 'ok', 'Ligada'));
      info.appendChild(el('span', null, 'O código chega no e-mail ' + (seg.email || 'da equipe')));
    } else if(seg.segundaEtapa === 'codigo_equipe'){
      info.appendChild(el('span', 'ok', 'Ligada'));
      info.appendChild(el('span', null, 'Pede o código da equipe'));
    } else info.appendChild(el('span', 'erro', 'Desligada'));
    b.appendChild(info);
    b.appendChild(el('p', 'ajuda', seg.segundaEtapa === 'codigo_equipe'
      ? 'Quando o e-mail do site for ligado na Vercel, o código passa a chegar sozinho no e-mail da equipe, e não será mais preciso digitar o código da equipe.'
      : 'Com "Manter conectado" marcado, cada aparelho pede o código no máximo uma vez a cada 30 dias.'));
    s.appendChild(b);

    var b2 = bloco('Aparelhos conectados', 'Se perderam um celular ou desconfiam de alguma coisa, desconectem todos de uma vez');
    var sa = el('button', 'btn-texto perigo', 'Sair de todos os aparelhos (menos deste)'); sa.type = 'button';
    sa.addEventListener('click', function(){
      if(!sa.dataset.ok){ sa.dataset.ok = '1'; sa.textContent = 'Toque de novo para desconectar todos'; setTimeout(function(){ if(sa.isConnected){ delete sa.dataset.ok; sa.textContent = 'Sair de todos os aparelhos (menos deste)'; } }, 5000); return; }
      escrever('sair-todos', function(){ return api('POST', '/api/admin/sair-todos'); }).then(function(ok){ if(ok) toast('Pronto. Os outros aparelhos precisam entrar de novo.'); });
    });
    b2.appendChild(sa);
    b2.appendChild(el('p', 'ajuda', 'A senha da equipe se troca no site, em "Minha conta". Use pelo menos 12 caracteres; uma frase funciona bem.'));
    s.appendChild(b2);

    var b3 = bloco('Últimos acessos', 'Entradas e tentativas na conta da equipe nos últimos 90 dias. Algo estranho? Troquem a senha e saiam de todos os aparelhos');
    var lst = seg.acessos || [];
    if(!lst.length) b3.appendChild(vazio('Nenhum acesso registrado ainda', 'As próximas entradas aparecem aqui.'));
    var ul = el('ul', 'lista acessos');
    lst.forEach(function(x){
      var rt = ROT_ACESSO[x.resultado] || ['pre', x.resultado];
      var li = el('li', 'acesso');
      li.appendChild(el('span', 'chip ' + rt[0], rt[1]));
      var meio = el('div');
      meio.appendChild(el('strong', null, limpa(fmtAcesso.format(new Date(x.quando)))));
      meio.appendChild(el('span', null, aparelhoDe(x.aparelho) + (x.local ? ' · ' + x.local : '') + (x.ip ? ' · IP ' + x.ip : '')));
      li.appendChild(meio); ul.appendChild(li);
    });
    b3.appendChild(ul);
    s.appendChild(b3);
  }

  /* Funcionamento */
  function telaFuncionamento(s){
    var g = st.geral || {abre:7, fecha:20, diasAFrente:100, diasAbertos:[0,1,2,3,4,5,6], whatsappAgatha:''};
    var b = bloco('Horário e regras', '');
    var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
    var horasDia = []; for(var h = 5; h <= 23; h++) horasDia.push([h, pad(h) + 'h']);
    cs.appendChild(campo('Abre às', seletor('g-abre', horasDia, g.abre)));
    cs.appendChild(campo('Fecha às', seletor('g-fecha', horasDia, g.fecha)));
    cs.appendChild(campo('Reservas com até', seletor('g-dias', [[30, '30 dias de antecedência'], [60, '60 dias de antecedência'], [100, '100 dias de antecedência'], [180, '180 dias de antecedência']], g.diasAFrente)));
    var tel = entrada('g-tel', 'tel', formatarTel(g.whatsappAgatha), {inputmode:'tel', placeholder:'(19) 99999-9999'});
    cs.appendChild(campo('WhatsApp que recebe as pré-reservas', tel, null, 'Hoje: Agatha'));
    var cd = el('div', 'campo largo'); cd.appendChild(el('span', 'rot', 'Dias abertos'));
    var ds = el('div', 'dias-sem');
    DIAS_SEM.forEach(function(n, i){ var l = el('label'); var c = el('input'); c.type = 'checkbox'; c.value = i; c.checked = (g.diasAbertos || []).indexOf(i) >= 0; l.appendChild(c); l.appendChild(el('span', null, n)); ds.appendChild(l); });
    cd.appendChild(ds); cs.appendChild(cd);
    f.appendChild(cs);
    var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); rod.appendChild(msg); var salvo = el('span', 'salvo'); salvo.setAttribute('role', 'status'); rod.appendChild(salvo);
    var bt = el('button', 'btn', 'Salvar'); bt.type = 'submit'; rod.appendChild(bt); f.appendChild(rod);
    f.addEventListener('submit', function(e){
      e.preventDefault(); msg.textContent = ''; salvo.textContent = '';
      var abre = +$('g-abre').value, fecha = +$('g-fecha').value;
      if(fecha <= abre){ msg.textContent = 'O horário de fechar precisa ser depois do de abrir.'; return; }
      var n = $('g-tel').value.replace(/\D/g, ''); if(n && n.length < 10){ msg.textContent = 'Digite o WhatsApp com DDD, como (19) 99999-9999.'; return; }
      if(n && n.length <= 11) n = '55' + n;
      var dias = Array.prototype.map.call(ds.querySelectorAll('input:checked'), function(c){ return +c.value; });
      if(!dias.length){ msg.textContent = 'Deixe pelo menos um dia aberto.'; return; }
      bt.disabled = true;
      escrever('config', function(){ return api('PUT', '/api/admin/config', {abre: abre, fecha: fecha, diasAFrente: +$('g-dias').value, diasAbertos: dias, whatsappAgatha: n}); }).then(function(ok){ bt.disabled = false; if(ok) toast('Funcionamento salvo. O site já mostra as mudanças.'); });
    });
    b.appendChild(f); s.appendChild(b);
    s.appendChild(blocoSenha());
  }
  /* Mesmo padrão dos campos de telefone: (19) 99999-9999, ou (19) 3333-4444 para fixo */
  function formatarTel(n){ n = String(n || '').replace(/\D/g, ''); if(n.indexOf('55') === 0 && n.length > 11) n = n.slice(2); if(n.length === 11) return '(' + n.slice(0,2) + ') ' + n.slice(2,7) + '-' + n.slice(7); if(n.length === 10) return '(' + n.slice(0,2) + ') ' + n.slice(2,6) + '-' + n.slice(6); return n; }

  /* Senha de cliente esquecida: a equipe cria uma nova e manda pelo WhatsApp */
  function blocoSenha(){
    var b = bloco('Senha de cliente', 'Quando um cliente esquecer a senha, crie uma nova aqui e envie para ele');
    var f = el('form'); f.noValidate = true; var cs = el('div', 'campos');
    var em = entrada('cs-email', 'email', '', {autocomplete:'off', inputmode:'email', placeholder:'cliente@exemplo.com'});
    var nv = entrada('cs-nova', 'text', '', {autocomplete:'off', placeholder:'Pelo menos 8 caracteres'});
    cs.appendChild(campo('E-mail da conta', em)); cs.appendChild(campo('Senha nova', nv));
    f.appendChild(cs);
    var rod = el('div', 'rodape-form'); var msg = el('p', 'msg'); msg.setAttribute('role', 'alert'); rod.appendChild(msg);
    var bt = el('button', 'btn-borda', 'Criar senha nova'); bt.type = 'submit'; rod.appendChild(bt); f.appendChild(rod);
    f.addEventListener('submit', function(e){
      e.preventDefault(); msg.textContent = '';
      if(!/\S+@\S+\.\S+/.test(em.value)){ msg.textContent = 'Digite o e-mail da conta do cliente.'; return; }
      if(nv.value.length < 8){ msg.textContent = 'A senha nova precisa ter pelo menos 8 caracteres.'; return; }
      bt.disabled = true;
      api('POST', '/api/admin/usuarios/senha', {email: em.value.trim(), senhaNova: nv.value}).then(function(r){
        bt.disabled = false; toast('Senha nova criada para ' + r.nome + '. Envie para ele pelo WhatsApp.'); em.value = ''; nv.value = '';
      }).catch(function(err){ bt.disabled = false; msg.textContent = err.message; });
    });
    b.appendChild(f);
    return b;
  }

  /* Foto: reduz no próprio navegador para no máximo 1600 px, em WebP, antes de enviar */
  function reduzirFoto(file){
    return new Promise(function(ok, erro){
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function(){
        var esc = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        var c = d.createElement('canvas'); c.width = Math.round(img.naturalWidth * esc); c.height = Math.round(img.naturalHeight * esc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        var dataUrl = c.toDataURL('image/webp', 0.85);
        if(dataUrl.indexOf('data:image/webp') !== 0) dataUrl = c.toDataURL('image/jpeg', 0.85);
        ok(dataUrl);
      };
      img.onerror = function(){ URL.revokeObjectURL(url); erro(new Error('foto')); };
      img.src = url;
    });
  }

  /* ===== Início: quem é, acesso e dados ===== */
  var fmtHora = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit'});
  var redesenhoPendente = false;
  function podeRedesenhar(){
    if($('camada').children.length) return false;
    var a = d.activeElement;
    return !(a && a.closest && a.closest('form') && a.closest('#area'));
  }
  function recarregar(){
    return api('GET', '/api/admin/dados').then(function(r){
      st.geral = r.geral; st.salas = r.salas; st.fixos = r.fixos; st.profissionais = r.profissionais || []; st.reservas = r.reservas; st.parceiros = r.parceiros || []; st.atendimentos = r.atendimentos || []; st.seguranca = r.seguranca || null;
      hoje = deChave(r.agora.data); HOJE = r.agora.data;
      st.carregado = true; $('estado').textContent = '';
      if(podeRedesenhar()) desenhar(); else { redesenhoPendente = true; desenharMenu(); }
    }).catch(function(e){
      if(e.status === 401){ st.acesso = null; st.carregado = false; desenhar(); return; }
      if(e.status === 403){ st.acesso = false; desenhar(); return; }
      $('estado').textContent = e.status === 503 ? e.message : 'Não foi possível atualizar os dados agora.';
    });
  }
  d.addEventListener('focusout', function(){ setTimeout(function(){ if(redesenhoPendente && podeRedesenhar()){ redesenhoPendente = false; desenhar(); } }, 50); });
  var obsCamada = new MutationObserver(function(){ if(redesenhoPendente && podeRedesenhar()){ redesenhoPendente = false; desenhar(); } });
  obsCamada.observe($('camada'), {childList: true});

  function entrouComo(conta){
    st.nome = conta.nome || '';
    $('q-av').textContent = (st.nome || 'C').charAt(0).toUpperCase();
    $('q-nome').textContent = st.nome || 'Casa Lumière';
    $('sair').hidden = false;
    if(!conta.equipe){ st.acesso = false; desenhar(); return; }
    st.acesso = true;
    $('estado').textContent = 'Carregando os dados da Casa…';
    recarregar();
  }
  function sair(){
    api('POST', '/api/auth/sair').catch(function(){}).then(function(){
      st.acesso = null; st.carregado = false; st.nome = ''; $('q-nome').textContent = 'Casa Lumière'; $('q-av').textContent = 'C'; $('sair').hidden = true; desenhar();
    });
  }
  $('sair').addEventListener('click', sair);

  $('q-av').textContent = 'C';
  st.acesso = undefined;
  desenhar();
  api('GET', '/api/auth/eu').then(function(r){
    if(r.conta) entrouComo(r.conta); else { st.acesso = null; desenhar(); }
  }).catch(function(e){ st.acesso = null; desenhar(); $('estado').textContent = e.status === 503 ? e.message : 'Não foi possível conectar agora.'; });
  /* Atualiza sozinho a cada 30 segundos e quando a aba volta a ficar visível */
  setInterval(function(){ if(st.acesso === true && !d.hidden && st.carregado) recarregar(); }, 30000);
  d.addEventListener('visibilitychange', function(){ if(st.acesso === true && !d.hidden) recarregar(); });
})();
