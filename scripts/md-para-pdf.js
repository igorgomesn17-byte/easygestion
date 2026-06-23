// Converte um Markdown em HTML estilizado (identidade DS) pronto pra virar PDF no Chrome.
// Uso: node md-para-pdf.js "<entrada.md>" "<saida.html>" "<Titulo>" "<Subtitulo>"
const fs = require('fs');

const [,, entrada, saida, titulo = 'DS Store', subtitulo = ''] = process.argv;
const md = fs.readFileSync(entrada, 'utf8');

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
// inline: **negrito**, *itálico*, `code`, [texto](link)
function inline(s) {
  s = esc(s);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return s;
}

const linhas = md.split(/\r?\n/);
let html = '';
let i = 0;
let emLista = false;
const fechaLista = () => { if (emLista) { html += '</ul>\n'; emLista = false; } };

while (i < linhas.length) {
  let ln = linhas[i];

  // tabela: linha com | e a seguinte com ---
  if (/^\s*\|/.test(ln) && i + 1 < linhas.length && /^\s*\|?[\s:|-]+\|/.test(linhas[i + 1])) {
    fechaLista();
    const cab = ln.split('|').slice(1, -1).map(c => c.trim());
    i += 2; // pula cabeçalho + separador
    let corpo = '';
    while (i < linhas.length && /^\s*\|/.test(linhas[i])) {
      const cels = linhas[i].split('|').slice(1, -1).map(c => inline(c.trim()));
      corpo += '<tr>' + cels.map(c => `<td>${c}</td>`).join('') + '</tr>\n';
      i++;
    }
    html += '<table><thead><tr>' + cab.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>\n' + corpo + '</tbody></table>\n';
    continue;
  }

  if (/^---+\s*$/.test(ln)) { fechaLista(); html += '<hr>\n'; i++; continue; }
  if (/^######\s/.test(ln)) { fechaLista(); html += `<h6>${inline(ln.replace(/^######\s/, ''))}</h6>\n`; i++; continue; }
  if (/^#####\s/.test(ln)) { fechaLista(); html += `<h5>${inline(ln.replace(/^#####\s/, ''))}</h5>\n`; i++; continue; }
  if (/^####\s/.test(ln)) { fechaLista(); html += `<h4>${inline(ln.replace(/^####\s/, ''))}</h4>\n`; i++; continue; }
  if (/^###\s/.test(ln)) { fechaLista(); html += `<h3>${inline(ln.replace(/^###\s/, ''))}</h3>\n`; i++; continue; }
  if (/^##\s/.test(ln)) { fechaLista(); html += `<h2>${inline(ln.replace(/^##\s/, ''))}</h2>\n`; i++; continue; }
  if (/^#\s/.test(ln)) { fechaLista(); html += `<h1class="doc">${inline(ln.replace(/^#\s/, ''))}</h1>\n`.replace('h1class','h1 class'); i++; continue; }
  if (/^>\s?/.test(ln)) {
    fechaLista();
    let bloco = [];
    while (i < linhas.length && /^>\s?/.test(linhas[i])) { bloco.push(linhas[i].replace(/^>\s?/, '')); i++; }
    html += `<blockquote>${inline(bloco.join(' '))}</blockquote>\n`;
    continue;
  }
  if (/^\s*[-*]\s+/.test(ln)) {
    if (!emLista) { html += '<ul>\n'; emLista = true; }
    html += `<li>${inline(ln.replace(/^\s*[-*]\s+/, ''))}</li>\n`;
    i++; continue;
  }
  if (/^\s*\d+\.\s+/.test(ln)) {
    fechaLista();
    let bloco = '';
    while (i < linhas.length && /^\s*\d+\.\s+/.test(linhas[i])) {
      bloco += `<li>${inline(linhas[i].replace(/^\s*\d+\.\s+/, ''))}</li>\n`;
      i++;
    }
    html += `<ol>\n${bloco}</ol>\n`;
    continue;
  }
  if (/^\s*$/.test(ln)) { fechaLista(); i++; continue; }

  fechaLista();
  html += `<p>${inline(ln)}</p>\n`;
  i++;
}
fechaLista();

const doc = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8">
<style>
  @page { size: A4; margin: 18mm 16mm 16mm 16mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Georgia, 'Times New Roman', serif; color: #2b2320;
    font-size: 10.5pt; line-height: 1.5; margin: 0;
  }
  .capa {
    background: linear-gradient(135deg, #6B5849 0%, #4a3d33 100%);
    color: #fff; padding: 70px 50px; margin: -0 0 24px 0; text-align: center;
    page-break-after: always; height: 100vh; display: flex; flex-direction: column; justify-content: center;
  }
  .capa .marca { font-family: Georgia, serif; letter-spacing: 10px; font-size: 30pt; font-weight: 700; color: #C9A24B; }
  .capa .marca small { display:block; letter-spacing: 14px; font-size: 9pt; font-weight: 400; color: #e8d9b8; margin-top: 4px; }
  .capa h1 { border: none; color: #fff; font-size: 24pt; margin: 40px 0 8px; padding: 0; }
  .capa .sub { color: #e8d9b8; font-size: 12pt; font-style: italic; }
  .capa .data { margin-top: 40px; color: #d8c9a8; font-size: 10pt; letter-spacing: 2px; }
  h1 { font-size: 17pt; color: #6B5849; border-bottom: 2px solid #C9A24B; padding-bottom: 5px; margin: 26px 0 12px; page-break-after: avoid; }
  h2 { font-size: 14pt; color: #8a6d2f; margin: 22px 0 8px; padding-left: 10px; border-left: 4px solid #C9A24B; page-break-after: avoid; }
  h3 { font-size: 12pt; color: #6B5849; margin: 16px 0 6px; page-break-after: avoid; }
  h4,h5,h6 { font-size: 11pt; color: #4a3d33; margin: 12px 0 4px; }
  p { margin: 6px 0; }
  ul, ol { margin: 6px 0 10px; padding-left: 22px; }
  li { margin: 3px 0; }
  a { color: #8a6d2f; text-decoration: none; }
  code { background: #f4efe6; padding: 1px 5px; border-radius: 4px; font-family: 'Consolas', monospace; font-size: 9pt; color: #6B5849; }
  blockquote {
    margin: 12px 0; padding: 10px 16px; background: #faf6ee;
    border-left: 4px solid #C9A24B; color: #4a3d33; font-style: italic; border-radius: 0 6px 6px 0;
  }
  hr { border: none; border-top: 1px solid #e0d4bf; margin: 18px 0; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 9.5pt; page-break-inside: avoid; }
  th { background: #6B5849; color: #fff; text-align: left; padding: 7px 9px; font-family: Arial, sans-serif; font-size: 9pt; }
  td { padding: 6px 9px; border-bottom: 1px solid #ece4d4; vertical-align: top; }
  tr:nth-child(even) td { background: #faf7f1; }
  strong { color: #4a3d33; }
  h1, h2, table, blockquote { break-inside: avoid; }
</style></head>
<body>
  <div class="capa">
    <div class="marca">DS STORE<small>BOUTIQUE</small></div>
    <h1>${esc(titulo)}</h1>
    <div class="sub">${esc(subtitulo)}</div>
    <div class="data">DOCUMENTO ESTRATÉGICO CONFIDENCIAL · JUNHO 2026</div>
  </div>
  ${html}
</body></html>`;

fs.writeFileSync(saida, doc, 'utf8');
console.log('HTML gerado:', saida);
