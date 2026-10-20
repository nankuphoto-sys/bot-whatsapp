import { describe, expect, it } from "vitest";
import type { Accion } from "../src/bot.js";
import { Conversaciones, type Responder } from "../src/conversacion.js";

const HORA = 3600 * 1000;

function preparar(acciones: Accion[][] = []) {
  let ahora = 0;
  const largos: number[] = [];
  const responder: Responder = async (mensajes, texto) => {
    largos.push(mensajes.length);
    mensajes.push({ role: "user", content: texto }, { role: "assistant", content: "ok" });
    return { texto: `eco: ${texto}`, acciones: acciones.shift() ?? [] };
  };
  const conv = new Conversaciones(responder, { horasInactividad: 24, horasModoHumano: 12, maxMensajes: 6 }, () => ahora);
  return { conv, largos, avanzar: (ms: number) => (ahora += ms) };
}

describe("Conversaciones", () => {
  it("mantiene el historial por teléfono", async () => {
    const { conv, largos } = preparar();
    await conv.atender("57300", "hola");
    await conv.atender("57311", "hola");
    await conv.atender("57300", "precio");
    expect(largos).toEqual([0, 0, 2]);
  });

  it("calla al bot mientras atiende una persona y vuelve al vencer el plazo", async () => {
    const { conv, avanzar } = preparar([[{ tipo: "humano", motivo: "queja" }]]);
    expect((await conv.atender("57300", "quiero hablar con alguien")).respuesta).toBe("eco: quiero hablar con alguien");
    expect(await conv.atender("57300", "¿hola?")).toEqual({ respuesta: null, acciones: [] });
    avanzar(13 * HORA);
    expect((await conv.atender("57300", "hola de nuevo")).respuesta).toBe("eco: hola de nuevo");
  });

  it("reactivarBot devuelve el control antes de tiempo", async () => {
    const { conv } = preparar([[{ tipo: "humano", motivo: "queja" }]]);
    await conv.atender("57300", "queja");
    expect(conv.enModoHumano("57300")).toBe(true);
    conv.reactivarBot("57300");
    expect((await conv.atender("57300", "gracias")).respuesta).toBe("eco: gracias");
  });

  it("empieza una conversación nueva tras la inactividad o al llegar al tope, sin recortar la anterior", async () => {
    const { conv, largos, avanzar } = preparar();
    await conv.atender("57300", "a");
    await conv.atender("57300", "b");
    avanzar(25 * HORA);
    await conv.atender("57300", "c");
    await conv.atender("57300", "d");
    await conv.atender("57300", "e");
    await conv.atender("57300", "f");
    expect(largos).toEqual([0, 2, 0, 2, 4, 0]);
  });

  it("responde en orden dos mensajes seguidos de la misma persona", async () => {
    const { conv } = preparar();
    const [a, b] = await Promise.all([conv.atender("57300", "uno"), conv.atender("57300", "dos")]);
    expect([a.respuesta, b.respuesta]).toEqual(["eco: uno", "eco: dos"]);
  });
});
