/* Agendamento de salas da Casa Lumière: agenda, pré-reserva e minhas reservas, ligado à API */
(function(){
  /* Tudo o que a equipe altera no painel (salas, horários fixos, funcionamento) vem de /api/agenda */
  var CONFIG = { salas: [], fixos: [], abre: 7, fecha: 20, diasAFrente: 100, diasAbertos: [0,1,2,3,4,5,6], whatsappAgatha: '5519992487347' };
  var MONO = 'assets/img/monograma.webp';
  var EXPIRA_TXT = '1h30';

  var d = document;
  var $ = function(id){ return d.getElementById(id); };
  var pad = function(n){ return (n < 10 ? '0' : '') + n; };
  var fmtSem = new Intl.DateTimeFormat('pt-BR', {weekday:'short', timeZone:'UTC'});
  var fmtMes = new Intl.DateTimeFormat('pt-BR', {month:'short', timeZone:'UTC'});
  var fmtMesLongo = new Intl.DateTimeFormat('pt-BR', {month:'long', timeZone:'UTC'});
  var fmtLongo = new Intl.DateTimeFormat('pt-BR', {weekday:'long', day:'numeric', month:'long', timeZone:'UTC'});
  var fmtHora = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'});
  var fmtAgora = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', hourCycle:'h23'});
  /* As datas "AAAA-MM-DD" viram meia-noite UTC: o dia da semana não muda com o fuso de quem abre */
  function deChave(k){ return new Date(k + 'T00:00:00Z'); }
  function somarDias(k, n){ return new Date(deChave(k).getTime() + n * 86400000).toISOString().slice(0, 10); }
  function agoraLocal(){ var p = {}; fmtAgora.formatToParts(new Date()).forEach(function(x){ p[x.type] = x.value; }); return { data: p.year + '-' + p.month + '-' + p.day, hora: (+p.hour) % 24 }; }
  function limpa(s){ return String(s).replace(/\.$/, ''); }
  function cap(s){ return s.charAt(0).toUpperCase() + s.slice(1); }
  function diaLongo(data){ return limpa(fmtLongo.format(deChave(data))); }
  function faixa(horas){ horas = horas.slice().sort(function(a,b){return a-b;}); if(!horas.length) return ''; var out = [], ini = horas[0], fim = horas[0];
    for(var i = 1; i <= horas.length; i++){ if(horas[i] === fim + 1){ fim = horas[i]; } else { out.push(ini + 'h às ' + (fim + 1) + 'h'); ini = fim = horas[i]; } }
    return out.join(', '); }
  function nomeSala(i){ var s = CONFIG.salas[i]; return s ? s.nome + (s.tipo ? ' ' + s.tipo : '') : 'Sala'; }
  function indicePorId(id){ for(var i = 0; i < CONFIG.salas.length; i++){ if(CONFIG.salas[i].id === id) return i; } return -1; }
  function nomeSalaId(id){ var i = indicePorId(id); return i >= 0 ? nomeSala(i) : 'Sala'; }
  function fixo(sala, data, h){
    var s = CONFIG.salas[sala]; if(!s) return false;
    return CONFIG.fixos.some(function(f){
      if(f.sala !== s.id || h < f.de || h >= f.ate) return false;
      if(f.repete === 'unico') return data === f.desde;
      if(f.desde && data < f.desde) return false;
      if(f.repete === 'semanal') return deChave(data).getUTCDay() === +f.diaSemana;
      if(f.repete === 'aCadaDias'){ if(!f.desde) return false; var dif = Math.round((deChave(data) - deChave(f.desde)) / 86400000); return dif >= 0 && dif % (+f.aCadaDias || 15) === 0; }
      return false;
    });
  }

  /* ===== Estado ===== */
  var st = { sala: 0, data: null, sel: [], ocupados: {}, minhas: [], pronto: false, conta: null };
  var dias = [], meses = [], hoje = agoraLocal().data;
  function montarDias(base){
    hoje = base;
    var agora = agoraLocal();
    var inicio = (agora.data === base && agora.hora >= CONFIG.fecha - 1) ? 1 : 0; /* depois do último horário, a lista começa amanhã */
    dias = [];
    for(var i = inicio; i <= CONFIG.diasAFrente; i++){ var k = somarDias(base, i); if(CONFIG.diasAbertos.indexOf(deChave(k).getUTCDay()) >= 0) dias.push(k); }
    meses = []; dias.forEach(function(k){ var m = k.slice(0, 7); if(meses.indexOf(m) < 0) meses.push(m); });
    if(!st.data || dias.indexOf(st.data) < 0) st.data = dias[0];
  }

  function api(metodo, caminho, corpo){
    if(window.CLConta) return window.CLConta.api(metodo, caminho, corpo);
    return fetch(caminho, {method: metodo, credentials: 'same-origin', headers: corpo ? {'Content-Type': 'application/json'} : {}, body: corpo ? JSON.stringify(corpo) : undefined})
      .then(function(r){ return r.json().then(function(dados){ if(!r.ok){ var e = new Error(dados.mensagem); e.status = r.status; e.erro = dados.erro; throw e; } return dados; }); });
  }

  /* ===== Carregar a agenda ===== */
  var carregando = null;
  function carregar(){
    if(carregando) return carregando;
    var salaAntes = CONFIG.salas[st.sala] ? CONFIG.salas[st.sala].id : null;
    carregando = api('GET', '/api/agenda').then(function(r){
      CONFIG.salas = r.salas.map(function(s){ return { id: s.id, nome: s.nome, tipo: s.tipo, descricao: s.descricao, foto: s.foto, indisponivel: !s.disponivel }; });
      CONFIG.fixos = r.fixos;
      ['abre', 'fecha', 'diasAFrente', 'diasAbertos', 'whatsappAgatha'].forEach(function(k){ if(r.geral[k] !== undefined) CONFIG[k] = r.geral[k]; });
      var mapa = {}; r.ocupados.forEach(function(o){ mapa[o.sala + '_' + o.data + '_' + o.hora] = o; });
      st.ocupados = mapa;
      montarDias(r.agora.data);
      var i = salaAntes ? indicePorId(salaAntes) : -1;
      if(i < 0 || CONFIG.salas[i].indisponivel){ i = 0; while(CONFIG.salas[i] && CONFIG.salas[i].indisponivel) i++; if(!CONFIG.salas[i]) i = 0; }
      if(i !== st.sala){ st.sala = i; st.sel = []; fotoAtual = -1; }
      st.sel = st.sel.filter(livreEm);
      st.pronto = true; $('estado').textContent = '';
      tudo();
    }).catch(function(err){
      $('estado').textContent = err && err.status === 503 ? 'A agenda ainda está sendo configurada. Volte em instantes.' : 'Não foi possível carregar a agenda agora. Confira a internet e recarregue a página.';
    }).then(function(){ carregando = null; });
    return carregando;
  }
  function carregarMinhas(){
    if(!st.conta){ st.minhas = []; desenharMinhas(); return Promise.resolve(); }
    return api('GET', '/api/reservas').then(function(r){ st.minhas = r.reservas; desenharMinhas(); }).catch(function(){ desenharMinhas(); });
  }

  /* ===== Notificações ===== */
  function notificar(tipo, titulo, texto){
    var n = d.createElement('div');
    n.className = 'notif ' + tipo;
    n.setAttribute('role', tipo === 'erro' ? 'alert' : 'status');
    var img = d.createElement('img'); img.src = MONO; img.alt = '';
    var corpo = d.createElement('div');
    var t = d.createElement('strong'); t.textContent = titulo;
    var s = d.createElement('span'); s.textContent = texto;
    corpo.appendChild(t); corpo.appendChild(s);
    var x = d.createElement('button'); x.type = 'button'; x.setAttribute('aria-label', 'Fechar aviso'); x.textContent = '×';
    function fechar(){ n.classList.add('saindo'); setTimeout(function(){ n.remove(); }, 350); }
    x.addEventListener('click', fechar);
    n.appendChild(img); n.appendChild(corpo); n.appendChild(x);
    $('avisos').appendChild(n);
    setTimeout(fechar, 7000);
  }

  /* ===== Leitura do estado ===== */
  function reservaDe(sala, data, h){ var s = CONFIG.salas[sala]; return s ? st.ocupados[s.id + '_' + data + '_' + h] : null; }
  function passou(data, h){ var a = agoraLocal(); return data < a.data || (data === a.data && h <= a.hora); }
  function livres(sala, data){ var n = 0; for(var h = CONFIG.abre; h < CONFIG.fecha; h++){ if(!reservaDe(sala, data, h) && !fixo(sala, data, h) && !passou(data, h)) n++; } return n; }
  function abertas(){ var a = []; CONFIG.salas.forEach(function(s, i){ if(!s.indisponivel) a.push(i); }); return a; }

  /* ===== Desenho ===== */
  function desenharPortas(){
    var c = $('portas'); c.textContent = '';
    CONFIG.salas.forEach(function(nome, i){
      var b = d.createElement('button'); b.type = 'button'; b.className = 'porta'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', i === st.sala ? 'true' : 'false');
      b.tabIndex = i === st.sala ? 0 : -1;
      b.innerHTML = '<span class="luz"></span><span class="nome"></span><span class="tipo"></span><span class="livres"></span>';
      b.querySelector('.nome').textContent = nome.nome;
      b.querySelector('.tipo').textContent = nome.tipo;
      if(nome.indisponivel){
        b.classList.add('fechada'); b.setAttribute('aria-disabled', 'true');
        b.querySelector('.tipo').textContent = '';
        b.querySelector('.livres').textContent = 'Indisponível';
        b.setAttribute('aria-label', nome.nome + ', indisponível');
        c.appendChild(b); return;
      }
      var n = livres(i, st.data);
      b.querySelector('.livres').textContent = n === 0 ? 'Sem horários' : n + (n === 1 ? ' livre' : ' livres');
      b.setAttribute('aria-label', nomeSala(i) + ', ' + b.querySelector('.livres').textContent);
      b.addEventListener('click', function(){ if(st.sala !== i){ st.sala = i; st.sel = []; tudo(); } });
      b.addEventListener('keydown', function(e){ var m = {ArrowRight:1, ArrowDown:1, ArrowLeft:-1, ArrowUp:-1}[e.key]; if(!m) return; e.preventDefault(); var ab = abertas(); var p = ab.indexOf(i); st.sala = ab[(p + m + ab.length) % ab.length]; st.sel = []; tudo(); c.children[st.sala].focus(); });
      c.appendChild(b);
    });
  }
  var fotoAtual = -1;
  function desenharFoto(){
    var s = CONFIG.salas[st.sala]; if(!s) return;
    var chave = st.sala + '|' + s.foto + '|' + s.nome + '|' + s.tipo;
    if(fotoAtual === chave) return;
    fotoAtual = chave;
    var f = $('foto-sala'); f.textContent = '';
    if(s.foto){ var img = d.createElement('img'); img.src = s.foto; img.alt = 'Foto da ' + nomeSala(st.sala); img.decoding = 'async'; f.appendChild(img); }
    else { var v = d.createElement('div'); v.className = 'sem-foto'; v.innerHTML = '<div><img alt=""><p>A foto desta sala aparece aqui.</p></div>'; v.querySelector('img').src = MONO; f.appendChild(v); }
    var leg = d.createElement('figcaption'); leg.className = 'legenda-foto';
    leg.innerHTML = '<strong></strong><span></span>';
    leg.querySelector('strong').textContent = s.nome; leg.querySelector('span').textContent = s.descricao || s.tipo;
    f.appendChild(leg);
  }
  function desenharMeses(alvo){
    var c = $(alvo); c.textContent = '';
    meses.forEach(function(m){
      var dt = deChave(m + '-01');
      var b = d.createElement('button'); b.type = 'button'; b.className = 'mes-btn';
      var nome = cap(fmtMesLongo.format(dt));
      b.textContent = m.slice(0, 4) === hoje.slice(0, 4) ? nome : nome + ' ' + m.slice(0, 4);
      b.setAttribute('aria-pressed', st.data.slice(0, 7) === m ? 'true' : 'false');
      b.addEventListener('click', function(){
        if(st.data.slice(0, 7) === m) return;
        st.data = dias.filter(function(k){ return k.slice(0, 7) === m; })[0];
        st.sel = []; tudo();
      });
      c.appendChild(b);
    });
  }
  function desenharDias(alvo, aoEscolher){
    var c = $(alvo); c.textContent = '';
    var mesAtual = st.data.slice(0, 7);
    dias.filter(function(k){ return k.slice(0, 7) === mesAtual; }).forEach(function(k){
      var dt = deChave(k);
      var b = d.createElement('button'); b.type = 'button'; b.className = 'dia';
      b.setAttribute('aria-pressed', k === st.data ? 'true' : 'false');
      b.setAttribute('aria-label', diaLongo(k));
      b.innerHTML = '<span class="sem"></span><span class="num"></span><span class="mes"></span>';
      b.querySelector('.sem').textContent = k === agoraLocal().data ? 'hoje' : limpa(fmtSem.format(dt));
      b.querySelector('.num').textContent = dt.getUTCDate();
      b.querySelector('.mes').textContent = limpa(fmtMes.format(dt));
      b.addEventListener('click', function(){ if(st.data !== k){ st.data = k; st.sel = []; tudo(); aoEscolher && aoEscolher(); } });
      c.appendChild(b);
    });
  }
  function livreEm(h){ return !reservaDe(st.sala, st.data, h) && !fixo(st.sala, st.data, h) && !passou(st.data, h); }
  function escolherHora(h){
    var i = st.sel.indexOf(h);
    if(i >= 0){ st.sel.splice(i, 1); }
    else if(st.sel.length === 1 && Math.abs(st.sel[0] - h) > 1){
      var a = Math.min(st.sel[0], h), z = Math.max(st.sel[0], h), todos = true;
      for(var x = a; x <= z; x++){ if(!livreEm(x)) todos = false; }
      if(todos){ st.sel = []; for(var y = a; y <= z; y++) st.sel.push(y); }
      else { st.sel.push(h); }
    }
    else { st.sel.push(h); }
    desenharHoras(); desenharResumo();
  }
  function rotuloOcupado(r){
    var conf = r.status === 'confirmada';
    if(r.minha) return conf ? ['Sua reserva', 'minha'] : ['Sua pré-reserva', 'pre'];
    return conf ? ['Reservado', 'ocupada'] : ['Pré-reservado', 'pre'];
  }
  function desenharHoras(){
    var c = $('horas'); c.textContent = '';
    for(var h = CONFIG.abre; h < CONFIG.fecha; h++){ (function(h){
      var r = reservaDe(st.sala, st.data, h), p = passou(st.data, h), sel = st.sel.indexOf(h) >= 0;
      var b = d.createElement('button'); b.type = 'button'; b.className = 'hora';
      b.innerHTML = '<span class="h"></span><span class="st"></span>';
      b.querySelector('.h').textContent = pad(h) + 'h';
      var estado = 'Livre';
      if(fixo(st.sala, st.data, h)){ b.disabled = true; estado = 'Horário fixo'; b.classList.add('fixa'); }
      else if(r){ b.disabled = true; var ro = rotuloOcupado(r); estado = ro[0]; b.classList.add(ro[1]); }
      else if(p){ b.disabled = true; estado = 'Encerrado'; b.classList.add('passou'); }
      else { b.setAttribute('aria-pressed', sel ? 'true' : 'false'); if(sel) estado = 'Selecionado'; }
      b.querySelector('.st').textContent = estado;
      b.setAttribute('aria-label', pad(h) + ' horas, ' + estado.toLowerCase());
      b.addEventListener('click', function(){ escolherHora(h); });
      c.appendChild(b);
    })(h); }
  }
  function desenharDica(){
    var dica = $('conta-dica'); dica.textContent = '';
    var c = st.conta;
    if(c){
      dica.appendChild(d.createTextNode('Reservando como '));
      var b = d.createElement('strong'); b.textContent = c.nome; dica.appendChild(b);
      dica.appendChild(d.createTextNode(c.telefone ? ', WhatsApp ' + c.telefone + '. ' : '. '));
      var e = d.createElement('button'); e.type = 'button'; e.textContent = 'Alterar dados';
      e.addEventListener('click', function(){ window.CLConta && window.CLConta.abrir('perfil'); });
      dica.appendChild(e);
    } else {
      dica.appendChild(d.createTextNode('Para pré-reservar, '));
      var en = d.createElement('button'); en.type = 'button'; en.textContent = 'entre na sua conta';
      en.addEventListener('click', function(){ pedirConta('entrar'); });
      dica.appendChild(en);
      dica.appendChild(d.createTextNode(' ou '));
      var cr = d.createElement('button'); cr.type = 'button'; cr.textContent = 'crie uma';
      cr.addEventListener('click', function(){ pedirConta('criar'); });
      dica.appendChild(cr);
      dica.appendChild(d.createTextNode('. Leva menos de um minuto.'));
    }
  }
  function desenharResumo(){
    $('r-sala').textContent = CONFIG.salas.length ? nomeSala(st.sala) : '';
    var box = $('r-detalhe'); box.textContent = '';
    if(!st.sel.length){
      var p = d.createElement('p'); p.className = 'vazio-sel'; p.textContent = 'Escolha um ou mais horários.'; box.appendChild(p);
    } else {
      var dl = d.createElement('dl'); dl.className = 'linhas';
      [['Dia', diaLongo(st.data)], ['Horário', faixa(st.sel)], ['Total', st.sel.length + (st.sel.length === 1 ? ' hora' : ' horas')]].forEach(function(l){
        var div = d.createElement('div'); var dt = d.createElement('dt'); dt.textContent = l[0]; var dd = d.createElement('dd'); dd.textContent = l[1]; div.appendChild(dt); div.appendChild(dd); dl.appendChild(div);
      });
      box.appendChild(dl);
    }
    var btn = $('f-btn');
    if(!enviando) btn.textContent = st.conta ? 'Pré-reservar' : 'Entrar para pré-reservar';
    btn.disabled = enviando || !st.sel.length;
    desenharDica();
  }
  function desenharAgenda(){
    $('agenda-titulo').textContent = cap(diaLongo(st.data));
    var g = $('grade'); g.textContent = '';
    var n = CONFIG.fecha - CONFIG.abre; g.style.setProperty('--n', n);
    g.appendChild(d.createElement('span'));
    for(var h = CONFIG.abre; h < CONFIG.fecha; h++){ var c = d.createElement('span'); c.className = 'cab'; c.textContent = pad(h); g.appendChild(c); }
    CONFIG.salas.forEach(function(nome, s){
      var rot = d.createElement('span'); rot.className = 'rot' + (nome.indisponivel ? ' fechada' : '');
      rot.innerHTML = '<b></b><small></small>'; rot.querySelector('b').textContent = nome.nome; rot.querySelector('small').textContent = nome.tipo; g.appendChild(rot);
      var rotulo = nome.nome + (nome.tipo ? ' ' + nome.tipo : '');
      for(var h = CONFIG.abre; h < CONFIG.fecha; h++){ (function(h){
        var r = reservaDe(s, st.data, h);
        var b = d.createElement('button'); b.type = 'button'; b.className = 'cel';
        if(nome.indisponivel){ b.classList.add('fechada'); b.disabled = true; b.title = nome.nome + ': indisponível'; }
        else if(fixo(s, st.data, h)){ b.classList.add('ocupada'); b.disabled = true; b.title = rotulo + ', ' + pad(h) + 'h: horário fixo'; }
        else if(r){ var conf = r.status === 'confirmada'; b.classList.add('ocupada'); if(!conf) b.classList.add('pre'); else if(r.minha) b.classList.add('minha'); b.disabled = true; b.title = rotulo + ', ' + pad(h) + 'h: ' + (conf ? (r.minha ? 'sua reserva' : 'reservado') : 'pré-reservado'); }
        else if(passou(st.data, h)){ b.disabled = true; }
        else { b.title = rotulo + ', ' + pad(h) + 'h: livre'; b.addEventListener('click', function(){ st.sala = s; st.sel = [h]; abrirAba('reservar'); tudo(); }); }
        b.setAttribute('aria-label', b.title || (rotulo + ', ' + pad(h) + 'h, encerrado'));
        g.appendChild(b);
      })(h); }
    });
  }
  function desenharMinhas(){
    var lista = st.minhas.filter(function(r){ return r.data >= agoraLocal().data; });
    var ativas = lista.filter(function(r){ return r.status !== 'expirada'; }).length;
    var contador = $('conta-minhas'); contador.hidden = !ativas; contador.textContent = ativas;
    var ul = $('minhas'); ul.textContent = '';
    if(!st.conta){
      var s = d.createElement('li'); s.className = 'vazio';
      s.innerHTML = '<strong>Entre para ver as suas reservas</strong>As pré-reservas e reservas ficam guardadas na sua conta. ';
      var b = d.createElement('button'); b.type = 'button'; b.className = 'link-simples'; b.textContent = 'Entrar ou criar conta';
      b.addEventListener('click', function(){ pedirConta(jaEntrou() ? 'entrar' : 'criar'); });
      s.appendChild(b); ul.appendChild(s); return;
    }
    if(!lista.length){
      var v = d.createElement('li'); v.className = 'vazio';
      v.innerHTML = '<strong>Nenhuma reserva ainda</strong>Quando você pré-reservar uma sala, ela aparece aqui, com o atalho para falar com a Agatha e a opção de cancelar.';
      ul.appendChild(v); return;
    }
    lista.forEach(function(r){
      var li = d.createElement('li'); li.className = 'reserva' + (r.status === 'expirada' ? ' expirada' : '');
      li.innerHTML = '<span class="r-arco"></span><div><h3></h3><p></p><span class="status"></span></div><div class="acoes"></div>';
      var i = indicePorId(r.sala), sala = CONFIG.salas[i];
      li.querySelector('.r-arco').textContent = sala ? sala.nome.replace('Sala ', '') : '';
      li.querySelector('h3').textContent = nomeSalaId(r.sala);
      li.querySelector('p').textContent = cap(diaLongo(r.data)) + ', ' + faixa(r.horas);
      var stt = li.querySelector('.status'), acoes = li.querySelector('.acoes');
      var msg = msgAgatha(r.sala, r.data, r.horas, r.nome, r.especialidade, r.telefone);
      if(r.status === 'confirmada'){
        stt.className = 'status ok'; stt.textContent = 'Reservada';
        acoes.appendChild(botaoWhats('Olá, Agatha! Sobre a minha reserva da ' + nomeSalaId(r.sala) + ' em ' + diaLongo(r.data) + ', ' + faixa(r.horas) + ':', 'Falar com a Agatha'));
      } else if(r.status === 'pre'){
        stt.className = 'status pre'; stt.textContent = 'Pré-reserva: aguardando a Agatha' + (r.expiraEm ? '. Vale até ' + fmtHora.format(new Date(r.expiraEm)) : '');
        acoes.appendChild(botaoWhats(msg, 'Falar com a Agatha'));
        acoes.appendChild(botaoCancelar(r, 'Cancelar'));
      } else {
        stt.className = 'status exp'; stt.textContent = 'Expirou sem confirmação';
        acoes.appendChild(botaoCancelar(r, 'Remover'));
      }
      ul.appendChild(li);
    });
  }
  function botaoCancelar(r, rotulo){
    var b = d.createElement('button'); b.type = 'button'; b.className = 'btn btn-linha btn-pequeno'; b.textContent = rotulo;
    b.addEventListener('click', function(){
      if(!b.dataset.confirma){ b.dataset.confirma = '1'; b.textContent = rotulo === 'Remover' ? 'Confirmar' : 'Confirmar cancelamento'; setTimeout(function(){ if(b.isConnected){ delete b.dataset.confirma; b.textContent = rotulo; } }, 5000); return; }
      b.disabled = true;
      api('DELETE', '/api/reservas/' + r.id).then(function(){
        if(rotulo !== 'Remover') notificar('ok', 'Pré-reserva cancelada', nomeSalaId(r.sala) + ', ' + diaLongo(r.data) + ', ' + faixa(r.horas));
        return Promise.all([carregar(), carregarMinhas()]);
      }).catch(function(err){ b.disabled = false; notificar('erro', 'Não foi possível cancelar', err.message || 'Tente de novo em instantes.'); });
    });
    return b;
  }
  function tudo(){
    if(!st.pronto) return;
    desenharPortas(); desenharFoto(); desenharMeses('meses'); desenharMeses('meses-agenda'); desenharDias('dias'); desenharDias('dias-agenda'); desenharHoras(); desenharResumo(); desenharAgenda(); desenharMinhas();
  }

  $('sel-dia').addEventListener('click', function(){ st.sel = []; for(var h = CONFIG.abre; h < CONFIG.fecha; h++){ if(livreEm(h)) st.sel.push(h); } desenharHoras(); desenharResumo(); });
  $('sel-limpar').addEventListener('click', function(){ st.sel = []; desenharHoras(); desenharResumo(); });

  /* ===== Abas ===== */
  var abas = ['reservar', 'agenda', 'minhas'];
  function abrirAba(nome){
    abas.forEach(function(a){
      var on = a === nome;
      $('aba-' + a).setAttribute('aria-selected', on ? 'true' : 'false');
      $('aba-' + a).tabIndex = on ? 0 : -1;
      $('painel-' + a).hidden = !on;
    });
  }
  abas.forEach(function(a, i){
    $('aba-' + a).addEventListener('click', function(){ abrirAba(a); });
    $('aba-' + a).addEventListener('keydown', function(e){ var m = {ArrowRight:1, ArrowLeft:-1}[e.key]; if(!m) return; var n = abas[(i + m + abas.length) % abas.length]; abrirAba(n); $('aba-' + n).focus(); });
  });

  /* ===== Mensagem para a Agatha ===== */
  var ICONE_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C6.5 2.5 2.2 6.4 2.2 11.2c0 2.6 1.2 4.9 3.2 6.5L4.5 21.5l4.4-2.2c1 .3 2 .4 3.1.4 5.5 0 9.8-3.9 9.8-8.6S17.5 2.5 12 2.5z"/></svg>';
  function msgAgatha(salaId, data, horas, nome, esp, tel){
    var linhas = ['Olá, Agatha! Fiz uma pré-reserva pelo site da Casa Lumière:', '',
      'Sala: ' + nomeSalaId(salaId),
      'Dia: ' + diaLongo(data),
      'Horário: ' + faixa(horas) + ' (' + horas.length + (horas.length === 1 ? ' hora)' : ' horas)'),
      'Nome: ' + nome];
    if(esp) linhas.push('Especialidade: ' + esp);
    linhas.push('WhatsApp: ' + tel, '', 'Pode confirmar a reserva e me dizer como faço o pagamento?');
    return linhas.join('\n');
  }
  /* No computador abre o WhatsApp Web; no celular abre o aplicativo */
  var noComputador = window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  function linkAgatha(msg){
    return noComputador
      ? 'https://web.whatsapp.com/send?phone=' + CONFIG.whatsappAgatha + '&text=' + encodeURIComponent(msg)
      : 'https://wa.me/' + CONFIG.whatsappAgatha + '?text=' + encodeURIComponent(msg);
  }
  function telVisivel(n){ n = String(n || '').replace(/\D/g, ''); if(n.indexOf('55') === 0 && n.length > 11) n = n.slice(2); return n.length === 11 ? '(' + n.slice(0,2) + ') ' + n.slice(2,7) + '-' + n.slice(7) : n; }
  function botaoWhats(msg, rotulo){
    var a = d.createElement('a'); a.className = 'btn-wa'; a.href = linkAgatha(msg); a.target = '_blank'; a.rel = 'noopener';
    a.innerHTML = ICONE_WA; a.appendChild(d.createTextNode(rotulo)); return a;
  }
  function janelaPre(r){
    var antes = d.activeElement;
    var f = d.createElement('div'); f.className = 'pre-fundo';
    f.innerHTML = '<div class="pre-caixa" role="dialog" aria-modal="true" aria-labelledby="pre-titulo"><img class="mono-pre" alt=""><h2 id="pre-titulo">Horário <em>pré-reservado</em></h2><p class="pre-txt"></p><dl></dl><a class="btn btn-grande" target="_blank" rel="noopener"></a><p class="num-agatha"></p><button type="button" class="depois">Enviar depois</button></div>';
    f.querySelector('.mono-pre').src = MONO;
    f.querySelector('.pre-txt').textContent = 'Para garantir, envie os detalhes para a Agatha. Ela combina o pagamento com você e confirma a reserva. Sem confirmação, o horário volta a ficar livre em ' + EXPIRA_TXT + '.';
    f.querySelector('.num-agatha').textContent = 'Agatha: ' + telVisivel(CONFIG.whatsappAgatha);
    var dl = f.querySelector('dl');
    [['Sala', nomeSalaId(r.sala)], ['Dia', diaLongo(r.data)], ['Horário', faixa(r.horas)], ['Total', r.horas.length + (r.horas.length === 1 ? ' hora' : ' horas')]].forEach(function(l){
      var div = d.createElement('div'), dt = d.createElement('dt'), dd = d.createElement('dd'); dt.textContent = l[0]; dd.textContent = l[1]; div.appendChild(dt); div.appendChild(dd); dl.appendChild(div);
    });
    var btn = f.querySelector('.btn'); btn.href = linkAgatha(msgAgatha(r.sala, r.data, r.horas, r.nome, r.especialidade, r.telefone)); btn.innerHTML = ICONE_WA + 'Enviar para a Agatha';
    function fechar(){ f.remove(); d.removeEventListener('keydown', esc); if(antes && antes.focus) antes.focus(); }
    function esc(e){ if(e.key === 'Escape') fechar(); }
    btn.addEventListener('click', function(){ setTimeout(fechar, 300); });
    f.querySelector('.depois').addEventListener('click', fechar);
    f.addEventListener('click', function(e){ if(e.target === f) fechar(); });
    d.addEventListener('keydown', esc);
    d.body.appendChild(f); btn.focus();
  }

  /* ===== Conta ===== */
  function jaEntrou(){ try{ return !!localStorage.getItem('cl-ja-entrou'); }catch(e){ return false; } }
  function pedirConta(modo, depois){
    if(!window.CLConta) return;
    window.CLConta.abrir(modo, { motivo: 'Para pré-reservar, entre ou crie a sua conta. Os horários que você escolheu continuam marcados.', depois: depois });
  }
  function aoMudarConta(c){
    var antes = st.conta && st.conta.id;
    st.conta = c;
    if((c && c.id) !== antes){ carregar(); carregarMinhas(); }
    else { desenharResumo(); desenharMinhas(); }
  }
  d.addEventListener('cl-conta', function(e){ aoMudarConta(e.detail); });

  /* ===== Pré-reservar ===== */
  var enviando = false;
  function enviar(){
    if(enviando || !st.sel.length) return;
    var erro = $('f-erro'); erro.hidden = true;
    if(!st.conta){ pedirConta(jaEntrou() ? 'entrar' : 'criar', enviar); return; }
    var horas = st.sel.slice().filter(function(h){ return !fixo(st.sala, st.data, h); }).sort(function(a,b){return a-b;});
    if(!horas.length) return;
    var salaId = CONFIG.salas[st.sala].id, data = st.data;
    enviando = true; $('f-btn').disabled = true; $('f-btn').textContent = 'Pré-reservando…';
    api('POST', '/api/reservas', {sala: salaId, data: data, horas: horas}).then(function(r){
      enviando = false; st.sel = [];
      notificar('ok', nomeSalaId(salaId) + ' pré-reservada', cap(diaLongo(data)) + ', ' + faixa(horas) + '. Falta a confirmação da Agatha.');
      janelaPre(r.reserva);
      return Promise.all([carregar(), carregarMinhas()]);
    }).catch(function(err){
      enviando = false; desenharResumo();
      if(err.status === 401){ st.conta = null; pedirConta('entrar', enviar); return; }
      if(err.status === 409){ notificar('erro', 'Horário indisponível', err.message); carregar(); return; }
      erro.textContent = err.message || 'A pré-reserva não foi feita. Tente de novo em instantes.'; erro.hidden = false;
    });
  }
  $('form-reserva').addEventListener('submit', function(e){ e.preventDefault(); enviar(); });

  /* ===== Início ===== */
  $('estado').textContent = 'Carregando a agenda…';
  if(window.CLConta && window.CLConta.carregada()) st.conta = window.CLConta.atual();
  carregar();
  /* A agenda se atualiza sozinha a cada minuto e quando a pessoa volta para a aba */
  setInterval(function(){ if(!d.hidden && !enviando) carregar(); }, 60000);
  d.addEventListener('visibilitychange', function(){ if(!d.hidden) { carregar(); carregarMinhas(); } });
})();
