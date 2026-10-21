import { appendFile, mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { Lead } from "./bot.js";

const COLUMNAS = ["fecha", "telefono", "nombre", "servicio", "fecha_preferida", "notas"];

/** Campo CSV: entre comillas si hace falta, comillas dobladas. */
export function campoCsv(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

export function filaCsv(valores: string[]): string {
  return valores.map(campoCsv).join(",") + "\r\n";
}

/**
 * Guarda el lead en un CSV (se abre en Excel o Google Sheets) y, si está configurado,
 * lo envía a una hoja de Google Sheets por medio de un webhook de Apps Script.
 * Lanza solo si falla el CSV; un fallo de Sheets se devuelve en `errorSheets`.
 */
export async function guardarLead(
  telefono: string,
  lead: Lead,
  opciones: { archivo?: string; webhookSheets?: string; ahora?: Date } = {},
): Promise<{ errorSheets?: string }> {
  const archivo = opciones.archivo ?? "datos/leads.csv";
  const fecha = (opciones.ahora ?? new Date()).toISOString();
  await mkdir(dirname(archivo), { recursive: true });
  const existe = await stat(archivo).then(() => true, () => false);
  const fila = filaCsv([fecha, telefono, lead.nombre, lead.servicio, lead.fecha_preferida, lead.notas]);
  await appendFile(archivo, (existe ? "" : filaCsv(COLUMNAS)) + fila, "utf8");

  if (opciones.webhookSheets) {
    try {
      const r = await fetch(opciones.webhookSheets, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fecha, telefono, ...lead }),
        signal: AbortSignal.timeout(5000),
      });
      if (!r.ok) {
        console.warn(`Google Sheets respondió ${r.status}; el lead quedó solo en ${archivo}.`);
        return { errorSheets: `Google Sheets respondió ${r.status}` };
      }
      // Apps Script responde 200 aunque rechace el lead (ej. clave incorrecta): hay que leer el cuerpo.
      const cuerpo = (await r.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (cuerpo?.ok !== true) {
        const motivo = cuerpo?.error ?? "respuesta inesperada";
        console.warn(`Google Sheets rechazó el lead (${motivo}); quedó solo en ${archivo}.`);
        return { errorSheets: `Google Sheets rechazó el lead: ${motivo}` };
      }
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      console.warn(`No se pudo enviar el lead a Google Sheets (quedó en ${archivo}):`, mensaje);
      return { errorSheets: mensaje };
    }
  }
  return {};
}
