/**
 * Alertas para enterarse de que el bot está fallando antes de que lo note un cliente.
 * Cuenta eventos en una ventana de tiempo y, al pasar el umbral de una regla, avisa una sola vez
 * (luego espera PAUSA_MIN antes de repetir esa misma alerta).
 */
export type Evento =
  | "mensaje"
  | "humano"
  | "respaldo"
  | "error_modelo"
  | "error_envio"
  | "error_aviso_asesor"
  | "error_lead"
  | "error_sheets"
  | "firma_invalida"
  | "error_entrega"
  | "lento"
  | "abuso"
  | "silencio";

export interface Regla {
  evento: Evento;
  /** Cuántos eventos dentro de la ventana disparan la alerta. */
  umbral: number;
  ventanaMin: number;
  /** Además del umbral, exige que el evento sea al menos `minima` (0 a 1) de los eventos `de` en la ventana. */
  proporcion?: { de: Evento; minima: number };
  /** Qué pasó y qué revisar, escrito para el dueño del negocio. */
  texto: string;
}

/** Una respuesta que tarda más que esto cuenta como lenta. */
export const LENTO_SEG = 30;
/** Más de ABUSO_MENSAJES mensajes de un mismo número en ABUSO_MIN minutos cuenta como abuso. */
export const ABUSO_MENSAJES = 20;
export const ABUSO_MIN = 10;

export const REGLAS: Regla[] = [
  {
    evento: "error_aviso_asesor",
    umbral: 1,
    ventanaMin: 60,
    texto:
      "🔴 Un cliente pidió hablar con una persona y el aviso al asesor no llegó: alguien está esperando respuesta en el chat del negocio. " +
      "Meta solo deja avisar al asesor si él escribió al número en las últimas 24 horas.",
  },
  {
    evento: "error_lead",
    umbral: 1,
    ventanaMin: 60,
    texto: "🔴 No se pudo guardar un lead en el CSV. Los datos del cliente quedaron en los logs; revisa el disco del servidor.",
  },
  {
    evento: "error_modelo",
    umbral: 3,
    ventanaMin: 10,
    texto:
      "🔴 Claude falló 3 veces en 10 minutos (créditos, clave o caída del servicio). " +
      "Los clientes reciben el mensaje de respaldo y quedan esperando a una persona.",
  },
  {
    evento: "error_envio",
    umbral: 3,
    ventanaMin: 10,
    texto: "🔴 WhatsApp rechazó 3 respuestas en 10 minutos: los clientes no están recibiendo nada. Lo más común es que venció el token de Meta.",
  },
  {
    evento: "error_entrega",
    umbral: 3,
    ventanaMin: 30,
    texto:
      "🔴 Meta aceptó 3 respuestas en 30 minutos pero después no las entregó (estado \"failed\"): esos clientes no recibieron nada. " +
      "Revisa el código de error: suele ser la ventana de 24 horas, un número inválido o un problema de pago en la cuenta de Meta.",
  },
  {
    evento: "lento",
    umbral: 3,
    ventanaMin: 30,
    texto: `🟠 3 respuestas en 30 minutos tardaron más de ${LENTO_SEG} segundos: los clientes esperan demasiado. Suele ser lentitud de la API de Claude.`,
  },
  {
    evento: "abuso",
    umbral: 1,
    ventanaMin: 60,
    texto:
      `🟠 Un número mandó más de ${ABUSO_MENSAJES} mensajes en ${ABUSO_MIN} minutos. Puede ser spam u otro bot contestándole al tuyo: ` +
      "cada mensaje gasta créditos de Claude. Si sigue, bloquéalo desde WhatsApp Business.",
  },
  {
    evento: "silencio",
    umbral: 1,
    ventanaMin: 60,
    texto:
      "🟡 Hace más de las horas configuradas en ALERTA_SILENCIO_HORAS que no llega ningún mensaje. Si es raro para el negocio, " +
      "revisa en Meta que el webhook siga verificado y suscrito a \"messages\".",
  },
  {
    evento: "respaldo",
    umbral: 3,
    ventanaMin: 30,
    texto: "🟠 El bot respondió con el mensaje de respaldo 3 veces en 30 minutos (se negó a responder o no supo qué decir). Revisa esas conversaciones.",
  },
  {
    evento: "humano",
    umbral: 5,
    ventanaMin: 60,
    proporcion: { de: "mensaje", minima: 0.5 },
    texto:
      "🟠 La mitad de los mensajes de la última hora terminaron pasados a una persona. " +
      "Puede faltar información en el archivo del negocio o el bot está entendiendo mal.",
  },
  {
    evento: "firma_invalida",
    umbral: 10,
    ventanaMin: 10,
    texto: "🟠 Llegaron 10 webhooks con firma inválida en 10 minutos: o cambió el App Secret en Meta, o alguien está probando el endpoint.",
  },
  {
    evento: "error_sheets",
    umbral: 3,
    ventanaMin: 60,
    texto: "🟡 Google Sheets falló 3 veces en una hora. Los leads siguen guardándose en datos/leads.csv.",
  },
];

export const PAUSA_MIN = 30;
const MINUTO = 60 * 1000;
const RETENCION = 24 * 60 * MINUTO;

export type Avisar = (texto: string) => void | Promise<void>;

