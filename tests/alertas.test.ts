import { describe, expect, it } from "vitest";
import { ABUSO_MENSAJES, LENTO_SEG, Monitor, PAUSA_MIN, REGLAS, type Regla } from "../src/alertas.js";

const MIN = 60 * 1000;

/** Monitor con reloj controlado; las alertas se guardan en `avisos`. */
function monitor(reglas: Regla[]) {
  let t = 0;
  const avisos: string[] = [];
  const m = new Monitor((texto) => void avisos.push(texto), reglas, () => t);
  return { m, avisos, avanzar: (min: number) => (t += min * MIN) };
}

const esperar = () => new Promise((r) => setTimeout(r, 0));
const errores: Regla = { evento: "error_modelo", umbral: 3, ventanaMin: 10, texto: "Claude falla" };

describe("Monitor", () => {
  it("avisa al llegar al umbral dentro de la ventana, con el último detalle", async () => {
    const { m, avisos } = monitor([errores]);
    m.registrar("error_modelo");
    m.registrar("error_modelo");
    await esperar();
    expect(avisos).toEqual([]);
    m.registrar("error_modelo", "credit balance too low");
    await esperar();
    expect(avisos).toEqual(["Claude falla\nÚltimo error: credit balance too low"]);
  });

  it("no cuenta los eventos que ya salieron de la ventana", async () => {
    const { m, avisos, avanzar } = monitor([errores]);
    m.registrar("error_modelo");
    m.registrar("error_modelo");
    avanzar(11);
    m.registrar("error_modelo");
    await esperar();
    expect(avisos).toEqual([]);
  });

  it("no repite la misma alerta hasta que pasa la pausa", async () => {
    const { m, avisos, avanzar } = monitor([{ ...errores, umbral: 1 }]);
    m.registrar("error_modelo");
    m.registrar("error_modelo");
    avanzar(PAUSA_MIN - 1);
    m.registrar("error_modelo");
    await esperar();
    expect(avisos).toHaveLength(1);
    avanzar(1);
    m.registrar("error_modelo");
    await esperar();
    expect(avisos).toHaveLength(2);
  });

  it("una regla con proporción exige también ese porcentaje", async () => {
    const regla: Regla = { evento: "humano", umbral: 2, ventanaMin: 60, proporcion: { de: "mensaje", minima: 0.5 }, texto: "Muchas pasadas" };
    const { m, avisos } = monitor([regla]);
    for (let i = 0; i < 6; i++) m.registrar("mensaje");
    m.registrar("humano");
    m.registrar("humano");
    await esperar();
    expect(avisos).toEqual([]); // 2 de 6 mensajes
    m.registrar("humano");
    await esperar();
    expect(avisos).toEqual(["Muchas pasadas"]); // 3 de 6
  });

  it("si enviar la alerta falla, no lanza", async () => {
    const m = new Monitor(() => Promise.reject(new Error("webhook caído")), [{ ...errores, umbral: 1 }]);
    expect(() => m.registrar("error_modelo")).not.toThrow();
    await esperar();
  });

  it("avisa de abuso una sola vez cuando un número pasa el límite, no por mensajes de varios números", async () => {
    const { m, avisos } = monitor(REGLAS);
    for (let i = 0; i < 30; i++) m.registrarMensaje(`5730${i}`); // 30 personas distintas: normal
    for (let i = 0; i < ABUSO_MENSAJES + 5; i++) m.registrarMensaje("573999");
    await esperar();
    const abuso = avisos.filter((a) => a.includes("Un número mandó"));
    expect(abuso).toHaveLength(1);
    expect(abuso[0]).toContain("+573999");
  });

  it("cuenta una respuesta como lenta solo si pasa el límite", async () => {
    const lentas: Regla = { evento: "lento", umbral: 2, ventanaMin: 30, texto: "Lento" };
    const { m, avisos } = monitor([lentas]);
    m.registrarDuracion(5_000, "57300");
    m.registrarDuracion((LENTO_SEG + 1) * 1000, "57300");
    await esperar();
    expect(avisos).toEqual([]);
    m.registrarDuracion(45_000, "57311");
    await esperar();
    expect(avisos).toEqual(["Lento\nÚltimo error: 45 s para +57311"]);
  });

  it("avisa del silencio una vez y vuelve a vigilar cuando llega un mensaje", async () => {
    const silencio: Regla = { evento: "silencio", umbral: 1, ventanaMin: 60, texto: "Silencio" };
    const { m, avisos, avanzar } = monitor([silencio]);
    avanzar(23 * 60);
    m.revisarSilencio(24);
    await esperar();
    expect(avisos).toEqual([]); // cuenta desde que arrancó
    avanzar(61);
    m.revisarSilencio(24);
    m.revisarSilencio(24);
    avanzar(24 * 60);
    m.revisarSilencio(24);
    await esperar();
    expect(avisos).toHaveLength(1); // no repite mientras siga el mismo silencio
    m.registrarMensaje("57300");
    avanzar(24 * 60 + 1);
    m.revisarSilencio(24);
    await esperar();
    expect(avisos).toHaveLength(2);
  });

  it("resume el estado para /salud", () => {
    const { m } = monitor([]);
    expect(m.estado().ultimoMensaje).toBeNull();
    m.registrar("mensaje");
    m.registrar("error_envio");
    expect(m.estado()).toMatchObject({ estado: "ok", erroresUltimaHora: { error_envio: 1 } });
    expect(m.estado().ultimoMensaje).not.toBeNull();
  });
});
