/* Casa Lumière */
(function(){
  /* ===== CONFIGURAÇÃO =====
     whatsapp: o número que o site usa enquanto carrega. O número que vale é o do painel
     (Funcionamento, "WhatsApp que recebe as mensagens"), lido logo em seguida em /api/contato.
     assinatura: link externo da Assinatura Lumière. */
  var CONFIG = {
    whatsapp: '5519992487347',
    assinatura: '',
    email: 'acasalumiere@gmail.com'
  };

  var d = document, html = d.documentElement;
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function guarda(fn){ try{ return fn(); }catch(e){ return null; } }

  /* Links de WhatsApp e da Assinatura */
  function numeroWhats(){ var n = String(CONFIG.whatsapp || '').replace(/\D/g, ''); return n && n.length <= 11 ? '55' + n : n; }
  function linkWhats(msg, web){
    var texto = encodeURIComponent(msg || 'Olá! Vim pelo site da Casa Lumière.');
    return web ? 'https://web.whatsapp.com/send?phone=' + numeroWhats() + '&text=' + texto : 'https://wa.me/' + numeroWhats() + '?text=' + texto;
  }
  function ligarBotoesWhats(){
    d.querySelectorAll('[data-wa]').forEach(function(a){
      if(!CONFIG.whatsapp) return;
      a.href = linkWhats(a.getAttribute('data-wa'));
      a.target = '_blank'; a.rel = 'noopener';
    });
  }
  ligarBotoesWhats();
  /* Se a equipe trocar o número no painel, o site inteiro passa a usar o novo */
  if(d.querySelector('[data-wa], #form-contato')){
    fetch('/api/contato', {credentials: 'same-origin'}).then(function(r){ return r.ok ? r.json() : null; }).then(function(r){
      if(r && r.whatsapp && r.whatsapp !== CONFIG.whatsapp){ CONFIG.whatsapp = r.whatsapp; window.CL_WA = numeroWhats(); ligarBotoesWhats(); }
    }).catch(function(){});
  }
  d.querySelectorAll('[data-assinatura]').forEach(function(a){
    if(!CONFIG.assinatura) return;
    a.href = CONFIG.assinatura; a.target = '_blank'; a.rel = 'noopener';
  });

  /* Botão flutuante aparece depois da abertura */
  function aoRolar(){ html.classList.toggle('passou', window.scrollY > window.innerHeight * .6); }
  window.addEventListener('scroll', aoRolar, {passive:true});
  aoRolar();

  /* Menu no celular */
  var mm = d.getElementById('menu-movel'), mb = d.getElementById('menu-btn'), mf = d.getElementById('menu-fechar');
  function abrirMenu(){ mm.hidden = false; mb.setAttribute('aria-expanded','true'); d.body.style.overflow = 'hidden'; mf.focus(); }
  function fecharMenu(foco){ if(mm.hidden) return; mm.hidden = true; mb.setAttribute('aria-expanded','false'); d.body.style.overflow = ''; if(foco) mb.focus(); }
  mb.addEventListener('click', abrirMenu);
  mf.addEventListener('click', function(){ fecharMenu(true); });
  d.addEventListener('keydown', function(e){ if(e.key === 'Escape') fecharMenu(true); });

  /* Revelar ao rolar */
  var obs = ('IntersectionObserver' in window && !calmo) ? new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.remove('oculto'); obs.unobserve(en.target); } });
  }, {rootMargin:'0px 0px -8% 0px'}) : null;
  if(obs){
    var chegando = html.classList.contains('chegando'), k = 0;
    d.querySelectorAll('.revelar').forEach(function(el){
      var naTela = el.getBoundingClientRect().top < window.innerHeight * .92;
      if(naTela && !chegando) return;
      el.classList.add('oculto');
      if(naTela){ el.style.transitionDelay = (0.35 + k++ * 0.14) + 's'; }
      else {
        var p = el.parentElement;
        if(p && /galeria|gente|cuidado/.test(p.className)) el.style.transitionDelay = (Array.prototype.indexOf.call(p.children, el) * 0.12) + 's';
      }
      obs.observe(el);
    });
  }

  /* A casa que acende: cada cômodo lido acende uma janela */
  var fachada = d.querySelector('.fachada');
  if(fachada){
    var janelas = fachada.querySelectorAll('.janela');
    var comodos = d.querySelectorAll('.comodo');
    var acesas = -1;
    function acender(i){
      comodos.forEach(function(c, k){ c.classList.toggle('ativo', k === i); if(k <= i) c.classList.add('visto'); });
      if(i <= acesas) return;
      acesas = i;
      janelas.forEach(function(w, k){ if(k <= i) w.classList.add('acesa'); });
      if(i >= janelas.length - 1) fachada.classList.add('inteira');
    }
    if(calmo || !('IntersectionObserver' in window)){ acender(comodos.length - 1); }
    else {
      var oc = new IntersectionObserver(function(entries){
        entries.forEach(function(en){ if(en.isIntersecting) acender(+en.target.getAttribute('data-janela')); });
      }, {rootMargin:'-42% 0px -42% 0px'});
      comodos.forEach(function(c){ oc.observe(c); });
    }
  }

  /* Luz que acompanha o cursor */
  if(!calmo && window.matchMedia && window.matchMedia('(hover: hover)').matches){
    d.querySelectorAll('.luz-segue').forEach(function(sec){
      var pend = null;
      sec.addEventListener('pointermove', function(e){
        if(pend) return;
        pend = requestAnimationFrame(function(){
          var r = sec.getBoundingClientRect();
          sec.style.setProperty('--mx', (e.clientX - r.left) + 'px');
          sec.style.setProperty('--my', (e.clientY - r.top) + 'px');
          sec.classList.add('seguindo'); pend = null;
        });
      });
      sec.addEventListener('pointerleave', function(){ sec.classList.remove('seguindo'); });
    });
  }

  /* Formulário de contato: monta a mensagem e envia pelo WhatsApp (ou e-mail) */
  var form = d.getElementById('form-contato');
  if(form){
    var retorno = d.getElementById('c-retorno');
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var nome = form.nome.value.trim(), fone = form.telefone.value.trim(), msg = form.mensagem.value.trim();
      retorno.hidden = false;
      if(!nome || !fone || !msg){ retorno.textContent = 'Preencha nome, WhatsApp e mensagem para enviar.'; return; }
      var dig = fone.replace(/\D/g, '').replace(/^0+/, ''); if(dig.length > 11 && dig.indexOf('55') === 0) dig = dig.slice(2);
      if(dig.length < 10 || dig.length > 11){ retorno.textContent = 'Digite o WhatsApp com DDD, como (19) 99999-9999.'; form.telefone.focus(); return; }
      if(!form.aceite.checked){ retorno.textContent = 'Marque a caixa de concordância com os Termos e a Política de Privacidade.'; return; }
      var texto = 'Olá! Sou ' + nome + ' (' + fone + ').\n\n' + msg;
      /* A mensagem vai pronta para o WhatsApp da Casa: no aplicativo ou no WhatsApp Web (computador) */
      retorno.textContent = '';
      retorno.appendChild(d.createTextNode('Sua mensagem está pronta. Escolha por onde enviar e toque em enviar no WhatsApp:'));
      var duas = d.createElement('div'); duas.className = 'duas-wa-contato';
      [['WhatsApp', false, 'btn'], ['WhatsApp Web', true, 'btn btn-line']].forEach(function(o){
        var a = d.createElement('a'); a.className = o[2]; a.href = linkWhats(texto, o[1]); a.target = '_blank'; a.rel = 'noopener'; a.textContent = o[0];
        duas.appendChild(a);
      });
      retorno.appendChild(duas);
      var alt = d.createElement('p'); alt.className = 'alt-email';
      var em = d.createElement('a'); em.href = 'mailto:' + CONFIG.email + '?subject=' + encodeURIComponent('Contato pelo site') + '&body=' + encodeURIComponent(texto); em.textContent = 'enviar por e-mail';
      alt.appendChild(d.createTextNode('Prefere e-mail? Toque para ')); alt.appendChild(em); alt.appendChild(d.createTextNode('.'));
      retorno.appendChild(alt);
      duas.firstChild.focus();
    });
  }

  /* Aviso de cookies: o botão flutuante sobe para não ficar atrás dele */
  var cookies = d.getElementById('cookies');
  function medirCookies(){ html.style.setProperty('--cookie-h', cookies.hidden ? '0px' : cookies.offsetHeight + 'px'); }
  if(guarda(function(){ return localStorage.getItem('cl-cookies'); }) === 'ok') cookies.hidden = true;
  d.getElementById('cookies-ok').addEventListener('click', function(){
    cookies.hidden = true; medirCookies();
    guarda(function(){ localStorage.setItem('cl-cookies', 'ok'); });
  });
  window.addEventListener('resize', medirCookies);
  medirCookies();
})();
