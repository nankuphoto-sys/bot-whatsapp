import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * WhatsApp Business Cloud API (Meta), sin intermediarios.
 * Usar la API oficial es lo que evita que bloqueen el número, a diferencia de las herramientas
 * que automatizan WhatsApp Web.
 */

/** Verifica la cabecera X-Hub-Signature-256 que Meta firma con el App Secret. */
export function firmaValida(cuerpoCrudo: string, cabecera: string | undefined, appSecret: string): boolean {
  if (!cabecera?.startsWith("sha256=")) return false;
  const esperada = createHmac("sha256", appSecret).update(cuerpoCrudo, "utf8").digest("hex");
  const recibida = cabecera.slice("sha256=".length);
  if (recibida.length !== esperada.length) return false;
  return timingSafeEqual(Buffer.from(recibida, "hex"), Buffer.from(esperada, "hex"));
}

export interface MensajeEntrante {
  id: string;
  /** Teléfono del cliente, con indicativo y sin "+" (formato de Meta). */
  de: string;
  /** Texto para el bot. Para imágenes, audios, etc. es una descripción entre corchetes. */
  texto: string;
}

const DESCRIPCIONES: Record<string, string> = {
  image: "[El cliente envió una imagen]",
  video: "[El cliente envió un video]",
  audio: "[El cliente envió una nota de voz]",
  document: "[El cliente envió un documento]",
  sticker: "[El cliente envió un sticker]",
  location: "[El cliente envió una ubicación]",
};

/** Saca los mensajes de un webhook de Meta. Los avisos de estado (entregado, leído) se ignoran. */
export function extraerMensajes(payload: unknown): MensajeEntrante[] {
  const entradas = (payload as { entry?: { changes?: { value?: { messages?: unknown[] } }[] }[] })?.entry ?? [];
  const mensajes: MensajeEntrante[] = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      for (const m of (cambio.value?.messages ?? []) as Record<string, any>[]) {
        if (typeof m?.id !== "string" || typeof m?.from !== "string") continue;
        const texto =
          m.type === "text"
            ? m.text?.body
            : m.type === "button"
              ? m.button?.text
              : m.type === "interactive"
                ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title)
                : DESCRIPCIONES[m.type];
        const caption = m[m.type]?.caption;
        mensajes.push({
          id: m.id,
          de: m.from,
          texto: (texto ?? "[El cliente envió un mensaje que el bot no puede leer]") + (caption ? ` con el texto: "${caption}"` : ""),
        });
      }
    }
  }
  return mensajes;
}

export interface FalloDeEntrega {
  /** Teléfono al que no llegó el mensaje. */
  para: string;
  /** Código y descripción de Meta, ej. "131047 Re-engagement message". */
  error: string;
}

/**
 * Meta acepta el envío (HTTP 200) y avisa después, por el mismo webhook, si no lo pudo entregar.
 * Sin leer estos avisos, un mensaje que nunca llegó parece enviado.
 */
export function extraerFallosDeEntrega(payload: unknown): FalloDeEntrega[] {
  const entradas = (payload as { entry?: { changes?: { value?: { statuses?: unknown[] } }[] }[] })?.entry ?? [];
  const fallos: FalloDeEntrega[] = [];
  for (const entrada of entradas) {
    for (const cambio of entrada.changes ?? []) {
      for (const s of (cambio.value?.statuses ?? []) as Record<string, any>[]) {
        if (s?.status !== "failed") continue;
        const e = s.errors?.[0];
        const error = e ? [e.code, e.title ?? e.message].filter(Boolean).join(" ") : "sin detalle";
        fallos.push({ para: String(s.recipient_id ?? "desconocido"), error });
      }
    }
  }
  return fallos;
}

export interface ConfigWhatsApp {
  token: string;
  phoneNumberId: string;
  versionGraph?: string;
}

/**
 * Envía un texto libre. Meta solo lo permite dentro de las 24 horas siguientes al último mensaje
 * de esa persona; fuera de esa ventana hay que usar una plantilla aprobada.
 */
export async function enviarTexto(config: ConfigWhatsApp, para: string, texto: string): Promise<void> {
  const url = `https://graph.facebook.com/${config.versionGraph ?? "v23.0"}/${config.phoneNumberId}/messages`;
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Meta respondió ${r.status}: ${await r.text()}`);
}
