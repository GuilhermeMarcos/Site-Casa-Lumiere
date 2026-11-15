# Segurança do site da Casa Lumière

Revisão feita em 14/11/2026. Os ataques abaixo são testados automaticamente em `dev/ataques.mjs` (`npm test`).

## O que o sistema faz para se proteger

| Risco | Proteção |
|---|---|
| Roubo de senha do banco | Senhas guardadas só como hash scrypt com sal. Nem a equipe nem quem acessar o banco vê a senha. |
| Senha fácil | Mínimo de 8 caracteres, sem senhas comuns (12345678, senha123...) e sem usar o próprio e-mail. |
| Força bruta (chutar senhas) | 8 erros no mesmo e-mail travam por 15 minutos naquele aparelho. Cada IP tem limite de 40 tentativas de login a cada 15 minutos. |
| Trancar a conta da equipe de propósito | A trava é por e-mail e IP: quem erra de outro lugar não tranca a Luiza e a Agatha. |
| Descobrir quem tem conta | Login responde igual e no mesmo tempo para e-mail que existe ou não. |
| Contas e pré-reservas em massa | 10 contas por IP por hora, 20 pré-reservas por IP por hora, 3 pré-reservas abertas por conta. |
| Sessão roubada | Cookie HttpOnly (o JavaScript da página não lê), Secure e SameSite. Trocar ou redefinir a senha desconecta todos os outros aparelhos. |
| Cookie falsificado | Sessão assinada com HMAC SHA-256 usando o `JWT_SECRET`. Qualquer alteração invalida. |
| Cliente entrar no painel | Toda rota da equipe confere no servidor se o e-mail da sessão é o `ADMIN_EMAIL`. Esconder o botão não é a proteção; o servidor é. |
| Criar conta com o e-mail da equipe | Exige o `CODIGO_EQUIPE`, com trava de tentativas. |
| Injeção de SQL | Todas as consultas usam parâmetros (`$1, $2...`). Texto digitado nunca vira comando. |
| XSS (código malicioso no nome) | Tudo o que alguém digita é mostrado como texto (`textContent`). A política de conteúdo (CSP) bloqueia scripts de fora. |
| Pedido falso de outro site (CSRF) | Cookie SameSite, conferência da origem e exigência de JSON nas alterações. |
| Ver ou cancelar reserva de outra pessoa | O servidor só mostra e cancela reservas da própria conta. |
| Vazamento pela agenda pública | A agenda pública mostra só "ocupado", sem nome, telefone ou e-mail. |
| Arquivo disfarçado de foto | O servidor confere os primeiros bytes: só aceita JPG, PNG e WebP de verdade, até 3 MB. |
| Site dentro de outro site (clickjacking) | `X-Frame-Options` e `frame-ancestors`. |
| Conexão sem cadeado | HSTS: o navegador só usa HTTPS. |
| Bibliotecas com falha conhecida | `npm audit` sem vulnerabilidades. |
| Chaves no GitHub | Nenhuma chave no repositório nem no histórico. Elas ficam só nas variáveis da Vercel. |
| Conta com e-mail de outra pessoa | Com o e-mail configurado, a conta só é criada depois de digitar o código de 6 números que chegou no e-mail. |
| Recuperar senha | Código de 6 números por e-mail: guardado só como hash, vale 10 minutos, 5 tentativas, uso único. Pedidos limitados por e-mail e por IP. A resposta é a mesma exista conta ou não. |
| Mudar o preço pelo navegador | O valor da reserva é calculado no servidor pela tabela da sala. Valor, desconto ou parceria enviados pelo navegador são ignorados. |
| Ganhar desconto de parceiro sem ser | A parceria é ligada ao e-mail e só vale se a conta tiver o e-mail confirmado por código ou for conferida pela equipe no painel. Se a conta for apagada e outra pessoa criar uma nova com o mesmo e-mail, a conferência antiga não passa para ela. |
| Ver o extrato de outro parceiro | Cada parceiro vê só o próprio extrato; cadastrar parceiro, lançar atendimento e dar baixa é só da equipe. |
| Alterar o histórico de repasses | A porcentagem fica gravada em cada lançamento; mudar a parceria depois não altera o que já foi lançado. Parceiro com lançamentos não é apagado, só desativado. |
| LGPD | O cliente pode excluir a própria conta. Pré-reservas abertas somem junto. |

## O que depende de você (e é onde a maioria dos ataques acontece)

1. **Verificação em duas etapas** no GitHub, na Vercel, na Neon e no Gmail da Casa (acasalumiere@gmail.com). Quem entra nessas contas entra em tudo.
2. **Senha de app do Gmail** (`GMAIL_SENHA_APP`) só na Vercel. Se vazar, apague em myaccount.google.com/apppasswords e crie outra.
3. **`JWT_SECRET` longo e aleatório** (pelo menos 32 caracteres) e **`CODIGO_EQUIPE` difícil** (não use "lumiere", que é só o código de teste local que está público neste repositório).
4. **Senha forte e única** para a conta da equipe no site, guardada num gerenciador de senhas.
5. **Não mande chaves por WhatsApp ou print.** Se uma vazar, troque na Vercel e faça Redeploy. Trocar o `JWT_SECRET` desconecta todo mundo, o que é bom nesse caso.
6. **Repositório privado** (opcional): o código não tem segredos, mas deixar privado esconde detalhes de como o sistema funciona.
7. **Mantenha as dependências em dia**: rode `npm audit` de vez em quando.

## Limites honestos

Nenhum sistema é 100% invulnerável. Estas proteções cobrem os ataques mais comuns em sites como este (lista OWASP Top 10). Não houve um teste de invasão feito por uma empresa especializada. Se um dia o site passar a receber pagamento ou dados de saúde de pacientes, vale contratar esse teste.
