# Casa Lumière: sistema de aluguel de salas

Documento vivo do projeto. Registra o que foi levantado com a Casa, o que entra no MVP e como o trabalho está dividido em sprints.

## 1. Levantamento de requisitos

Respostas da Casa (13/11/2026). A pergunta 3 ainda não foi respondida.

| Pergunta | Resposta |
|---|---|
| A pré-reserva expira se a Agatha não confirmar? | Sim, depois de 1h30 o horário volta a ficar livre. |
| Precisa de conta para reservar? | Sim, só reserva quem tem conta. Navegar pelo site continua livre. |
| O cliente pode cancelar sozinho? | Sem resposta ainda. Decisão provisória: o cliente cancela a própria pré-reserva pelo site; reserva já confirmada se cancela falando com a Agatha. |
| Quem usa o painel além da Agatha? | A Luiza. As duas usam um único e-mail de equipe, com o mesmo acesso. |
| O valor por hora aparece no site? | Não. O valor é combinado no WhatsApp. No painel ele fica só como referência interna. |

### Requisitos funcionais

- RF01. Qualquer pessoa vê as salas, as fotos e a agenda de horários livres.
- RF02. A pessoa cria conta (nome, e-mail, WhatsApp, especialidade opcional, senha) e entra com e-mail e senha.
- RF03. Com conta, a pessoa escolhe sala, dia e uma ou mais horas e faz a pré-reserva.
- RF04. Depois da pré-reserva, o site abre a mensagem pronta para a Agatha no WhatsApp (WhatsApp Web no computador, aplicativo no celular).
- RF05. A pré-reserva expira em 1h30 se não for confirmada, e o horário volta a ficar livre.
- RF06. A pessoa vê as próprias reservas e cancela uma pré-reserva.
- RF07. A equipe (Agatha e Luiza, com um e-mail único) entra no painel, vê "Olá, nome" e confirma ou recusa pré-reservas.
- RF08. A equipe cria e edita reservas feitas por fora do site (telefone, WhatsApp).
- RF09. A equipe altera salas (nome, tipo, descrição, foto, disponível ou não, valor de referência).
- RF10. A equipe cadastra e remove horários fixos (semanal, a cada 15 dias, uma vez).
- RF11. A equipe altera o funcionamento (horário, dias abertos, antecedência, WhatsApp que recebe as pré-reservas).

### Requisitos não funcionais

- RNF01. Dois clientes nunca conseguem reservar o mesmo horário da mesma sala (garantido pelo banco).
- RNF02. Senhas guardadas com hash (scrypt); sessão em cookie HttpOnly.
- RNF03. Só o e-mail da equipe (variável `ADMIN_EMAIL`) acessa o painel, e criar a conta da equipe ou trocar a senha dela exige o código da equipe (`CODIGO_EQUIPE`).
- RNF04. Bloqueio de 15 minutos depois de 8 tentativas de senha erradas no mesmo e-mail.
- RNF05. Hospedagem na Vercel; banco Postgres (Neon); fotos no Vercel Blob.
- RNF06. O site mantém a identidade visual, o SEO e a responsividade que já tem.

## 2. MVP

Entra no MVP: RF01 a RF11, RNF01 a RNF06.

Fica fora do MVP: pagamento pelo site, recuperação de senha por e-mail, aviso automático por e-mail ou WhatsApp, relatórios.

Regras extras do MVP: cada conta pode ter até 3 pré-reservas esperando confirmação ao mesmo tempo; a agenda se atualiza sozinha a cada minuto no site e a cada 30 segundos no painel.

## 3. Sprints e backlog

### Sprint 1 (MVP, feita)

- [x] Banco de dados e criação automática das tabelas
- [x] Cadastro, login, sessão e perfil
- [x] Agenda pública e pré-reserva com trava de horário
- [x] Expiração da pré-reserva em 1h30
- [x] Minhas reservas e cancelamento da pré-reserva
- [x] Painel da equipe: reservas, salas, fotos, horários fixos e funcionamento
- [x] Primeiro acesso da equipe com código
- [x] A equipe cria uma senha nova para o cliente que esqueceu (pelo painel)
- [x] A equipe troca a própria senha com o código da equipe
- [x] Testes automáticos da API (`npm test`)

### Sprint 2

- [x] Ligar banco, fotos e variáveis na Vercel e publicar
- [ ] Fotos reais das salas (aguardando a Casa)
- [ ] Confirmar com a Casa a regra de cancelamento
- [x] Tirar o botão de teste da mensagem para a Agatha
- [x] E-mail da Casa no site inteiro: acasalumiere@gmail.com
- [ ] Recuperação de senha por e-mail
- [ ] Lista de clientes no painel

### Sprint 3

- [ ] Pagamento pelo site
- [ ] Aviso automático para a Agatha quando entra uma pré-reserva
- [ ] Relatório de horas reservadas por sala e por mês

## 4. Arquitetura

- Páginas estáticas na raiz (HTML, CSS, JS), servidas pela Vercel.
- `api/index.js`: uma única função serverless que recebe todas as rotas `/api/*` (o `vercel.json` encaminha).
- `api/_lib/`: banco, autenticação, regras de agenda e rotas (o `_` impede a Vercel de publicar como função).
- `dev/`: servidor local com Postgres embutido e os testes. Não vai para a Vercel.
- Banco: tabelas `usuarios`, `salas`, `fixos`, `reservas`, `reserva_horas` (a chave primária sala + dia + hora impede reserva dupla), `config`, `tentativas`.

Rotas:

| Método | Rota | Quem |
|---|---|---|
| GET | /api/agenda | todos |
| POST | /api/auth/cadastro, /api/auth/entrar, /api/auth/sair | todos |
| GET, PATCH | /api/auth/eu | logado |
| GET, POST | /api/reservas | logado |
| DELETE | /api/reservas/:id | logado (só a própria pré-reserva) |
| GET | /api/admin/dados | equipe |
| POST, PATCH, DELETE | /api/admin/reservas[/:id] | equipe |
| POST | /api/admin/reservas/:id/confirmar | equipe |
| POST, PATCH | /api/admin/salas[/:id] | equipe |
| POST | /api/admin/salas/:id/foto | equipe |
| POST, DELETE | /api/admin/fixos[/:id] | equipe |
| PUT | /api/admin/config | equipe |
