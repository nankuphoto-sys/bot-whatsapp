import { createHmac } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { campoCsv, guardarLead } from "../src/leads.js";
import { extraerFallosDeEntrega, extraerMensajes, firmaValida } from "../src/whatsapp.js";

describe("firmaValida", () => {
  const cuerpo = '{"entry":[]}';
  const firma = "sha256=" + createHmac("sha256", "secreto").update(cuerpo).digest("hex");

  it("acepta la firma correcta y rechaza cuerpo alterado, otro secreto o cabecera ausente", () => {
    expect(firmaValida(cuerpo, firma, "secreto")).toBe(true);
    expect(firmaValida(cuerpo + " ", firma, "secreto")).toBe(false);
    expect(firmaValida(cuerpo, firma, "otro")).toBe(false);
    expect(firmaValida(cuerpo, undefined, "secreto")).toBe(false);
    expect(firmaValida(cuerpo, "sha256=abc", "secreto")).toBe(false);
  });
});

describe("extraerMensajes", () => {
  const webhook = (messages: object[]) => ({ entry: [{ changes: [{ value: { messages } }] }] });

  it("lee texto, botones e imágenes con su descripción", () => {
    const r = extraerMensajes(
      webhook([
        { id: "1", from: "57300", type: "text", text: { body: "Hola" } },
        { id: "2", from: "57300", type: "interactive", interactive: { button_reply: { title: "Reservar" } } },
        { id: "3", from: "57300", type: "image", image: { caption: "así las quiero" } },
      ]),
    );
    expect(r.map((m) => m.texto)).toEqual(["Hola", "Reservar", '[El cliente envió una imagen] con el texto: "así las quiero"']);
  });

  it("lee los avisos de entrega fallida y descarta los entregados o leídos", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [
                  { status: "delivered", recipient_id: "57300" },
                  { status: "failed", recipient_id: "57311", errors: [{ code: 131047, title: "Re-engagement message" }] },
                  { status: "failed", recipient_id: "57322" },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(extraerFallosDeEntrega(payload)).toEqual([
      { para: "57311", error: "131047 Re-engagement message" },
      { para: "57322", error: "sin detalle" },
    ]);
    expect(extraerFallosDeEntrega(null)).toEqual([]);
  });

  it("ignora los avisos de estado y los cuerpos sin mensajes", () => {
    expect(extraerMensajes({ entry: [{ changes: [{ value: { statuses: [{ status: "read" }] } }] }] })).toEqual([]);
    expect(extraerMensajes(null)).toEqual([]);
  });
});

describe("leads", () => {
  it("escapa comas, comillas y saltos de línea", () => {
    expect(campoCsv("Ana")).toBe("Ana");
    expect(campoCsv('dijo "sábado", tarde')).toBe('"dijo ""sábado"", tarde"');
  });

  it("detecta cuando Google Sheets rechaza el lead aunque responda 200", async () => {
    const archivo = join(await mkdtemp(join(tmpdir(), "leads-")), "leads.csv");
    const lead = { nombre: "Ana", servicio: "Pedicure spa", fecha_preferida: "viernes", notas: "" };
    const original = globalThis.fetch;
    try {
      globalThis.fetch = (async () => new Response('{"ok":false,"error":"clave incorrecta"}', { status: 200 })) as typeof fetch;
      expect(await guardarLead("57300", lead, { archivo, webhookSheets: "https://ejemplo" })).toEqual({
        errorSheets: "Google Sheets rechazó el lead: clave incorrecta",
      });
      globalThis.fetch = (async () => new Response('{"ok":true}', { status: 200 })) as typeof fetch;
      expect(await guardarLead("57300", lead, { archivo, webhookSheets: "https://ejemplo" })).toEqual({});
    } finally {
      globalThis.fetch = original;
    }
  });

  it("escribe el encabezado solo la primera vez", async () => {
    const archivo = join(await mkdtemp(join(tmpdir(), "leads-")), "leads.csv");
    const lead = { nombre: "Ana", servicio: "Pedicure spa", fecha_preferida: "viernes", notas: "" };
    const ahora = new Date("2026-10-17T15:00:00Z");
    await guardarLead("57300", lead, { archivo, ahora });
    await guardarLead("57311", lead, { archivo, ahora });
    expect((await readFile(archivo, "utf8")).split("\r\n")).toEqual([
      "fecha,telefono,nombre,servicio,fecha_preferida,notas",
      "2026-10-17T15:00:00.000Z,57300,Ana,Pedicure spa,viernes,",
      "2026-10-17T15:00:00.000Z,57311,Ana,Pedicure spa,viernes,",
      "",
    ]);
  });
});
