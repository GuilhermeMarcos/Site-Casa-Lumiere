# Casa Lumière

Site da Casa Lumière (Holambra-SP) com agendamento de salas por hora, conta de cliente e painel da equipe.

- Site: páginas em HTML, CSS e JS na raiz.
- Agendamento: `salas.html`. Quem tem conta pré-reserva e manda a mensagem pronta para a Agatha no WhatsApp. Sem confirmação, a pré-reserva expira em 1h30.
- Confirmação em 1 clique: `confirmar.html?r=...`, o link que vai na mensagem do cliente para a Agatha. Só funciona com a conta da equipe.
- Painel da equipe: `painel.html`. Confirma pré-reservas, cria reservas feitas pelo WhatsApp, altera salas, fotos, horários fixos e funcionamento.
- Backend: `api/` (função da Vercel em Node), banco Postgres (Neon) e fotos no Vercel Blob.
- Requisitos, MVP e sprints: `docs/PROJETO.md`.
- Segurança: `docs/SEGURANCA.md` (o que o sistema faz e o que depende de você).

## Colocar no ar pela Vercel (uma vez só)

O projeto já está ligado ao GitHub, então cada envio para o repositório publica sozinho. Falta ligar o banco, as fotos e três variáveis.

1. **Banco de dados.** No projeto da Vercel, abra **Storage**, clique em **Create Database**, escolha **Neon (Serverless Postgres)**, plano gratuito, região **São Paulo (gru1)** se aparecer, e conecte ao projeto. A Vercel cria a variável `DATABASE_URL` sozinha. As tabelas e as salas iniciais são criadas no primeiro acesso.
2. **Fotos das salas.** Ainda em **Storage**, **Create Database**, escolha **Blob** e conecte ao projeto. A Vercel cria `BLOB_READ_WRITE_TOKEN` sozinha.
3. **Variáveis.** Em **Settings**, **Environment Variables**, crie (marque Production e Preview):
   - `JWT_SECRET`: uma frase longa e aleatória, com pelo menos 32 caracteres. Só você precisa saber. Se trocar, todo mundo precisa entrar de novo.
   - `ADMIN_EMAIL`: o e-mail único da equipe (Luiza e Agatha). Só esse e-mail abre o painel.
   - `CODIGO_EQUIPE`: um código que só a equipe sabe. Ele é pedido para criar a conta da equipe e para trocar a senha dela se esquecerem.
4. **Publicar de novo.** Em **Deployments**, abra o último, clique nos três pontinhos e em **Redeploy**, para as variáveis valerem.
5. **Criar a conta da equipe.** No site, toque no ícone de conta, **Criar conta**, use o e-mail de `ADMIN_EMAIL`. O site pede o código da equipe. Depois disso, o painel aparece no menu da conta e em `/painel.html`.

Nunca coloque essas chaves em arquivos do repositório. Elas ficam só na Vercel.

## E-mail com código (confirmar conta e recuperar senha)

Enquanto o e-mail não estiver configurado, o site funciona como antes: cria conta sem código e a senha esquecida é resolvida pelo WhatsApp. Quando você configurar um dos dois jeitos abaixo e fizer Redeploy, o código passa a ser pedido sozinho.

**Jeito 1, mais rápido: Gmail da Casa (acasalumiere@gmail.com)**
1. Entre no Gmail da Casa e ative a **Verificação em duas etapas** em myaccount.google.com/security.
2. Abra myaccount.google.com/apppasswords, crie uma senha de app chamada "Site Casa Lumière" e copie os 16 caracteres.
3. Na Vercel, em **Environment Variables**, crie `GMAIL_USUARIO` = `acasalumiere@gmail.com` e `GMAIL_SENHA_APP` = os 16 caracteres.
4. Faça Redeploy. O Gmail envia até cerca de 500 e-mails por dia, bem mais do que o site precisa.

**Jeito 2, mais profissional: Resend com o domínio (nao-responda@casalumiere.com.br)**
1. Crie a conta em resend.com, adicione o domínio `casalumiere.com.br` e coloque na Vercel (em **Domains**, DNS) os registros que o Resend mostrar.
2. Crie uma API key e coloque na Vercel: `RESEND_API_KEY` = a chave e `EMAIL_REMETENTE` = `Casa Lumière <nao-responda@casalumiere.com.br>`.
3. Faça Redeploy. O plano grátis envia 3.000 e-mails por mês.

Se as duas estiverem configuradas, o site usa o Resend.

## Testar no computador

Precisa do Node 20 ou mais novo.

```bash
npm install
npm test        # testes da API e testes de ataque, com um banco em memória
npm run dev     # site em http://localhost:3000
```

No teste local, a conta da equipe usa o e-mail `equipe@casalumiere.com.br` e o código `lumiere`. Os códigos de e-mail aparecem no terminal do `npm run dev`. O banco local fica em `dev/.banco` (apague a pasta para começar do zero).

## Como o sistema funciona

| Tabela | Para que serve |
|---|---|
| `usuarios` | Contas (senha guardada com scrypt, nunca a senha em si) |
| `salas` | Nome, tipo, descrição, foto, disponível e a tabela de preços (horas e valor) |
| `fixos` | Horários fixos: toda semana, a cada 15 dias ou uma vez |
| `reservas` | Pré-reservas e reservas, com quem, quando, a situação e o valor calculado |
| `parceiros` | Quem tem desconto no aluguel e repassa uma porcentagem dos atendimentos |
| `atendimentos` | Atendimentos lançados pela equipe, com o repasse e se já foi recebido |
| `reserva_horas` | Uma linha por hora ocupada. A chave sala + dia + hora impede reserva dupla |
| `config` | Funcionamento: horário, dias abertos, antecedência, WhatsApp da Agatha |
| `tentativas` | Trava de 15 minutos depois de 8 senhas erradas |
| `codigos` | Códigos de e-mail (só o hash), valem 10 minutos e uma única vez |
| `limites` | Contadores contra abuso: login, cadastro, códigos e pré-reservas por IP |

A equipe monta a tabela de preços de cada sala no painel. O site mostra os preços no canto da foto e o total na hora de reservar; quem calcula o valor gravado é o servidor.
