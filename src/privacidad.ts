/**
 * Tapa datos de pago antes de que el mensaje llegue al modelo o al historial.
 * Las instrucciones ya le dicen al bot que no pida estos datos, pero si el cliente los pega
 * igual, el código se asegura de que no salgan del servidor.
 */

export const TARJETA_OCULTA = "[número de tarjeta borrado por seguridad]";
export const CODIGO_OCULTO = "[código de seguridad borrado]";

/** Algoritmo de Luhn: lo cumplen los números de tarjeta reales y casi nunca un teléfono o una cédula. */
export function pasaLuhn(digitos: string): boolean {
  let suma = 0;
  for (let i = 0; i < digitos.length; i++) {
    let d = Number(digitos[digitos.length - 1 - i]);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    suma += d;
  }
  return suma % 10 === 0;
}

/** 13 a 19 dígitos, que pueden venir separados por espacios, guiones o puntos. */
const POSIBLE_TARJETA = /\d(?:[ .-]?\d){12,18}/g;
const CODIGO_SEGURIDAD = /\b(cvv2?|cvc2?|c[oó]digo de seguridad)(\s*(?:es|:|=)?\s*)\d{3,4}\b/gi;

export function taparDatosSensibles(texto: string): string {
  return texto
    .replace(POSIBLE_TARJETA, (coincidencia) => {
      const digitos = coincidencia.replace(/\D/g, "");
      return digitos.length >= 13 && digitos.length <= 19 && pasaLuhn(digitos) ? TARJETA_OCULTA : coincidencia;
    })
    .replace(CODIGO_SEGURIDAD, (_, etiqueta: string, separador: string) => `${etiqueta}${separador}${CODIGO_OCULTO}`);
}
