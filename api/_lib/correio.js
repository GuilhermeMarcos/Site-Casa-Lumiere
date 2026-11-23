// Envio de e-mail. Funciona com um destes dois jeitos (o que estiver configurado na Vercel):
//   1. Gmail da Casa:  GMAIL_USUARIO + GMAIL_SENHA_APP (senha de app do Google)
//   2. Resend:         RESEND_API_KEY + EMAIL_REMETENTE (ex.: Casa Lumière <nao-responda@casalumiere.com.br>)
// No teste local, dev/preparar.mjs troca o envio por um registro em memória com usarCorreio().
import { Falha } from './http.js';

let impl = null;
export function usarCorreio(nova) {
  impl = nova;
}

export function correioAtivo() {
  return !!(impl || process.env.RESEND_API_KEY || (process.env.GMAIL_USUARIO && process.env.GMAIL_SENHA_APP));
}

let transporte = null;
async function gmail() {
  if (!transporte) {
    const nodemailer = (await import('nodemailer')).default;
    transporte = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: process.env.GMAIL_USUARIO, pass: String(process.env.GMAIL_SENHA_APP).replace(/\s/g, '') },
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  return transporte;
}

export async function enviarEmail({ para, assunto, html, texto }) {
  if (impl) return impl({ para, assunto, html, texto });
  try {
    if (process.env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_REMETENTE || 'Casa Lumière <onboarding@resend.dev>', to: [para], subject: assunto, html, text: texto }),
      });
      if (!r.ok) throw new Error('Resend ' + r.status + ' ' + (await r.text()).slice(0, 200));
      return;
    }
    if (process.env.GMAIL_USUARIO && process.env.GMAIL_SENHA_APP) {
      const t = await gmail();
      await t.sendMail({ from: `Casa Lumière <${process.env.GMAIL_USUARIO}>`, to: para, subject: assunto, html, text: texto });
      return;
    }
  } catch (e) {
    console.error('Falha ao enviar e-mail:', e.message);
    throw new Falha(502, 'email_falhou', 'Não conseguimos enviar o e-mail agora. Tente de novo em instantes.');
  }
  throw new Falha(503, 'sem_email', 'O envio de e-mail ainda não foi configurado.');
}

/* ===== Modelos ===== */
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function moldura(titulo, corpoHtml) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F4ECDF;font-family:Montserrat,Arial,sans-serif;color:#2E1F16">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4ECDF;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FBF7F0;border-radius:18px;border:1px solid #E3D3BA">
<tr><td style="background:#2E1F16;border-radius:18px 18px 0 0;padding:26px 28px;text-align:center">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:26px;letter-spacing:.06em;color:#F6DC98">Casa Lumière</div>
<div style="font-size:11px;letter-spacing:.2em;color:#CDB48A;margin-top:4px">HOLAMBRA</div></td></tr>
<tr><td style="padding:30px 28px 10px"><h1 style="margin:0 0 14px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:26px;color:#2E1F16">${titulo}</h1>
${corpoHtml}</td></tr>
<tr><td style="padding:18px 28px 28px;font-size:12px;line-height:1.6;color:#8A7461">Se não foi você quem pediu, pode ignorar este e-mail. Ninguém da Casa vai pedir este código por telefone ou WhatsApp.</td></tr>
</table></td></tr></table></body></html>`;
}

const caixaCodigo = (codigo) => `<p style="margin:0 0 8px;font-size:15px;line-height:1.6">Use este código no site. Ele vale por 10 minutos.</p>
<div style="margin:18px 0 8px;padding:18px;border-radius:14px;background:#2E1F16;text-align:center;font-family:'Courier New',monospace;font-size:34px;letter-spacing:.35em;color:#F6DC98;font-weight:700">${esc(codigo)}</div>`;

export function emailCodigo(finalidade, codigo) {
  if (finalidade === 'entrar') {
    return {
      assunto: `${codigo} é o código para entrar no painel da Casa Lumière`,
      html: moldura('Código para entrar no painel', '<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Alguém digitou a senha da equipe e está entrando no painel. Se foi vocês, use o código abaixo.</p>' + caixaCodigo(codigo) +
        '<p style="margin:14px 0 0;font-size:14px;line-height:1.6"><strong>Não foram vocês?</strong> Não passem o código para ninguém e troquem a senha da equipe: alguém sabe a senha atual.</p>'),
      texto: `Código para entrar no painel: ${codigo}\nVale por 10 minutos.\n\nNão foram vocês? Não passem o código para ninguém e troquem a senha da equipe: alguém sabe a senha atual.`,
    };
  }
  const cadastro = finalidade === 'cadastro';
  const titulo = cadastro ? 'Confirme o seu e-mail' : 'Crie uma senha nova';
  return {
    assunto: `${codigo} é o seu código da Casa Lumière`,
    html: moldura(titulo, (cadastro ? '<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Falta só confirmar o e-mail para criar a sua conta.</p>' : '<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Recebemos um pedido para trocar a senha da sua conta.</p>') + caixaCodigo(codigo)),
    texto: `${titulo}\n\nSeu código: ${codigo}\nEle vale por 10 minutos.\n\nSe não foi você quem pediu, ignore este e-mail.`,
  };
}

export function emailJaTemConta() {
  return {
    assunto: 'Você já tem conta na Casa Lumière',
    html: moldura('Você já tem uma conta', '<p style="margin:0 0 6px;font-size:15px;line-height:1.6">Alguém tentou criar uma conta com este e-mail, mas ele já está cadastrado. Para entrar, use "Entrar" no site. Se esqueceu a senha, toque em "Esqueci minha senha".</p>'),
    texto: 'Alguém tentou criar uma conta com este e-mail, mas ele já está cadastrado. Para entrar, use "Entrar" no site. Se esqueceu a senha, toque em "Esqueci minha senha".',
  };
}