export class Monitor {
  private eventos = new Map<Evento, number[]>();
  private ultimoAviso = new Map<Regla, number>();
  private ultimoMensaje: number | null = null;
  private porTelefono = new Map<string, number[]>();
  private inicio: number;
  /** Para avisar del silencio una sola vez hasta que vuelva a llegar un mensaje. */
  private silencioAvisado = false;

  constructor(
    private avisar: Avisar,
    private reglas: Regla[] = REGLAS,
    private ahora: () => number = Date.now,
  ) {
    this.inicio = ahora();
  }

  /** Registra un mensaje entrante y detecta si un mismo número está mandando demasiados. */
  registrarMensaje(telefono: string): void {
    const t = this.ahora();
    this.silencioAvisado = false;
    const recientes = (this.porTelefono.get(telefono) ?? []).filter((x) => t - x < ABUSO_MIN * MINUTO);
    recientes.push(t);
    this.porTelefono.set(telefono, recientes);
    if (this.porTelefono.size > 5000) this.limpiarTelefonos(t);
    this.registrar("mensaje");
    // Se registra justo al pasar el límite, no en cada mensaje siguiente.
    if (recientes.length === ABUSO_MENSAJES + 1) this.registrar("abuso", `+${telefono}`);
  }

  /** Cronometra una respuesta; se llama con los milisegundos que tardó. */
  registrarDuracion(ms: number, telefono: string): void {
    if (ms > LENTO_SEG * 1000) this.registrar("lento", `${Math.round(ms / 1000)} s para +${telefono}`);
  }

  /**
   * Para llamar periódicamente (ej. cada 15 minutos): avisa una vez si no llega ningún mensaje hace `horas`.
   * Se cuenta desde el último mensaje, o desde que arrancó el servidor si todavía no llegó ninguno.
   */
  revisarSilencio(horas: number): void {
    if (this.silencioAvisado) return;
    const desde = this.ultimoMensaje ?? this.inicio;
    if (this.ahora() - desde < horas * 60 * MINUTO) return;
    this.silencioAvisado = true;
    this.registrar("silencio", `Último mensaje: ${this.ultimoMensaje === null ? "ninguno desde que arrancó el servidor" : new Date(this.ultimoMensaje).toISOString()}`);
  }

  private limpiarTelefonos(t: number): void {
    for (const [telefono, lista] of this.porTelefono) {
      if (lista.every((x) => t - x >= ABUSO_MIN * MINUTO)) this.porTelefono.delete(telefono);
    }
  }

  /** Nunca lanza: una alerta que falla no puede tumbar la atención de un cliente. */
  registrar(evento: Evento, detalle?: string): void {
    const t = this.ahora();
    if (evento === "mensaje") this.ultimoMensaje = t;
    const lista = (this.eventos.get(evento) ?? []).filter((x) => t - x < RETENCION);
    lista.push(t);
    this.eventos.set(evento, lista);
    for (const regla of this.reglas) if (regla.evento === evento) this.evaluar(regla, t, detalle);
  }

  /** Resumen para GET /salud: un monitor externo (UptimeRobot, etc.) detecta si el servidor se cae. */
  estado() {
    const desde = this.ahora() - 60 * MINUTO;
    const errores = Object.fromEntries(
      [...this.eventos.keys()]
        .filter((e) => e.startsWith("error_") || e === "respaldo" || e === "lento" || e === "abuso")
        .map((e) => [e, this.contar(e, desde)]),
    );
    return {
      estado: "ok",
      ultimoMensaje: this.ultimoMensaje === null ? null : new Date(this.ultimoMensaje).toISOString(),
      erroresUltimaHora: errores,
    };
  }

  private contar(evento: Evento, desde: number): number {
    return (this.eventos.get(evento) ?? []).filter((t) => t >= desde).length;
  }

  private evaluar(regla: Regla, t: number, detalle?: string): void {
    const desde = t - regla.ventanaMin * MINUTO;
    const n = this.contar(regla.evento, desde);
    if (n < regla.umbral) return;
    if (regla.proporcion) {
      const base = this.contar(regla.proporcion.de, desde);
      if (base === 0 || n / base < regla.proporcion.minima) return;
    }
    const previo = this.ultimoAviso.get(regla);
    if (previo !== undefined && t - previo < PAUSA_MIN * MINUTO) return;
    this.ultimoAviso.set(regla, t);

    const texto = detalle ? `${regla.texto}\nÚltimo error: ${detalle.slice(0, 300)}` : regla.texto;
    Promise.resolve()
      .then(() => this.avisar(texto))
      .catch((e) => console.error("No se pudo enviar la alerta:", e instanceof Error ? e.message : e));
  }
}

/**
 * Envía la alerta a un webhook (Slack, Discord, Google Chat, n8n...). No se usa WhatsApp a propósito:
 * si lo que falla es Meta, la alerta tampoco llegaría. Siempre queda además en los logs.
 */
export function avisoPorWebhook(url: string | undefined, negocio: string): Avisar {
  return async (texto) => {
    console.error(`[ALERTA] ${texto}`);
    if (!url) return;
    const mensaje = `${negocio} · ${texto}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` lo leen Slack y Google Chat; `content`, Discord.
      body: JSON.stringify({ text: mensaje, content: mensaje }),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) throw new Error(`El webhook de alertas respondió ${r.status}`);
  };
}
