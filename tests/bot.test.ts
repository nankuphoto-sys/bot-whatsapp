import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { instrucciones, nombreDelNegocio, RESPUESTA_DE_RESPALDO, responder, type Crear } from "../src/bot.js";

describe("instrucciones", () => {
  it("toma el nombre del negocio del primer título del archivo", () => {
    const info = "# Estudio Nácar — uñas y spa\n\nPrecios...";
    expect(nombreDelNegocio(info)).toBe("Estudio Nácar");
    expect(instrucciones(info)).toContain("asistente de WhatsApp de Estudio Nácar");
    expect(nombreDelNegocio("sin título")).toBe("el negocio");
  });
});

type Bloque = Anthropic.Beta.BetaContentBlock;

/** Respuesta falsa del modelo: solo los campos que usa el bot. */
const respuesta = (content: unknown[], stop_reason: string) => ({ content, stop_reason }) as unknown as Anthropic.Beta.BetaMessage;
const texto = (t: string) => ({ type: "text", text: t }) as Bloque;
const herramienta = (id: string, name: string, input: object) => ({ type: "tool_use", id, name, input }) as Bloque;

/** Devuelve las respuestas en orden y guarda una copia de lo que se le pidió en cada paso. */
function modeloFalso(...respuestas: Anthropic.Beta.BetaMessage[]) {
  const peticiones: unknown[] = [];
  const crear: Crear = async (p) => {
    peticiones.push(structuredClone(p));
    const r = respuestas.shift();
    if (!r) throw new Error("No hay más respuestas preparadas");
    return r;
  };
  return { crear, peticiones };
}

describe("responder", () => {
  it("responde con el texto del modelo y agrega el turno al historial", async () => {
    const { crear } = modeloFalso(respuesta([texto("El semipermanente cuesta $60.000.")], "end_turn"));
    const historial: Anthropic.Beta.BetaMessageParam[] = [];
    const turno = await responder(crear, "sistema", historial, "¿Cuánto vale el semi?");
    expect(turno).toEqual({ texto: "El semipermanente cuesta $60.000.", acciones: [] });
    expect(historial.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("ejecuta registrar_lead, devuelve el resultado al modelo y luego responde", async () => {
    const lead = { nombre: "Ana", servicio: "Uñas acrílicas", fecha_preferida: "sábado 10 a.m.", notas: "" };
    const { crear, peticiones } = modeloFalso(
      respuesta([herramienta("t1", "registrar_lead", lead)], "tool_use"),
      respuesta([texto("¡Listo, Ana! Te confirmamos la hora por aquí.")], "end_turn"),
    );
    const historial: Anthropic.Beta.BetaMessageParam[] = [];
    const turno = await responder(crear, "sistema", historial, "Quiero acrílicas el sábado a las 10, soy Ana");

    expect(turno.acciones).toEqual([{ tipo: "lead", lead }]);
    expect(turno.texto).toContain("Ana");
    const segunda = peticiones[1] as { messages: Anthropic.Beta.BetaMessageParam[] };
    const ultimo = segunda.messages.at(-1)!;
    expect(ultimo.role).toBe("user");
    expect((ultimo.content as { type: string; tool_use_id: string }[])[0]).toMatchObject({ type: "tool_result", tool_use_id: "t1" });
  });

  it("pide pasar a una persona cuando el modelo usa pasar_a_humano", async () => {
    const { crear } = modeloFalso(
      respuesta([herramienta("t1", "pasar_a_humano", { motivo: "Envió una foto para cotizar" })], "tool_use"),
      respuesta([texto("Ya le paso tu foto al equipo.")], "end_turn"),
    );
    const turno = await responder(crear, "sistema", [], "[El cliente envió una imagen]");
    expect(turno.acciones).toEqual([{ tipo: "humano", motivo: "Envió una foto para cotizar" }]);
  });

  it("si la llamada al modelo falla, responde con el respaldo, pasa a una persona y deshace el turno", async () => {
    const crear: Crear = async () => {
      throw new Error("credit balance too low");
    };
    const historial: Anthropic.Beta.BetaMessageParam[] = [];
    const turno = await responder(crear, "sistema", historial, "hola");
    expect(turno.texto).toBe(RESPUESTA_DE_RESPALDO);
    expect(turno.acciones[0]?.tipo).toBe("humano");
    expect(turno.respaldo).toEqual({ motivo: "error_modelo", detalle: "credit balance too low" });
    expect(historial).toEqual([]);
  });

  it("si el modelo se niega, responde con el mensaje de respaldo y pasa a una persona", async () => {
    const { crear } = modeloFalso(respuesta([], "refusal"));
    const turno = await responder(crear, "sistema", [], "hola");
    expect(turno.texto).toBe(RESPUESTA_DE_RESPALDO);
    expect(turno.acciones[0]?.tipo).toBe("humano");
  });

  it("marca como error una herramienta desconocida en vez de fallar", async () => {
    const { crear, peticiones } = modeloFalso(
      respuesta([herramienta("t1", "borrar_todo", {})], "tool_use"),
      respuesta([texto("¿En qué te ayudo?")], "end_turn"),
    );
    const turno = await responder(crear, "sistema", [], "hola");
    expect(turno.acciones).toEqual([]);
    const resultado = ((peticiones[1] as { messages: Anthropic.Beta.BetaMessageParam[] }).messages.at(-1)!.content as { is_error?: boolean }[])[0];
    expect(resultado.is_error).toBe(true);
  });
});
