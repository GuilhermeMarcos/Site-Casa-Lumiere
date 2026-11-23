/* Profissionais cadastrados pela equipe no painel.
   A página já vem com a lista escrita no HTML (para quem não tem JavaScript e para o Google);
   quando a API responde, a lista é trocada pela do painel. Usado em profissionais.html e na galeria do início. */
(function(){
  var d = document;
  var lista = d.querySelector('ul.gente'), galeria = d.querySelector('ul.galeria');
  if(!lista && !galeria) return;
  var WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5C6.5 2.5 2.2 6.4 2.2 11.2c0 2.6 1.2 4.9 3.2 6.5L4.5 21.5l4.4-2.2c1 .3 2 .4 3.1.4 5.5 0 9.8-3.9 9.8-8.6S17.5 2.5 12 2.5zm-4 10.1a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm4 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z"/></svg>';

  function el(tag, cls, txt){ var e = d.createElement(tag); if(cls) e.className = cls; if(txt != null) e.textContent = txt; return e; }
  function rotulo(p){ return p.nome + (p.especialidade ? ', ' + p.especialidade : '') + ' na Casa Lumière'; }
  function foto(p, arco){
    var img = el('img'); img.width = 560; img.height = 700; img.loading = 'lazy'; img.decoding = 'async';
    if(p.foto){ img.src = p.foto; img.alt = rotulo(p); }
    else { img.src = 'assets/img/monograma.webp'; img.alt = ''; arco.classList.add('vazio'); }
    arco.appendChild(img);
  }
  function linkWhats(p){
    var msg = 'Olá! Vim pelo site da Casa Lumière e gostaria de agendar um atendimento com ' + p.nome + '.';
    var n = String(p.whatsapp || '').replace(/\D/g, '');
    if(!n) return null;
    if(n.length <= 11) n = '55' + n;
    return 'https://wa.me/' + n + '?text=' + encodeURIComponent(msg);
  }

  function montarLista(ps){
    lista.textContent = '';
    if(!ps.length){ var v = el('li', 'vazio-lista'); v.appendChild(el('p', 'small', 'Em breve, a equipe da Casa aparece aqui.')); lista.appendChild(v); return; }
    ps.forEach(function(p){
      var li = el('li');
      var arco = el('div', 'arco'); foto(p, arco); li.appendChild(arco);
      var info = el('div', 'pessoa-info');
      info.appendChild(el('h3', null, p.nome));
      if(p.especialidade) info.appendChild(el('p', 'esp', p.especialidade));
      if(p.registro) info.appendChild(el('p', 'small', p.registro));
      li.appendChild(info);
      if(p.credito) li.appendChild(el('p', 'credito', p.credito));
      var a = el('a', 'btn'); a.innerHTML = WA; a.appendChild(d.createTextNode('Falar no WhatsApp'));
      var w = linkWhats(p);
      if(w){ a.href = w; a.target = '_blank'; a.rel = 'noopener'; } else a.href = 'contato.html';
      li.appendChild(a);
      lista.appendChild(li);
    });
    dadosEstruturados(ps);
  }
  function montarGaleria(ps){
    if(!ps.length){ galeria.hidden = true; return; }
    galeria.hidden = false; galeria.textContent = '';
    ps.slice(0, 4).forEach(function(p){
      var li = el('li');
      var a = el('a', 'arco'); a.href = 'profissionais.html'; foto(p, a); li.appendChild(a);
      var n = el('p', 'g-nome'); n.appendChild(el('strong', null, p.nome)); if(p.especialidade) n.appendChild(el('span', null, p.especialidade));
      li.appendChild(n); galeria.appendChild(li);
    });
  }
  /* Mantém os dados para o Google iguais à lista que aparece na página */
  function dadosEstruturados(ps){
    try {
      var s = d.querySelector('script[type="application/ld+json"]'); if(!s) return;
      var dados = JSON.parse(s.textContent);
      var item = (Array.isArray(dados) ? dados : [dados]).filter(function(x){ return x['@type'] === 'ItemList'; })[0];
      if(!item) return;
      var org = {'@id': 'https://casalumiere.com.br/#casa-lumiere', '@type': 'HealthAndBeautyBusiness', name: 'Casa Lumière'};
      item.itemListElement = ps.map(function(p, i){
        var pessoa = {'@type': 'Person', name: p.nome, worksFor: org};
        if(p.especialidade) pessoa.jobTitle = p.especialidade;
        if(p.foto) pessoa.image = new URL(p.foto, location.origin).href;
        return {'@type': 'ListItem', position: i + 1, item: pessoa};
      });
      s.textContent = JSON.stringify(dados);
    } catch(e){}
  }

  fetch('/api/profissionais', {credentials: 'same-origin'})
    .then(function(r){ return r.ok ? r.json() : null; })
    .then(function(r){
      if(!r || !Array.isArray(r.profissionais)) return; /* sem resposta: fica a lista escrita na página */
      if(lista) montarLista(r.profissionais);
      if(galeria) montarGaleria(r.profissionais);
    })
    .catch(function(){});
})();
