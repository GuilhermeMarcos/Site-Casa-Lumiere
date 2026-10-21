/* Página de vendas: Assinatura Lumière */
(function(){
  /* ===== CONFIGURAÇÃO =====
     vsl: link de incorporação do vídeo (ex.: 'https://www.youtube.com/embed/CODIGO'). Vazio = o vídeo não aparece.
     checkoutProfissional / checkoutEstudante: links de pagamento de cada plano.
     Enquanto vazios, os botões dos planos levam para a página de contato do site. */
  var CONFIG = {
    vsl: '',
    checkoutProfissional: '',
    checkoutEstudante: ''
  };

  var d = document, html = d.documentElement;
  var calmo = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function guarda(fn){ try{ return fn(); }catch(e){ return null; } }

  /* Vídeo de vendas */
  var vsl = d.getElementById('vsl');
  if(vsl && CONFIG.vsl){
    var f = d.createElement('iframe');
    f.src = CONFIG.vsl; f.title = 'Vídeo de apresentação da Assinatura Lumière';
    f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; f.allowFullscreen = true; f.loading = 'lazy';
    vsl.appendChild(f); vsl.hidden = false;
  }

  /* Links de pagamento */
  [['checkout-profissional', CONFIG.checkoutProfissional], ['checkout-estudante', CONFIG.checkoutEstudante]].forEach(function(par){
    var a = d.getElementById(par[0]);
    if(a && par[1]){ a.href = par[1]; a.target = '_blank'; a.rel = 'noopener'; }
  });

  /* Lista "É pra você que": ao marcar a maioria, a frase da copy se acende */
  var caixas = d.querySelectorAll('.marcar input'), frase = d.getElementById('maioria-txt');
  function contar(){
    var n = 0; caixas.forEach(function(c){ if(c.checked) n++; });
    if(frase) frase.classList.toggle('ativa', n > caixas.length / 2);
  }
  caixas.forEach(function(c){ c.addEventListener('change', contar); });

  /* Revelar ao rolar */
  var obs = ('IntersectionObserver' in window && !calmo) ? new IntersectionObserver(function(entries){
    entries.forEach(function(en){ if(en.isIntersecting){ en.target.classList.remove('oculto'); en.target.classList.add('visivel'); obs.unobserve(en.target); } });
  }, {rootMargin:'0px 0px -10% 0px'}) : null;
  if(obs){
    d.querySelectorAll('.revelar').forEach(function(el){
      if(el.getBoundingClientRect().top < window.innerHeight * .92) return;
      el.classList.add('oculto');
      var p = el.parentElement;
      if(p && /fio|portas|duas|legenda/.test(p.className)) el.style.transitionDelay = (Array.prototype.indexOf.call(p.children, el) % 6 * 0.1) + 's';
      obs.observe(el);
    });
    var g = d.querySelector('.garantia');
    if(g) obs.observe(g);
  } else {
    var g2 = d.querySelector('.garantia'); if(g2) g2.classList.add('visivel');
  }

  /* Aviso de cookies */
  var cookies = d.getElementById('cookies');
  if(guarda(function(){ return localStorage.getItem('cl-cookies'); }) === 'ok') cookies.hidden = true;
  d.getElementById('cookies-ok').addEventListener('click', function(){
    cookies.hidden = true;
    guarda(function(){ localStorage.setItem('cl-cookies', 'ok'); });
  });
})();
