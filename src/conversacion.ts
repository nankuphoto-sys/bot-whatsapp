import type Anthropic from "@anthropic-ai/sdk";
import type { Accion, Turno } from "./bot.js";
import { taparDatosSensibles } from "./privacidad.js";

/**
 * Estado de cada conversación por número de teléfono, en memoria.
 * Para un negocio pequeño alcanza; si el servidor se reinicia, las conversaciones empiezan de nuevo.
 */
interface Estado {
  mensajes: Anthropic.Beta.BetaMessageParam[];
  ultimoMensaje: number;
  /** Mientras sea mayor que ahora, el bot no responde: está atendiendo una persona. */
  humanoHasta: number;
}

export interface Opciones {
  /** Tras cuánto tiempo sin mensajes se empieza una conversación nueva. */
  horasInactividad: number;
  /** Cuánto tiempo calla el bot después de pasar la conversación a una persona. */
  horasModoHumano: number;
  /** Tope de mensajes por conversación; al llegar se empieza una nueva (nunca se recorta la vieja). */
  maxMensajes: number;
}

export const OPCIONES_POR_DEFECTO: Opciones = { horasInactividad: 24, horasModoHumano: 12, maxMensajes: 60 };

export type Responder = (mensajes: Anthropic.Beta.BetaMessageParam[], texto: string) => Promise<Turno>;

export interface Atencion {
  /** null cuando el bot no debe responder (una persona está atendiendo). */
  respuesta: string | null;
  acciones: Accion[];
  respaldo?: Turno["respaldo"];
}

export class Conversaciones {
  private estados = new Map<string, Estado>();
  /** Una cola por teléfono: dos mensajes seguidos de la misma persona se responden en orden. */
  private colas = new Map<string, Promise<unknown>>();

  constructor(
    private responder: Responder,
    private opciones: Opciones = OPCIONES_POR_DEFECTO,
    private ahora: () => number = Date.now,
  ) {}

  atender(telefono: string, texto: string): Promise<Atencion> {
    const anterior = this.colas.get(telefono) ?? Promise.resolve();
    const siguiente = anterior.catch(() => undefined).then(() => this.atenderEnOrden(telefono, texto));
    this.colas.set(telefono, siguiente);
    return siguiente;
  }

  /** Devuelve el control al bot antes de que venza el modo humano. */
  reactivarBot(telefono: string): void {
    const estado = this.estados.get(telefono);
    if (estado) estado.humanoHasta = 0;
  }

  enModoHumano(telefono: string): boolean {
    return (this.estados.get(telefono)?.humanoHasta ?? 0) > this.ahora();
  }

  private async atenderEnOrden(telefono: string, texto: string): Promise<Atencion> {
    const ahora = this.ahora();
    const hora = 3600 * 1000;
    let estado = this.estados.get(telefono);
    const vencida = estado && ahora - estado.ultimoMensaje > this.opciones.horasInactividad * hora;
    if (!estado || vencida || estado.mensajes.length >= this.opciones.maxMensajes) {
      estado = { mensajes: [], ultimoMensaje: ahora, humanoHasta: estado?.humanoHasta ?? 0 };
      this.estados.set(telefono, estado);
    }
    estado.ultimoMensaje = ahora;

    if (estado.humanoHasta > ahora) return { respuesta: null, acciones: [] };

    const turno = await this.responder(estado.mensajes, taparDatosSensibles(texto));
    if (turno.acciones.some((a) => a.tipo === "humano")) {
      estado.humanoHasta = ahora + this.opciones.horasModoHumano * hora;
    }
    return { respuesta: turno.texto, acciones: turno.acciones, respaldo: turno.respaldo };
  }
}
