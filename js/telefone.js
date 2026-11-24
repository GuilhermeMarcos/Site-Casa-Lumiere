/* Campos de telefone com o mesmo padrão em todo o site e no painel:
   WhatsApp com DDD no formato (19) 99999-9999, formatado enquanto a pessoa digita.
   Vale para qualquer <input type="tel">, inclusive os criados depois (painel, janelas). */
(function(){
  var d = document;
  var PADRAO = '(19) 99999-9999';

  function digitos(v){
    var n = String(v || '').replace(/\D/g, '').replace(/^0+/, ''); /* DDD nunca começa com 0 (ex.: 019) */
    if(n.length > 11 && n.indexOf('55') === 0) n = n.slice(2); /* colou com +55 na frente */
    return n.slice(0, 11);
  }
  function formatar(n){
    if(!n) return '';
    if(n.length <= 2) return '(' + n;
    var ddd = '(' + n.slice(0, 2) + ') ', resto = n.slice(2);
    if(resto.length <= 4) return ddd + resto;
    var corte = resto.length === 9 ? 5 : 4; /* celular: 5 + 4; fixo: 4 + 4 */
    return ddd + resto.slice(0, corte) + (resto.length > corte ? '-' + resto.slice(corte, corte + 4) : '');
  }
  function preparar(el){
    if(el.dataset.telPadrao) return;
    el.dataset.telPadrao = '1';
    if(!el.placeholder) el.placeholder = PADRAO;
    el.setAttribute('inputmode', 'tel');
    if(!el.getAttribute('autocomplete')) el.setAttribute('autocomplete', 'tel');
    /* sem maxlength: quem cola "+55 (19) 99999-9999" precisa caber; o limite de 11 números é da formatação */
    if(el.value) el.value = formatar(digitos(el.value));
  }
  function aoDigitar(el){
    var antes = el.value, pos = el.selectionStart == null ? antes.length : el.selectionStart;
    var digAntes = antes.slice(0, pos).replace(/\D/g, '').length; /* quantos números ficam antes do cursor */
    var novo = formatar(digitos(antes));
    if(novo === antes) return;
    el.value = novo;
    var i = 0, vistos = 0;
    while(i < novo.length && vistos < digAntes){ if(/\d/.test(novo[i])) vistos++; i++; }
    try { el.setSelectionRange(i, i); } catch(e){}
  }
  function ehTel(el){ return el && el.tagName === 'INPUT' && el.type === 'tel'; }

  d.addEventListener('focusin', function(e){ if(ehTel(e.target)) preparar(e.target); });
  d.addEventListener('input', function(e){
    if(!ehTel(e.target)) return;
    preparar(e.target);
    if(e.inputType && e.inputType.indexOf('delete') === 0 && /[\s()-]$/.test(e.target.value)) return; /* deixa apagar o hífen/parêntese */
    aoDigitar(e.target);
  });
  function todos(){ d.querySelectorAll('input[type="tel"]').forEach(preparar); }
  if(d.readyState === 'loading') d.addEventListener('DOMContentLoaded', todos); else todos();
  /* Valores preenchidos depois pelo próprio site (ex.: "Minha conta") também ficam no padrão */
  new MutationObserver(function(){ d.querySelectorAll('input[type="tel"]:not([data-tel-padrao])').forEach(preparar); })
    .observe(d.documentElement, {childList: true, subtree: true});
  window.CLTelefone = { formatar: function(v){ return formatar(digitos(v)); }, valido: function(v){ var n = digitos(v); return n.length === 10 || n.length === 11; } };
})();
