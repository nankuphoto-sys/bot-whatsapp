import "dotenv/config";
import { createInterface } from "node:readline/promises";
import { cargarNegocio, crearConAnthropic, instrucciones, MODELO, nombreDelNegocio, responder } from "./bot.js";
import { Conversaciones } from "./conversacion.js";
import { guardarLead } from "./leads.js";

/**
 * Chat en la terminal con el mismo bot que corre en WhatsApp, sin necesitar una cuenta de Meta.
 * Sirve para probarlo y para grabar la demo. Escribe "salir" para terminar.
 */
const TELEFONO_DE_PRUEBA = "573000000000";
const gris = (t: string) => `\x1b[90m${t}\x1b[0m`;

const infoNegocio = await cargarNegocio();
const nombre = nombreDelNegocio(infoNegocio);
const sistema = instrucciones(infoNegocio);
const crear = crearConAnthropic();
const conversaciones = new Conversaciones((mensajes, texto) => responder(crear, sistema, mensajes, texto));

const terminal = createInterface({ input: process.stdin, output: process.stdout });
console.log(gris(`Bot de ${nombre} (${MODELO}). Escribe como si fueras un cliente. "salir" para terminar.\n`));

while (true) {
  const texto = (await terminal.question("Tú: ")).trim();
  if (!texto) continue;
  if (texto.toLowerCase() === "salir") break;

  const { respuesta, acciones } = await conversaciones.atender(TELEFONO_DE_PRUEBA, texto);
  console.log(respuesta ? `\n${nombre}: ${respuesta}\n` : gris("\n(una persona está atendiendo; el bot no responde)\n"));
  for (const accion of acciones) {
    if (accion.tipo === "lead") {
      await guardarLead(TELEFONO_DE_PRUEBA, accion.lead);
      console.log(gris(`  → lead guardado en datos/leads.csv: ${JSON.stringify(accion.lead)}\n`));
    } else {
      console.log(gris(`  → pasado a una persona: ${accion.motivo}\n`));
    }
  }
}
terminal.close();
