# Bot de WhatsApp con IA para negocios con citas

Chatbot para WhatsApp Business que atiende a los clientes de un negocio con citas (salón de uñas, barbería, spa, consultorio) las 24 horas: responde precios, duración, horario y preguntas frecuentes, toma los datos de quien quiere reservar y pasa la conversación a una persona cuando hace falta.

La demo usa **Estudio Nácar**, un salón de uñas **ficticio** ([`negocio/demo.md`](negocio/demo.md)). Para usarlo con otro negocio solo se escribe un archivo con su información: no hay que tocar código.

Construido con **TypeScript**, la **API oficial de WhatsApp Business (Meta)** y **Claude** (Anthropic) con herramientas.

## Qué hace

- **Responde solo con la información del negocio.** Precios, servicios y reglas viven en un archivo Markdown (`NEGOCIO` en `.env`; por defecto la demo). Si le preguntan algo que no está ahí, no lo inventa: lo dice y pasa a una persona.
- **Habla como el negocio y se adapta a cada cliente.** Responde de "usted" a quien lo trata de "usted" y corto a quien escribe corto, y no mete relleno ni presión de venta. Cada negocio puede ajustar su voz con una sección `## Tono` en su archivo; esa sección cambia el estilo, nunca las reglas.
- **Nunca confirma una cita que no puede ver.** El bot no tiene acceso a la agenda, así que no promete horas libres: pregunta servicio, día y nombre, guarda el lead y avisa que una persona confirma la hora y el abono.
- **Registra leads** en `datos/leads.csv` y, si se configura, en Google Sheets.
- **Pasa a una persona** cuando el cliente lo pide, se queja o envía una foto para cotizar. Desde ese momento el bot se calla en ese chat durante 12 horas y, si se configuró, avisa al número del asesor.
- **API oficial de Meta**, no automatización de WhatsApp Web: es lo que evita que bloqueen el número.

```
cliente ──WhatsApp──> Meta ──webhook firmado──> servidor ──> Claude ──┬─> respuesta ──> cliente
                                                                      ├─> registrar_lead ──> CSV / Google Sheets
                                                                      └─> pasar_a_humano ──> bot en pausa + aviso al asesor
```

## Probarlo en la terminal (sin cuenta de Meta)

```bash
npm install
cp .env.example .env   # pon tu ANTHROPIC_API_KEY
npm run chat
```

Escribe como si fueras un cliente. Debajo de cada respuesta se ven, en gris, los leads guardados y las veces que el bot pasa la conversación a una persona.

## Conectarlo a WhatsApp

1. En [developers.facebook.com](https://developers.facebook.com) crea una app con el producto WhatsApp y copia el token, el Phone Number ID y la clave secreta de la app en `.env`.
2. Arranca el servidor: `npm run servidor`, y exponlo con una URL pública (por ejemplo `ngrok http 3000`, o desplegándolo en Render o Railway).
3. En Meta → WhatsApp → Configuración, pon el webhook `https://tu-url/webhook`, el mismo `WHATSAPP_VERIFY_TOKEN` y suscríbete al campo `messages`.

El servidor verifica la firma `X-Hub-Signature-256` de cada webhook, responde 200 de inmediato, ignora los reintentos duplicados de Meta y atiende en orden los mensajes seguidos de una misma persona.

## Alcance

Qué resuelve el bot, qué pasa a una persona y qué no hace nunca: [`docs/alcance.md`](docs/alcance.md).

## Decisiones de diseño

- **El bot no ejecuta nada por su cuenta.** Las herramientas (`registrar_lead`, `pasar_a_humano`) solo devuelven acciones y el código decide qué hacer con ellas. Así se pueden probar sin efectos y cambiar el destino de los leads sin tocar el prompt.
- **La información del negocio es un archivo de texto.** Cambiar un precio no requiere programar.
- **El historial nunca se recorta.** Una conversación con más de 60 mensajes, o tras 24 horas sin mensajes, empieza de cero.
- **Siempre hay respuesta.** Si la llamada a Claude falla (sin créditos, clave inválida, caída) o el modelo se niega, el cliente recibe un mensaje de respaldo y la conversación pasa a una persona. Si falla el envío por WhatsApp, el lead se guarda igual y el asesor recibe el aviso de todas formas.

## Alertas

El servidor cuenta los fallos y avisa a `ALERTAS_WEBHOOK_URL` (Slack, Discord, Google Chat o n8n) cuando pasan un umbral. Las reglas están en [`src/alertas.ts`](src/alertas.ts). No se avisa por WhatsApp a propósito: si lo que falla es Meta, ese aviso tampoco llegaría. Sin la variable, las alertas quedan solo en los logs con el prefijo `[ALERTA]`.

| Alerta | Se dispara con | Qué suele ser |
| --- | --- | --- |
| 🔴 Aviso al asesor no llegó | 1 vez | Un cliente espera a una persona y nadie lo sabe (ventana de 24 h de Meta) |
| 🔴 Lead no guardado | 1 vez | Disco lleno o sin permisos; el lead queda en los logs |
| 🔴 Claude falla | 3 en 10 min | Créditos, clave o caída |
| 🔴 WhatsApp rechaza envíos | 3 en 10 min | Token de Meta vencido |
| 🔴 Mensajes aceptados pero no entregados | 3 en 30 min | Meta avisa después con estado `failed`: ventana de 24 h, número inválido, pago de la cuenta |
| 🟠 Mensaje de respaldo | 3 en 30 min | El modelo se niega o no sabe qué decir |
| 🟠 Respuestas lentas | 3 de más de 30 s en 30 min | Lentitud de la API de Claude |
| 🟠 Abuso | Un número manda más de 20 mensajes en 10 min | Spam u otro bot respondiéndole al tuyo; cada mensaje gasta créditos |
| 🟠 Demasiadas pasadas a persona | ≥ 5 y la mitad de los mensajes en 1 h | Falta información en el archivo del negocio |
| 🟠 Firmas inválidas | 10 en 10 min | Cambió el App Secret o alguien prueba el endpoint |
| 🟡 Google Sheets falla | 3 en 1 h | Los leads siguen en el CSV |
| 🟡 Silencio | Ningún mensaje en `ALERTA_SILENCIO_HORAS` (24 por defecto; 0 la apaga) | El webhook se desconectó en Meta: no hay errores, simplemente no llega nada |

Cada alerta se repite como máximo cada 30 minutos; la de silencio, una sola vez hasta que vuelva a llegar un mensaje.

**Lo que estas alertas no detectan:** una respuesta equivocada pero bien formada (un precio mal leído, un tono inadecuado). Eso no produce ningún error; se controla probando el bot con `npm run chat` antes de cada cambio de instrucciones (ver [`docs/alcance.md`](docs/alcance.md)) y revisando de vez en cuando conversaciones reales. Si el servidor se cae, no puede avisar de sí mismo: para eso apunta un monitor externo gratuito (UptimeRobot, Better Stack) a `GET /salud`, que también devuelve la hora del último mensaje y los errores de la última hora.

## Pruebas

```bash
npm test     # 32 pruebas, sin IA (el modelo se simula): herramientas, pausa por persona, firma, leads, datos de tarjeta, alertas
```

## Límites conocidos

- Las conversaciones viven en memoria: si el servidor se reinicia, empiezan de nuevo.
- El aviso al asesor llega solo si el asesor le escribió al número del negocio en las últimas 24 horas (regla de Meta para mensajes libres). Para avisos siempre garantizados haría falta una plantilla aprobada.
- No lee el contenido de imágenes ni notas de voz: las identifica y pasa la conversación a una persona.
