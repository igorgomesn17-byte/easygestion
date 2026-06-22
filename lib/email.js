// ============================================================
// Email via SendGrid
// Funções para enviar emails: recovery, convites, notificações
// ============================================================
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY || 'fake-key-dev');

const SITE_URL = process.env.SITE_URL || 'http://localhost:3000';
const LOJA_EMAIL = process.env.LOJA_EMAIL || 'noreply@easygestion.com';
const LOJA_NOME = process.env.LOJA_NOME || 'EasyGestão';

async function enviarEmail(para, assunto, htmlBody) {
  if (process.env.NODE_ENV === 'test') {
    console.log(`[EMAIL TEST] ${para}: ${assunto}`);
    return;
  }

  try {
    await sgMail.send({
      to: para,
      from: LOJA_EMAIL,
      subject: assunto,
      html: htmlBody,
    });
    console.log(`[EMAIL OK] ${para}: ${assunto}`);
    return true;
  } catch (err) {
    console.error(`[EMAIL ERRO] ${para}:`, err.message);
    return false;
  }
}

function templateResetSenha(usuario, link) {
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a6f5e; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 6px 6px; }
        .button { display: inline-block; background: #1a6f5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Redefinir sua senha</h2>
        </div>
        <div class="content">
          <p>Oi ${usuario},</p>
          <p>Você solicitou para redefinir sua senha. Clique no botão abaixo para criar uma nova senha.</p>
          <p>O link expira em <strong>1 hora</strong>.</p>
          <p style="text-align: center;">
            <a href="${link}" class="button">Redefinir senha</a>
          </p>
          <p>Se você não solicitou isso, ignore este email. Sua conta está segura.</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

function templateVerificarEmail(usuario, link) {
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a6f5e; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 6px 6px; }
        .button { display: inline-block; background: #1a6f5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Confirme seu email</h2>
        </div>
        <div class="content">
          <p>Oi ${usuario},</p>
          <p>Para ativar sua conta no ${LOJA_NOME}, clique no botão abaixo:</p>
          <p style="text-align: center;">
            <a href="${link}" class="button">Confirmar email</a>
          </p>
          <p>O link expira em <strong>24 horas</strong>.</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

function templateConvite(usuario, link) {
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a6f5e; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 6px 6px; }
        .button { display: inline-block; background: #1a6f5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Você foi convidado***REMOVED***</h2>
        </div>
        <div class="content">
          <p>Oi,</p>
          <p><strong>${usuario}</strong> convidou você para acessar ${LOJA_NOME}.</p>
          <p>Clique abaixo para criar sua senha e começar:</p>
          <p style="text-align: center;">
            <a href="${link}" class="button">Aceitar convite</a>
          </p>
          <p>Este link expira em <strong>7 dias</strong>.</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

function templateBoasVindas(usuario) {
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #1a6f5e; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 6px 6px; }
        .button { display: inline-block; background: #1a6f5e; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
        ol { padding-left: 20px; }
        li { margin: 10px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>Bem-vindo ao ${LOJA_NOME}***REMOVED***</h2>
        </div>
        <div class="content">
          <p>Oi ${usuario},</p>
          <p>Sua conta foi criada com sucesso***REMOVED*** Você tem <strong>14 dias grátis</strong> para testar todas as funcionalidades.</p>
          <h3>Próximos passos:</h3>
          <ol>
            <li>Faça login em <a href="${SITE_URL}">${SITE_URL}</a></li>
            <li>Configure sua marca (logo + cor)</li>
            <li>Cadastre seus primeiros 5 produtos</li>
            <li>Faça sua primeira venda</li>
          </ol>
          <p>Dúvidas? Responda este email — estamos aqui para ajudar***REMOVED***</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ✅ NOVO: Template para notificação de bloqueio de conta
function templateContaBloqueada(nomeCliente, motivo = null) {
  const motivoTexto = motivo || 'motivo não especificado';
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #d32f2f; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #fff3cd; padding: 30px; border-radius: 0 0 6px 6px; color: #664d03; }
        .alert { background: #f8d7da; border-left: 4px solid #d32f2f; padding: 15px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
        a { color: #1a6f5e; text-decoration: none; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>⚠️ Sua Conta Foi Bloqueada</h2>
        </div>
        <div class="content">
          <p>Oi ${nomeCliente},</p>
          <div class="alert">
            <p><strong>Sua conta no ${LOJA_NOME} foi bloqueada temporariamente.</strong></p>
            <p><strong>Motivo:</strong> ${motivoTexto}</p>
          </div>
          <p>O que acontece agora?</p>
          <ul>
            <li>Você <strong>não conseguirá acessar</strong> a plataforma até a reativação</li>
            <li>Seus dados estão seguros e preservados</li>
            <li>Entre em contato conosco para resolver a situação</li>
          </ul>
          <p>Dúvidas ou quer contestar? <a href="mailto:${LOJA_EMAIL}">Responda este email</a> e falaremos com você em breve.</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

// ✅ NOVO: Template para notificação de reativação
function templateContaReativada(nomeCliente) {
  return `
    <***REMOVED***DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .header { background: #4caf50; color: white; padding: 20px; text-align: center; border-radius: 6px 6px 0 0; }
        .content { background: #d4edda; padding: 30px; border-radius: 0 0 6px 6px; color: #155724; }
        .success { background: #c3e6cb; border-left: 4px solid #4caf50; padding: 15px; margin: 20px 0; }
        .button { display: inline-block; background: #4caf50; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 20px 0; }
        .footer { font-size: 12px; color: #999; margin-top: 20px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h2>✅ Sua Conta Foi Reativada</h2>
        </div>
        <div class="content">
          <p>Oi ${nomeCliente},</p>
          <div class="success">
            <p><strong>Bem-vindo de volta***REMOVED***</strong> Sua conta no ${LOJA_NOME} foi reativada e você pode acessar normalmente.</p>
          </div>
          <p style="text-align: center;">
            <a href="${SITE_URL}" class="button">Acessar plataforma</a>
          </p>
          <p>Se tiver dúvidas, <a href="mailto:${LOJA_EMAIL}">entre em contato</a> — estamos aqui para ajudar***REMOVED***</p>
          <div class="footer">
            <p>Equipe ${LOJA_NOME}</p>
          </div>
        </div>
      </div>
    </body>
    </html>
  `;
}

module.exports = {
  enviarEmail,
  templateResetSenha,
  templateVerificarEmail,
  templateConvite,
  templateBoasVindas,
  templateContaBloqueada,
  templateContaReativada,
};
