// ============================================================
// Datas no fuso LOCAL (Itabuna/Brasil, UTC-3)
// NUNCA usar toISOString() para "hoje" - ele retorna UTC e vira
// o dia errado depois das 21h. Use sempre hojeLocal().
// ============================================================

// Retorna 'YYYY-MM-DD' no horario LOCAL da maquina
function hojeLocal() {
  const d = new Date();
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Converte um Date qualquer para 'YYYY-MM-DD' local
function dataLocal(d) {
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

module.exports = { hojeLocal, dataLocal };
