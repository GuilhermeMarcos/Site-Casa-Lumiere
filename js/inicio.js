/* Roda antes de desenhar a página: marca que tem JS e se é a primeira visita (para a abertura só aparecer na entrada) */
(function(){var d=document.documentElement;d.classList.add('js');try{if(!sessionStorage.getItem('cl-visitou')){d.classList.add('primeira')}sessionStorage.setItem('cl-visitou','1')}catch(e){}})();
