import "dotenv/config";
import { createServer, type IncomingMessage } from "node:http";
import { avisoPorWebhook, Monitor } from "./alertas.js";
import { cargarNegocio, crearConAnthropic, instrucciones, nombreDelNegocio, responder } from "./bot.js";
import { Conversaciones } from "./conversacion.js";
import { guardarLead } from "./leads.js";
import { enviarTexto, extraerFallosDeEntrega, extraerMensajes, firmaValida, type ConfigWhatsApp } from "./whatsapp.js";

/**
 * Servidor del webhook de WhatsApp.
 *   GET  /webhook  verificación inicial de Meta (hub.challenge)
 *   POST /webhook  mensajes entrantes: se responde 200 de inmediato y se procesan aparte
 *   GET/HEAD /salud (y /) para un monitor externo de disponibilidad (ver src/alertas.ts)
 */
const requerida = (nombre: string) => {
  const valor = process.env[nombre];
  if (!valor) {
    console.error(`Falta la variable ${nombre} en .env (ver .env.example).`);
    process.exit(1);
  }
  return valor;
};

const whatsapp: ConfigWhatsApp = {
  token: requerida("WHATSAPP_TOKEN"),
  phoneNumberId: requerida("WHATSAPP_PHONE_NUMBER_ID"),
};
const appSecret = requerida("WHATSAPP_APP_SECRET");
const tokenVerificacion = requerida("WHATSAPP_VERIFY_TOKEN");
const numeroAsesor = process.env.NUMERO_ASESOR;
const webhookSheets = process.env.SHEETS_WEBHOOK_URL;

if (!numeroAsesor) console.warn("Sin NUMERO_ASESOR: cuando el bot pase una conversación a una persona, nadie recibirá aviso.");

const infoNegocio = await cargarNegocio();
const sistema = instrucciones(infoNegocio);
const crear = crearConAnthropic();
const conversaciones = new Conversaciones((mensajes, texto) => responder(crear, sistema, mensajes, texto));
const monitor = new Monitor(avisoPorWebhook(process.env.ALERTAS_WEBHOOK_URL, nombreDelNegocio(infoNegocio)));

// Si dejan de llegar mensajes (webhook desconectado en Meta), no hay ningún error que contar: hay que revisarlo con un reloj.
const horasSilencio = Number(process.env.ALERTA_SILENCIO_HORAS ?? 24);
if (horasSilencio > 0) setInterval(() => monitor.revisarSilencio(horasSilencio), 15 * 60 * 1000).unref();

const mensajeDe = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Meta reintenta si tarda en recibir el 200: se recuerdan los ids ya atendidos. */
const vistos = new Set<string>();

/** Cada paso falla por separado: si no se pudo responder, igual se guarda el lead y se avisa al asesor. */
async function atender(de: string, id: string, texto: string) {
  if (vistos.has(id)) return;
  vistos.add(id);
  if (vistos.size > 5000) vistos.delete(vistos.values().next().value!);
  monitor.registrarMensaje(de);

  const inicio = Date.now();
  const { respuesta, acciones, respaldo } = await conversaciones.atender(de, texto);
  monitor.registrarDuracion(Date.now() - inicio, de);
  if (respaldo) {
    console.error(`Respuesta de respaldo para ${de} (${respaldo.motivo})${respaldo.detalle ? `: ${respaldo.detalle}` : ""}`);
    monitor.registrar(respaldo.motivo === "error_modelo" ? "error_modelo" : "respaldo", respaldo.detalle);
  }
  if (respuesta) {
    await enviarTexto(whatsapp, de, respuesta).catch((e) => {
      console.error(`No se pudo responder a ${de}:`, mensajeDe(e));
      monitor.registrar("error_envio", mensajeDe(e));
    });
  }

  for (const accion of acciones) {
    if (accion.tipo === "lead") {
      try {
        const { errorSheets } = await guardarLead(de, accion.lead, { webhookSheets });
        if (errorSheets) monitor.registrar("error_sheets", errorSheets);
        console.log(`Lead: ${de} · ${accion.lead.servicio} · ${accion.lead.fecha_preferida}`);
      } catch (e) {
        // Se imprime completo para poder recuperarlo a mano desde los logs.
        console.error(`No se pudo guardar el lead de ${de}:`, mensajeDe(e), JSON.stringify(accion.lead));
        monitor.registrar("error_lead", mensajeDe(e));
      }
    } else {
      console.log(`Pasada a una persona: ${de} · ${accion.motivo}`);
      monitor.registrar("humano");
      // Llega solo si el asesor le escribió al número del negocio en las últimas 24 horas (regla de Meta).
      if (numeroAsesor) {
        await enviarTexto(whatsapp, numeroAsesor, `Atiende a +${de}: ${accion.motivo}`).catch((e) => {
          console.warn("No se pudo avisar al asesor:", mensajeDe(e));
          monitor.registrar("error_aviso_asesor", `+${de}: ${mensajeDe(e)}`);
        });
      }
    }
  }
}

function leerCuerpo(req: IncomingMessage): Promise<string> {
  return new Promise((resolver, rechazar) => {
    let cuerpo = "";
    req.setEncoding("utf8");
    req.on("data", (parte) => {
      cuerpo += parte;
      if (cuerpo.length > 1_000_000) req.destroy(new Error("Cuerpo demasiado grande"));
    });
    req.on("end", () => resolver(cuerpo));
    req.on("error", rechazar);
  });
}

const servidor = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const ruta = url.pathname.replace(/\/+$/, "") || "/";
  // UptimeRobot y otros monitores consultan con HEAD por defecto; la raíz también responde para que
  // un monitor con la URL sin /salud no marque el servicio como caído.
  if ((ruta === "/salud" || ruta === "/") && (req.method === "GET" || req.method === "HEAD")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    return req.method === "HEAD" ? res.end() : res.end(JSON.stringify(monitor.estado()));
  }
  if (ruta !== "/webhook") return res.writeHead(404).end();

  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === tokenVerificacion;
    return ok ? res.writeHead(200).end(url.searchParams.get("hub.challenge") ?? "") : res.writeHead(403).end();
  }
  if (req.method !== "POST") return res.writeHead(405).end();

  const cuerpo = await leerCuerpo(req).catch(() => null);
  if (cuerpo === null || !firmaValida(cuerpo, req.headers["x-hub-signature-256"] as string | undefined, appSecret)) {
    monitor.registrar("firma_invalida");
    return res.writeHead(401).end();
  }
  res.writeHead(200).end();

  let payload: unknown;
  try {
    payload = JSON.parse(cuerpo);
  } catch {
    return;
  }
  for (const f of extraerFallosDeEntrega(payload)) {
    console.error(`WhatsApp no entregó un mensaje a +${f.para}: ${f.error}`);
    monitor.registrar("error_entrega", `+${f.para}: ${f.error}`);
  }
  for (const m of extraerMensajes(payload)) {
    atender(m.de, m.id, m.texto).catch((e) => console.error(`Error atendiendo a ${m.de}:`, mensajeDe(e)));
  }
});

// Render, Railway y similares asignan el puerto en PORT; si el servidor escucha en otro, el deploy falla.
const puerto = Number(process.env.PORT ?? process.env.PUERTO ?? 3000);
servidor.listen(puerto, () => console.log(`Webhook escuchando en http://localhost:${puerto}/webhook`));
