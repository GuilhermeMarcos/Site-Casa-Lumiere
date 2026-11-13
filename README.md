# Casa Lumière

Site da Casa Lumière (Holambra-SP) com agendamento de salas por hora, conta de cliente e painel da equipe.

- Site: páginas em HTML, CSS e JS na raiz.
- Agendamento: `salas.html`. Quem tem conta pré-reserva e manda a mensagem pronta para a Agatha no WhatsApp. Sem confirmação, a pré-reserva expira em 1h30.
- Painel da equipe: `painel.html`. Confirma pré-reservas, cria reservas feitas pelo WhatsApp, altera salas, fotos, horários fixos e funcionamento.
- Backend: `api/` (função da Vercel em Node), banco Postgres (Neon) e fotos no Vercel Blob.
- Requisitos, MVP e sprints: `docs/PROJETO.md`.

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

## Testar no computador

Precisa do Node 20 ou mais novo.

```bash
npm install
npm test        # testes da API com um banco em memória
npm run dev     # site em http://localhost:3000
```

No teste local, a conta da equipe usa o e-mail `equipe@casalumiere.com.br` e o código `lumiere`. O banco local fica em `dev/.banco` (apague a pasta para começar do zero).

## Como o sistema funciona

| Tabela | Para que serve |
|---|---|
| `usuarios` | Contas (senha guardada com scrypt, nunca a senha em si) |
| `salas` | Nome, tipo, descrição, foto, disponível, valor de referência |
| `fixos` | Horários fixos: toda semana, a cada 15 dias ou uma vez |
| `reservas` | Pré-reservas e reservas, com quem, quando e a situação |
| `reserva_horas` | Uma linha por hora ocupada. A chave sala + dia + hora impede reserva dupla |
| `config` | Funcionamento: horário, dias abertos, antecedência, WhatsApp da Agatha |
| `tentativas` | Trava de 15 minutos depois de 8 senhas erradas |

O valor por hora fica só no painel. Ele não aparece no site porque é combinado no WhatsApp.
