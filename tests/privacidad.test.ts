import { describe, expect, it } from "vitest";
import { Conversaciones } from "../src/conversacion.js";
import { CODIGO_OCULTO, pasaLuhn, TARJETA_OCULTA, taparDatosSensibles } from "../src/privacidad.js";

describe("taparDatosSensibles", () => {
  it("tapa números de tarjeta válidos, con o sin separadores", () => {
    expect(taparDatosSensibles("mi tarjeta 4111 1111 1111 1111 vence 12/28")).toBe(`mi tarjeta ${TARJETA_OCULTA} vence 12/28`);
    expect(taparDatosSensibles("5500-0000-0000-0004")).toBe(TARJETA_OCULTA);
    expect(taparDatosSensibles("378282246310005")).toBe(TARJETA_OCULTA); // American Express, 15 dígitos
  });

  it("tapa el código de seguridad", () => {
    expect(taparDatosSensibles("el cvv es 123")).toBe(`el cvv es ${CODIGO_OCULTO}`);
    expect(taparDatosSensibles("Código de seguridad: 4567")).toBe(`Código de seguridad: ${CODIGO_OCULTO}`);
  });

  it("no toca teléfonos, cédulas, precios ni secuencias que no pasan Luhn", () => {
    const textos = [
      "mi celular es 300 123 4567",
      "Nequi 3001234567, cédula 1.020.304.050",
      "el semipermanente vale $55.000",
      "referencia 4111 1111 1111 1112",
      "pedido 123 456",
    ];
    for (const t of textos) expect(taparDatosSensibles(t)).toBe(t);
  });

  it("Luhn", () => {
    expect(pasaLuhn("4111111111111111")).toBe(true);
    expect(pasaLuhn("4111111111111112")).toBe(false);
  });
});

describe("Conversaciones", () => {
  it("el modelo y el historial nunca reciben el número de tarjeta", async () => {
    const recibidos: string[] = [];
    const conv = new Conversaciones(async (mensajes, texto) => {
      recibidos.push(texto);
      mensajes.push({ role: "user", content: texto });
      return { texto: "ok", acciones: [] };
    });
    await conv.atender("57300", "para el abono: 4111 1111 1111 1111 cvv 123");
    expect(recibidos[0]).toBe(`para el abono: ${TARJETA_OCULTA} cvv ${CODIGO_OCULTO}`);
    expect(recibidos[0]).not.toMatch(/4111/);
  });
});
