/* Confirmação em 1 clique: a Agatha abre o link que veio na mensagem do cliente, confere o Pix no banco e confirma.
   Só funciona com a conta da equipe conectada; para qualquer outra pessoa o link não faz nada. */
(function(){
  var d = document, tela = d.getElementById('tela');
  var id = new URLSearchParams(location.search).get('r') || '';
  var WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C6.5 2.5 2.2 6.4 2.2 11.2c0 2.6 1.2 4.9 3.2 6.5L4.5 21.5l4.4-2.2c1 .3 2 .4 3.1.4 5.5 0 9.8-3.9 9.8-8.6S17.5 2.5 12 2.5z"/></svg>';
  var brl = new Intl.NumberFormat('pt-BR', {style:'currency', currency:'BRL'});
  var fmtDia = new Intl.DateTimeFormat('pt-BR', {weekday:'long', day:'numeric', month:'long', timeZone:'UTC'});
  var fmtHora = new Intl.DateTimeFormat('pt-BR', {hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo'});

  function el(tag, cls, txt){ var e = d.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }
  function limpar(){ tela.textContent = ''; }
  function dia(k){ var t = fmtDia.format(new Date(k + 'T00:00:00Z')); return t.charAt(0).toUpperCase() + t.slice(1); }
  function faixa(h){ h = h.slice().sort(function(a, b){ return a - b; }); var out = [], i0 = h[0], f = h[0];
    for(var i = 1; i <= h.length; i++){ if(h[i] === f + 1) f = h[i]; else { out.push(i0 + 'h às ' + (f + 1) + 'h'); i0 = f = h[i]; } } return out.join(', '); }
  function api(metodo, caminho, corpo){
    return fetch(caminho, {method: metodo, credentials: 'same-origin', headers: corpo ? {'Content-Type': 'application/json'} : {}, body: corpo ? JSON.stringify(corpo) : undefined})
      .then(function(r){ return r.json().catch(function(){ return {}; }).then(function(dados){ if(!r.ok){ var e = new Error(dados.mensagem || 'Não foi possível concluir agora.'); e.status = r.status; e.erro = dados.erro; throw e; } return dados; }); },
        function(){ var e = new Error('Sem internet. Confira a conexão e tente de novo.'); e.status = 0; throw e; });
  }
  function linkWhats(tel, msg, web){
    var n = String(tel || '').replace(/\D/g, ''); if(!n) return '';
    if(n.length <= 11) n = '55' + n;
    return (web ? 'https://web.whatsapp.com/send?phone=' + n + '&text=' : 'https://wa.me/' + n + '?text=') + encodeURIComponent(msg);
  }
  function titulo(html, sub){ var h = el('h1'); h.innerHTML = html; tela.appendChild(h); if(sub) tela.appendChild(el('p', 'sub', sub)); }
  function rodape(){ var p = el('p', 'rodape'); var a = el('a', null, 'Abrir o painel da Casa'); a.href = 'painel.html'; p.appendChild(a); tela.appendChild(p); }
  function erro(txt){ limpar(); titulo('Algo não <em>deu certo</em>'); tela.appendChild(el('p', 'aviso erro', txt)); rodape(); }

  /* ===== Entrar (só aparece se a sessão da equipe não estiver neste navegador) ===== */
  function telaEntrar(){
    limpar();
    titulo('Entre para <em>confirmar</em>', 'Use o e-mail e a senha da equipe. Você fica conectada por 30 dias neste celular.');
    var f = el('form', 'cartao'); f.noValidate = true;
    f.innerHTML = '<label for="em">E-mail da equipe</label><input id="em" type="email" autocomplete="username" inputmode="email">' +
      '<label for="se">Senha</label><input id="se" type="password" autocomplete="current-password">' +
      '<label class="lembrar"><input type="checkbox" id="lb" checked>Manter conectada</label>' +
      '<div id="passo2" hidden><label for="cd" id="cd-rot">Código</label><input id="cd" autocomplete="one-time-code"><p class="sub" id="cd-ajuda" style="margin:.4rem 0 0"></p></div>' +
      '<p class="aviso erro" id="msg" role="alert"></p><button class="btn ouro" type="submit">Entrar</button>';
    tela.appendChild(f);
    var b = f.querySelector('button'), msg = f.querySelector('#msg');
    f.addEventListener('submit', function(e){
      e.preventDefault(); msg.textContent = '';
      var em = f.querySelector('#em').value.trim(), se = f.querySelector('#se').value, p2 = f.querySelector('#passo2'), cd = f.querySelector('#cd');
      if(!em || !se){ msg.textContent = 'Digite o e-mail e a senha.'; return; }
      var corpo = {email: em, senha: se, lembrar: f.querySelector('#lb').checked};
      if(!p2.hidden && cd.value.trim()){ if(p2.dataset.modo === 'email') corpo.codigoEmail = cd.value.trim(); else corpo.codigoEquipe = cd.value.trim(); }
      b.disabled = true; b.textContent = 'Entrando…';
      api('POST', '/api/auth/entrar', corpo)
        .then(function(r){ if(!r.conta.equipe){ telaSemAcesso(); return; } carregar(); })
        .catch(function(err){
          b.disabled = false; b.textContent = 'Entrar';
          if(err.erro === 'precisa_codigo' || err.erro === 'precisa_codigo_equipe'){
            var email = err.erro === 'precisa_codigo';
            p2.dataset.modo = email ? 'email' : 'equipe'; p2.hidden = false;
            f.querySelector('#cd-rot').textContent = email ? 'Código que chegou no e-mail' : 'Código da equipe';
            cd.type = email ? 'text' : 'password'; cd.inputMode = email ? 'numeric' : 'text';
            f.querySelector('#cd-ajuda').textContent = err.message; cd.focus(); return;
          }
          if(err.erro === 'codigo_errado' || err.erro === 'codigo_vencido' || err.erro === 'codigo_equipe') cd.value = '';
          msg.textContent = err.message;
        });
    });
    setTimeout(function(){ f.querySelector('#em').focus(); }, 50);
  }
  function telaSemAcesso(){
    limpar();
    titulo('Link da <em>equipe</em>', 'Este link é para a equipe da Casa confirmar a reserva depois de conferir o pagamento. Se você é cliente, não precisa fazer nada: a Casa Lumière confirma e te avisa pelo WhatsApp.');
    var a = el('a', 'btn linha', 'Ver minhas reservas'); a.href = 'salas.html#minhas'; tela.appendChild(a);
  }

  /* ===== A reserva ===== */
  function mostrar(r, aviso){
    limpar();
    var sala = (r.salaNome || 'Sala') + (r.salaTipo ? ' ' + r.salaTipo : '');
    var conf = r.status === 'confirmada';
    titulo(conf ? 'Reserva <em>confirmada</em>' : 'Confirmar <em>reserva</em>', conf ? '' : 'Confira no banco se o Pix caiu. Depois é só tocar em Confirmar.');
    var c = el('section', 'cartao');
    var selo = ({pre: ['pre', 'Pré-reserva' + (r.expiraEm ? ' · vale até ' + fmtHora.format(new Date(r.expiraEm)) : '')], confirmada: ['ok', 'Confirmada'], expirada: ['exp', 'A pré-reserva expirou']})[r.status];
    c.appendChild(el('span', 'selo ' + selo[0], selo[1]));
    var dl = el('dl');
    [['Pessoa', r.nome + (r.especialidade ? ', ' + r.especialidade : '')], ['Sala', sala], ['Dia', dia(r.data)], ['Horário', faixa(r.horas)],
     ['Valor', r.valor != null ? brl.format(r.valor) + (r.descontoPct ? ' (parceiro)' : '') : 'A combinar']].forEach(function(l, i){
      dl.appendChild(el('dt', null, l[0])); dl.appendChild(el('dd', i === 4 ? 'valor' : null, l[1]));
    });
    c.appendChild(dl); tela.appendChild(c);
    if(aviso) tela.appendChild(el('p', 'aviso ok', aviso));
    var msg = el('p', 'aviso erro'); msg.setAttribute('role', 'alert');

    if(!conf){
      var bc = el('button', 'btn ouro', 'Confirmar reserva'); bc.type = 'button';
      if(r.status === 'expirada') tela.appendChild(el('p', 'sub', 'Passou de 1h30 sem confirmação. Se o horário continuar livre, ainda dá para confirmar.'));
      bc.addEventListener('click', function(){
        bc.disabled = true; bc.textContent = 'Confirmando…'; msg.textContent = '';
        api('POST', '/api/admin/reservas/' + encodeURIComponent(r.id) + '/confirmar')
          .then(function(){ r.status = 'confirmada'; r.expiraEm = null; mostrar(r, 'Pronto! A reserva está confirmada e o horário ficou bloqueado na agenda.'); })
          .catch(function(err){ bc.disabled = false; bc.textContent = 'Confirmar reserva'; msg.textContent = err.message; });
      });
      tela.appendChild(bc);
      tela.appendChild(msg);
      var rec = el('button', 'btn texto', 'Recusar e liberar o horário'); rec.type = 'button';
      rec.addEventListener('click', function(){
        if(!rec.dataset.ok){ rec.dataset.ok = '1'; rec.textContent = 'Toque de novo para recusar'; setTimeout(function(){ if(rec.isConnected){ delete rec.dataset.ok; rec.textContent = 'Recusar e liberar o horário'; } }, 5000); return; }
        rec.disabled = true;
        api('DELETE', '/api/admin/reservas/' + encodeURIComponent(r.id))
          .then(function(){ limpar(); titulo('Reserva <em>recusada</em>', 'O horário voltou a ficar livre no site.'); avisarCliente(r, 'Olá, ' + r.nome.split(' ')[0] + '! Aqui é da Casa Lumière. Não conseguimos confirmar a sua pré-reserva da ' + sala + ' em ' + dia(r.data).toLowerCase() + ', ' + faixa(r.horas) + '. Quer combinar outro horário?'); rodape(); })
          .catch(function(err){ rec.disabled = false; msg.textContent = err.message; });
      });
      tela.appendChild(rec);
    } else {
      avisarCliente(r, 'Olá, ' + r.nome.split(' ')[0] + '! Aqui é da Casa Lumière. Sua reserva da ' + sala + ' está confirmada: ' + dia(r.data).toLowerCase() + ', ' + faixa(r.horas) + '. Até lá!');
    }
    rodape();
  }
  function avisarCliente(r, texto){
    if(!r.telefone) return;
    tela.appendChild(el('p', 'sub', 'Avisar ' + r.nome.split(' ')[0] + ' pelo WhatsApp:')).style.marginTop = '1.2rem';
    var duas = el('div', 'duas');
    var a = el('a', 'btn ouro'); a.href = linkWhats(r.telefone, texto); a.target = '_blank'; a.rel = 'noopener'; a.innerHTML = WA + 'WhatsApp';
    var w = el('a', 'btn linha', 'WhatsApp Web'); w.href = linkWhats(r.telefone, texto, true); w.target = '_blank'; w.rel = 'noopener';
    duas.appendChild(a); duas.appendChild(w); tela.appendChild(duas);
  }

  function carregar(){
    if(!/^[A-Za-z0-9_-]{1,64}$/.test(id)){ erro('Este link está incompleto. Abra a reserva pelo painel da Casa.'); return; }
    api('GET', '/api/admin/reservas/' + encodeURIComponent(id))
      .then(function(r){ mostrar(r.reserva); })
      .catch(function(e){
        if(e.status === 401) telaEntrar();
        else if(e.status === 403) telaSemAcesso();
        else erro(e.message);
      });
  }
  carregar();
})();
