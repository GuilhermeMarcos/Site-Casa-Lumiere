/* Conta dentro do site: entrar, criar conta, perfil e acesso da equipe.
   Fala com a API (/api/auth/*). Outras páginas escutam o evento "cl-conta" e usam window.CLConta. */
(function(){
  var d = document, $ = function(id){ return d.getElementById(id); };
  var MONO = 'assets/img/monograma.webp';
  var WA_CASA = '5519992487347';
  var conta = null, carregada = false, ouvintes = [], emailAtivo = false;
  try{ var c0 = JSON.parse(localStorage.getItem('cl-conta') || 'null'); if(c0 && c0.nome) conta = c0; }catch(e){}

  function guardar(){
    try{
      if(conta){ localStorage.setItem('cl-conta', JSON.stringify({nome: conta.nome, equipe: conta.equipe})); localStorage.setItem('cl-ja-entrou', '1'); }
      else localStorage.removeItem('cl-conta');
    }catch(e){}
  }
  function primeiro(n){ return (n || '').trim().split(/\s+/)[0] || 'Você'; }
  function inicial(n){ return (n || '?').trim().charAt(0).toUpperCase() || '?'; }

  function api(metodo, caminho, corpo){
    return fetch(caminho, {
      method: metodo, credentials: 'same-origin',
      headers: corpo ? {'Content-Type': 'application/json'} : {},
      body: corpo ? JSON.stringify(corpo) : undefined
    }).then(function(r){
      return r.json().catch(function(){ return {}; }).then(function(dados){
        if(!r.ok){ var e = new Error(dados.mensagem || 'Não foi possível concluir agora. Tente de novo.'); e.status = r.status; e.erro = dados.erro; throw e; }
        return dados;
      });
    }, function(){ var e = new Error('Sem conexão com a internet. Confira e tente de novo.'); e.status = 0; throw e; });
  }

  function aviso(txt){
    var v = d.querySelector('.aviso-conta'); if(v) v.remove();
    var t = d.createElement('div'); t.className = 'aviso-conta'; t.setAttribute('role', 'status');
    var i = d.createElement('img'); i.src = MONO; i.alt = '';
    var s = d.createElement('span'); s.textContent = txt;
    t.appendChild(i); t.appendChild(s); d.body.appendChild(t);
    setTimeout(function(){ t.remove(); }, 4200);
  }

  function mudou(){
    guardar(); desenharTopo();
    var copia = conta ? Object.assign({}, conta) : null;
    ouvintes.forEach(function(fn){ try{ fn(copia); }catch(e){} });
    d.dispatchEvent(new CustomEvent('cl-conta', {detail: copia}));
  }

  /* ===== Topo e menu ===== */
  var topo = $('conta-topo'), menu = null;
  function fecharMenu(){ if(menu){ menu.remove(); menu = null; topo.setAttribute('aria-expanded', 'false'); } }
  function desenharTopo(){
    topo.textContent = '';
    if(conta){
      var av = d.createElement('span'); av.className = 'av'; av.textContent = inicial(conta.nome);
      var n = d.createElement('span'); n.className = 'nome-curto'; n.textContent = primeiro(conta.nome);
      topo.appendChild(av); topo.appendChild(n);
      topo.setAttribute('aria-label', 'Sua conta, ' + conta.nome);
      topo.setAttribute('aria-haspopup', 'menu');
    } else {
      topo.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM3.5 21a8.5 8.5 0 0 1 17 0"/></svg><span class="rot">Entrar</span>';
      topo.setAttribute('aria-label', 'Entrar ou criar conta');
      topo.removeAttribute('aria-haspopup');
    }
    var mm = $('conta-mm'); if(mm) mm.textContent = conta ? 'Minha conta' : 'Entrar ou criar conta';
  }
  topo.addEventListener('click', function(e){
    e.stopPropagation();
    if(!conta){ abrir('entrar'); return; }
    if(menu){ fecharMenu(); return; }
    menu = d.createElement('div'); menu.className = 'menu-conta'; menu.setAttribute('role', 'menu');
    var p = d.createElement('p'); var st = d.createElement('strong'); st.textContent = conta.nome; p.appendChild(st); p.appendChild(d.createTextNode(conta.email || '')); menu.appendChild(p);
    var itens = [['Minhas reservas', irMinhas], ['Minha conta', function(){ abrir('perfil'); }]];
    if(conta.equipe) itens.push(['Painel da Casa', function(){ location.href = 'painel.html'; }, 'Equipe']);
    itens.push(['Sair', sair]);
    itens.forEach(function(it){
      var b = d.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem');
      b.textContent = it[0]; if(it[0] === 'Sair') b.className = 'sair-conta';
      if(it[2]){ var s = d.createElement('small'); s.textContent = it[2]; b.appendChild(s); }
      b.addEventListener('click', function(){ fecharMenu(); it[1](); });
      menu.appendChild(b);
    });
    topo.closest('.barra').appendChild(menu);
    topo.setAttribute('aria-expanded', 'true');
    menu.querySelector('button').focus();
  });
  d.addEventListener('click', function(e){ if(menu && !menu.contains(e.target)) fecharMenu(); });
  var mm = $('conta-mm');
  if(mm) mm.addEventListener('click', function(){
    var f = $('menu-fechar'); if(f) f.click();
    abrir(conta ? 'perfil' : 'entrar');
  });

  /* ===== Gaveta ===== */
  var gaveta = $('gaveta'), fundo = $('fundo-conta'), ultimoFoco = null, depoisDeEntrar = null;
  var TEXTO_PADRAO = $('gaveta-texto').textContent;
  function abrir(modo, opcoes){
    opcoes = opcoes || {};
    ultimoFoco = d.activeElement;
    depoisDeEntrar = opcoes.depois || null;
    fundo.hidden = false; gaveta.hidden = false; d.body.style.overflow = 'hidden';
    $('gaveta-deslogado').hidden = !!conta;
    $('gaveta-logado').hidden = !conta;
    $('gaveta-texto').textContent = opcoes.motivo || TEXTO_PADRAO;
    limparMsgs();
    if(conta){
      $('pf-av').textContent = inicial(conta.nome); $('pf-nome').textContent = conta.nome; $('pf-email').textContent = conta.email || '';
      $('pf-equipe').hidden = !conta.equipe; $('pf-painel').hidden = !conta.equipe;
      $('p-nome').value = conta.nome || ''; $('p-tel').value = window.CLTelefone ? window.CLTelefone.formatar(conta.telefone || '') : (conta.telefone || ''); $('p-esp').value = conta.especialidade || '';
      $('p-atual').value = ''; $('p-nova').value = ''; $('p-senha').open = false;
      $('x-senha').value = ''; $('x-det').open = false; $('f-excluir').hidden = !!conta.equipe;
      $('gaveta-titulo').innerHTML = 'Minha <em>conta</em>';
    } else {
      $('gaveta-titulo').innerHTML = 'Sua <em>conta</em>';
      aba(modo === 'criar' ? 'criar' : 'entrar');
    }
    setTimeout(function(){ var c = gaveta.querySelector(conta ? '#p-nome' : (modo === 'criar' ? '#cr-nome' : '#e-email')); if(c) c.focus(); }, 60);
  }
  function fechar(){ fundo.hidden = true; gaveta.hidden = true; d.body.style.overflow = ''; depoisDeEntrar = null; if(ultimoFoco && ultimoFoco.focus) ultimoFoco.focus(); }
  $('fechar-gaveta').addEventListener('click', fechar);
  fundo.addEventListener('click', fechar);
  $('sem-conta').addEventListener('click', fechar);
  d.addEventListener('keydown', function(e){ if(e.key === 'Escape'){ if(!gaveta.hidden) fechar(); fecharMenu(); } });
  function aba(k){
    ['entrar', 'criar'].forEach(function(x){
      $('ab-' + x).setAttribute('aria-selected', x === k ? 'true' : 'false');
      $('f-' + x).hidden = x !== k;
    });
    $('f-esqueci').hidden = true;
    if(k === 'criar' && etapaCriar === 2 && !$('cr-cod').value) mudarEtapaCriar(1);
    d.querySelector('.gaveta-abas').hidden = false;
  }
  $('ab-entrar').addEventListener('click', function(){ aba('entrar'); });
  $('ab-criar').addEventListener('click', function(){ aba('criar'); });
  d.querySelectorAll('[data-ir-criar]').forEach(function(b){ b.addEventListener('click', function(){ aba('criar'); $('cr-nome').focus(); }); });
  d.querySelectorAll('[data-ir-entrar]').forEach(function(b){ b.addEventListener('click', function(){ aba('entrar'); $('e-email').focus(); }); });
  d.querySelectorAll('.c-campo .ver').forEach(function(b){
    b.addEventListener('click', function(){
      var i = $(b.getAttribute('aria-controls')), mostra = i.type === 'password';
      i.type = mostra ? 'text' : 'password'; b.textContent = mostra ? 'Ocultar' : 'Mostrar'; b.setAttribute('aria-pressed', mostra ? 'true' : 'false');
    });
  });
  $('esqueci').addEventListener('click', function(e){
    e.preventDefault();
    $('f-entrar').hidden = true; $('f-criar').hidden = true; $('f-esqueci').hidden = false;
    d.querySelector('.gaveta-abas').hidden = true;
    $('r-email').value = $('e-email').value; $('rc-email').value = $('e-email').value;
    var msg = 'Olá! Esqueci a senha da minha conta no site da Casa Lumière. Meu e-mail: ' + ($('e-email').value.trim() || '');
    $('esq-wa').href = linkWhats(window.CL_WA || WA_CASA, msg);
    $('esq-wa-web').href = linkWhats(window.CL_WA || WA_CASA, msg, true);
    /* Com o e-mail ligado, o código chega no e-mail; o WhatsApp fica como alternativa */
    $('f-recuperar').hidden = !emailAtivo;
    $('esq-txt-wa').textContent = emailAtivo ? 'Não recebeu o e-mail? Fale com a Casa:' : 'Fale com a Casa pelo WhatsApp. A equipe cria uma senha nova para você.';
    etapaRecuperar(1);
    (emailAtivo ? $('rc-email') : $('esq-wa')).focus();
  });
  function linkWhats(num, msg, web){
    return web ? 'https://web.whatsapp.com/send?phone=' + num + '&text=' + encodeURIComponent(msg) : 'https://wa.me/' + num + '?text=' + encodeURIComponent(msg);
  }

  /* ===== Mensagens dos formulários ===== */
  function limparMsgs(){
    gaveta.querySelectorAll('.msg, .msg-form').forEach(function(m){ m.hidden = true; m.textContent = ''; });
    gaveta.querySelectorAll('[aria-invalid]').forEach(function(i){ i.setAttribute('aria-invalid', 'false'); });
  }
  function checar(regras){
    var ok = true;
    regras.forEach(function(r){
      var campo = $(r[0]), m = $(r[0] + '-msg'), erro = r[1] ? '' : r[2];
      campo.setAttribute('aria-invalid', erro ? 'true' : 'false');
      if(m){ m.textContent = erro; m.hidden = !erro; }
      if(erro) ok = false;
    });
    return ok;
  }
  function msgForm(id, txt){ var m = $(id); m.textContent = txt; m.hidden = !txt; }
  function ocupado(form, sim, rotulo){
    var b = form.querySelector('button[type="submit"]');
    if(sim){ b.dataset.rotulo = b.textContent; b.textContent = rotulo; b.disabled = true; }
    else { b.textContent = b.dataset.rotulo || b.textContent; b.disabled = false; }
  }
  var emailOk = function(v){ return /\S+@\S+\.\S+/.test(v.trim()); };
  function entrou(c, txt){
    conta = c; mudou();
    var depois = depoisDeEntrar; fechar();
    aviso(txt);
    if(depois) setTimeout(depois, 50);
  }

  $('f-entrar').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('e-msg', '');
    var em = $('e-email').value, se = $('e-senha').value;
    if(!checar([['e-email', emailOk(em), 'Digite um e-mail válido.'], ['e-senha', !!se, 'Digite a sua senha.']])) return;
    var f = this; ocupado(f, true, 'Entrando…');
    api('POST', '/api/auth/entrar', {email: em.trim(), senha: se, lembrar: $('e-lembrar').checked}).then(function(r){
      ocupado(f, false); $('e-senha').value = '';
      entrou(r.conta, r.conta.equipe ? 'Você entrou como equipe da Casa. O painel está no menu da sua conta.' : 'Bem-vindo(a) de volta, ' + primeiro(r.conta.nome) + '.');
    }).catch(function(err){
      ocupado(f, false);
      /* Conta da equipe com verificação em duas etapas: o código do aplicativo é pedido no painel */
      if(err.erro === 'precisa_codigo' || err.erro === 'precisa_codigo_equipe'){ msgForm('e-msg', 'Conta da equipe: abrindo o painel para digitar o código…'); setTimeout(function(){ location.href = 'painel.html'; }, 1200); return; }
      msgForm('e-msg', err.message);
    });
  });

  /* ===== Código por e-mail ===== */
  function contarReenvio(botao){
    var s = 60, rot = 'Reenviar código';
    botao.disabled = true;
    (function passo(){ if(!botao.isConnected) return; if(s <= 0){ botao.disabled = false; botao.textContent = rot; return; } botao.textContent = rot + ' (' + s + 's)'; s--; setTimeout(passo, 1000); })();
  }
  function pedirCodigo(email, finalidade, botaoReenviar){
    return api('POST', '/api/auth/codigo', {email: email, finalidade: finalidade, site: $('cr-site') ? $('cr-site').value : ''}).then(function(){ contarReenvio(botaoReenviar); });
  }
  var etapaCriar = 1;
  function mudarEtapaCriar(n){
    etapaCriar = n;
    $('cr-etapa2').hidden = n !== 2;
    $('cr-email').readOnly = n === 2;
    $('f-criar').querySelector('button[type="submit"]').textContent = (n === 1 && emailAtivo) ? 'Enviar código para o e-mail' : 'Criar conta';
  }
  $('cr-trocar').addEventListener('click', function(){ mudarEtapaCriar(1); $('cr-cod').value = ''; $('cr-email').focus(); });
  $('cr-reenviar').addEventListener('click', function(){
    msgForm('cr-msg', '');
    pedirCodigo($('cr-email').value.trim(), 'cadastro', this).then(function(){ aviso('Código reenviado. Confira também o spam.'); }).catch(function(err){ msgForm('cr-msg', err.message); });
  });
  [$('cr-cod'), $('rc-cod')].forEach(function(i){ i.addEventListener('input', function(){ i.value = i.value.replace(/\D/g, '').slice(0, 6); }); });

  $('f-criar').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('cr-msg', '');
    var nome = $('cr-nome').value.trim(), em = $('cr-email').value, tel = $('cr-tel').value.trim(), se = $('cr-senha').value;
    var ok = checar([['cr-nome', nome.length >= 2, 'Digite o seu nome.'], ['cr-email', emailOk(em), 'Digite um e-mail válido.'], ['cr-tel', tel.replace(/\D/g, '').length >= 10, 'Digite o WhatsApp com DDD, como (19) 99999-9999.'], ['cr-senha', se.length >= 8, 'A senha precisa ter pelo menos 8 caracteres.']]);
    var aceite = $('cr-aceite').checked; $('cr-aceite-msg').hidden = aceite; if(!aceite) ok = false;
    if(!ok) return;
    var f = this;
    if(emailAtivo && etapaCriar === 1){
      ocupado(f, true, 'Enviando código…');
      pedirCodigo(em.trim(), 'cadastro', $('cr-reenviar')).then(function(){
        ocupado(f, false); mudarEtapaCriar(2);
        $('cr-enviado').textContent = 'Enviamos um código para ' + em.trim() + '. Ele vale por 10 minutos. Se não aparecer, confira o spam.';
        $('cr-cod').focus();
      }).catch(function(err){ ocupado(f, false); msgForm('cr-msg', err.message); });
      return;
    }
    if(emailAtivo && !checar([['cr-cod', $('cr-cod').value.length === 6, 'Digite os 6 números do e-mail.']])) return;
    ocupado(f, true, 'Criando conta…');
    var corpo = {nome: nome, email: em.trim(), telefone: tel, especialidade: $('cr-esp').value.trim(), senha: se, lembrar: true, codigo: $('cr-cod').value, site: $('cr-site') ? $('cr-site').value : ''};
    if(!$('cr-codigo-wrap').hidden) corpo.codigoEquipe = $('cr-codigo').value.trim();
    api('POST', '/api/auth/cadastro', corpo).then(function(r){
      ocupado(f, false); $('cr-senha').value = ''; $('cr-codigo').value = ''; $('cr-codigo-wrap').hidden = true; $('cr-cod').value = ''; mudarEtapaCriar(1);
      entrou(r.conta, r.conta.equipe ? 'Conta da equipe criada. O painel está no menu da sua conta.' : 'Conta criada. Bem-vindo(a), ' + primeiro(r.conta.nome) + '.');
    }).catch(function(err){
      ocupado(f, false);
      if(err.erro === 'codigo_equipe'){ $('cr-codigo-wrap').hidden = false; $('cr-codigo').focus(); msgForm('cr-codigo-msg', err.message); return; }
      if(err.erro === 'email_existe'){ mudarEtapaCriar(1); checar([['cr-email', false, err.message]]); return; }
      if(err.erro === 'codigo_errado'){ checar([['cr-cod', false, err.message]]); $('cr-cod').select(); return; }
      if(err.erro === 'codigo_vencido'){ $('cr-cod').value = ''; checar([['cr-cod', false, err.message]]); return; }
      msgForm('cr-msg', err.message);
    });
  });

  /* Recuperar a senha pelo código do e-mail */
  var etapaRec = 1;
  function etapaRecuperar(n){
    etapaRec = n;
    $('rc-etapa2').hidden = n !== 2;
    $('rc-email').readOnly = n === 2;
    $('f-recuperar').querySelector('button[type="submit"]').textContent = n === 1 ? 'Enviar código' : 'Salvar senha nova';
    if(n === 1){ $('rc-cod').value = ''; $('rc-nova').value = ''; }
  }
  $('rc-reenviar').addEventListener('click', function(){
    msgForm('rc-msg', '');
    pedirCodigo($('rc-email').value.trim(), 'senha', this).then(function(){ aviso('Código reenviado. Confira também o spam.'); }).catch(function(err){ msgForm('rc-msg', err.message); });
  });
  $('f-recuperar').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('rc-msg', '');
    var f = this, em = $('rc-email').value.trim();
    if(etapaRec === 1){
      if(!checar([['rc-email', emailOk(em), 'Digite o e-mail da sua conta.']])) return;
      ocupado(f, true, 'Enviando código…');
      pedirCodigo(em, 'senha', $('rc-reenviar')).then(function(){
        ocupado(f, false); etapaRecuperar(2);
        $('rc-enviado').textContent = 'Se existir uma conta com ' + em + ', o código chega em instantes. Ele vale por 10 minutos. Confira também o spam.';
        $('rc-cod').focus();
      }).catch(function(err){ ocupado(f, false); msgForm('rc-msg', err.message); });
      return;
    }
    var cod = $('rc-cod').value, nova = $('rc-nova').value;
    if(!checar([['rc-cod', cod.length === 6, 'Digite os 6 números do e-mail.'], ['rc-nova', nova.length >= 8, 'A senha nova precisa ter pelo menos 8 caracteres.']])) return;
    ocupado(f, true, 'Salvando…');
    api('POST', '/api/auth/recuperar', {email: em, codigo: cod, senhaNova: nova}).then(function(r){
      ocupado(f, false); etapaRecuperar(1);
      entrou(r.conta, 'Senha nova salva. Você já está na sua conta.');
    }).catch(function(err){
      ocupado(f, false);
      if(err.erro === 'codigo_errado'){ checar([['rc-cod', false, err.message]]); return; }
      if(err.erro === 'codigo_vencido'){ etapaRecuperar(1); msgForm('rc-msg', err.message); return; }
      msgForm('rc-msg', err.message);
    });
  });

  $('f-equipe-senha').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('r-msg', '');
    var em = $('r-email').value, cod = $('r-codigo').value.trim(), nova = $('r-nova').value;
    if(!checar([['r-email', emailOk(em), 'Digite o e-mail da equipe.'], ['r-codigo', !!cod, 'Digite o código da equipe.'], ['r-nova', nova.length >= 12, 'A senha da equipe precisa ter pelo menos 12 caracteres.']])) return;
    var f = this; ocupado(f, true, 'Salvando…');
    api('POST', '/api/auth/redefinir-equipe', {email: em.trim(), codigo: cod, senhaNova: nova}).then(function(){
      ocupado(f, false); $('r-codigo').value = ''; $('r-nova').value = '';
      aba('entrar'); $('e-email').value = em.trim(); $('e-senha').focus();
      aviso('Senha nova criada. Agora é só entrar.');
    }).catch(function(err){ ocupado(f, false); msgForm('r-msg', err.message); });
  });

  $('f-perfil').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('p-msg', '');
    var corpo = {nome: $('p-nome').value.trim(), telefone: $('p-tel').value.trim(), especialidade: $('p-esp').value.trim()};
    if(!checar([['p-nome', corpo.nome.length >= 2, 'Digite o seu nome.'], ['p-tel', corpo.telefone.replace(/\D/g, '').length >= 10, 'Digite o WhatsApp com DDD, como (19) 99999-9999.']])) return;
    if($('p-nova').value){
      if($('p-nova').value.length < 8){ checar([['p-nova', false, 'A senha nova precisa ter pelo menos 8 caracteres.']]); return; }
      corpo.senhaAtual = $('p-atual').value; corpo.senhaNova = $('p-nova').value;
    }
    var f = this; ocupado(f, true, 'Salvando…');
    api('PATCH', '/api/auth/eu', corpo).then(function(r){
      ocupado(f, false); conta = r.conta; mudou(); fechar(); aviso(corpo.senhaNova ? 'Dados e senha atualizados.' : 'Dados atualizados.');
    }).catch(function(err){ ocupado(f, false); msgForm('p-msg', err.message); });
  });
  $('p-sair').addEventListener('click', function(){ fechar(); sair(); });

  /* Excluir a própria conta (LGPD) */
  $('f-excluir').addEventListener('submit', function(e){
    e.preventDefault(); msgForm('x-msg', '');
    var se = $('x-senha').value;
    if(!checar([['x-senha', !!se, 'Digite a sua senha para confirmar.']])) return;
    var f = this, b = f.querySelector('button[type="submit"]');
    if(!b.dataset.confirma){ b.dataset.confirma = '1'; b.textContent = 'Toque de novo para excluir'; return; }
    ocupado(f, true, 'Excluindo…');
    api('POST', '/api/auth/excluir', {senha: se}).then(function(){
      ocupado(f, false); delete b.dataset.confirma; b.textContent = 'Excluir minha conta'; $('x-senha').value = '';
      conta = null; try{ localStorage.removeItem('cl-ja-entrou'); }catch(er){}
      mudou(); fechar(); aviso('Sua conta foi excluída.');
    }).catch(function(err){ ocupado(f, false); delete b.dataset.confirma; b.textContent = 'Excluir minha conta'; msgForm('x-msg', err.message); });
  });
  function sair(){
    api('POST', '/api/auth/sair').catch(function(){}).then(function(){ conta = null; mudou(); aviso('Você saiu da sua conta.'); });
  }

  function irMinhas(){
    var a = $('aba-minhas');
    if(a){ a.click(); a.scrollIntoView({behavior: 'smooth', block: 'center'}); }
    else { window.location.href = 'salas.html#minhas'; }
  }
  if(location.hash === '#minhas'){ var am = $('aba-minhas'); if(am){ am.click(); setTimeout(function(){ am.scrollIntoView({block: 'center'}); }, 100); } }

  /* ===== Para as outras páginas ===== */
  window.CLConta = {
    atual: function(){ return conta ? Object.assign({}, conta) : null; },
    carregada: function(){ return carregada; },
    abrir: abrir,
    aoMudar: function(fn){ ouvintes.push(fn); },
    api: api,
    aviso: aviso
  };

  desenharTopo();
  api('GET', '/api/auth/eu').then(function(r){ conta = r.conta; emailAtivo = !!r.emailAtivo; mudarEtapaCriar(1); }).catch(function(){ /* sem API: segue sem conta */ conta = null; })
    .then(function(){ carregada = true; mudou(); });
})();
