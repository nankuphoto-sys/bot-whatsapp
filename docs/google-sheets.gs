/**
 * Recibe los leads del bot y los agrega como filas en esta hoja de Google Sheets.
 * Se pega en Extensiones → Apps Script y se implementa como "Aplicación web".
 *
 * CLAVE protege la hoja: la URL que se pone en SHEETS_WEBHOOK_URL debe terminar en ?clave=<la misma CLAVE>.
 * Sin eso, cualquiera que conociera la URL podría escribir filas en la hoja.
 */
const CLAVE = "CAMBIA-ESTA-CLAVE";
const COLUMNAS = ["fecha", "telefono", "nombre", "servicio", "fecha_preferida", "notas"];

function doPost(e) {
  if (!e || !e.parameter || e.parameter.clave !== CLAVE) {
    return respuesta({ ok: false, error: "clave incorrecta" });
  }
  const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  if (hoja.getLastRow() === 0) hoja.appendRow(COLUMNAS);

  const lead = JSON.parse(e.postData.contents);
  // Un valor que empieza por =, +, - o @ se guarda como texto, no como fórmula.
  const fila = COLUMNAS.map((c) => {
    const valor = String(lead[c] ?? "");
    return /^[=+\-@]/.test(valor) ? "'" + valor : valor;
  });
  hoja.appendRow(fila);
  return respuesta({ ok: true });
}

function respuesta(datos) {
  return ContentService.createTextOutput(JSON.stringify(datos)).setMimeType(ContentService.MimeType.JSON);
}
