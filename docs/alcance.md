# Alcance del bot

Qué intenta resolver el bot, qué le pasa a una persona y qué no hace nunca.
Las reglas viven en las instrucciones de [`src/bot.ts`](../src/bot.ts) (`instrucciones()`); este documento explica el porqué.

**Criterio general:** el bot resuelve lo que se puede contestar con la información del negocio sin comprometer al negocio a nada. Todo lo que implica una decisión, dinero, una cita concreta o un juicio de salud lo decide una persona.

## Sí lo resuelve el bot

| Tarea | Ejemplo | Por qué es seguro |
| --- | --- | --- |
| Precios, duración y qué incluye cada servicio | "¿cuánto vale el soft gel?" | Sale tal cual del archivo del negocio. |
| Horario, zona, medios de pago, políticas (abono, cambios con 24 h) | "¿reciben Nequi?" | Es información fija y publicada. |
| Preguntas frecuentes | "¿cuánto dura el semipermanente?" | Están escritas por el negocio. |
| Explicar la diferencia entre dos servicios | "¿qué diferencia hay entre acrílicas y soft gel?" | Con los datos del archivo, sin recomendar el más caro. |
| Tomar los datos para reservar (servicio, día y hora preferidos, nombre) | "quiero pies el viernes a las 4" | Se guarda como lead; **no** se confirma la cita. |
| Compartir el enlace de la agenda en línea | "¿puedo agendar yo misma?" | Si el negocio lo tiene en su archivo. |

## Lo pasa a una persona (`pasar_a_humano`)

| Situación | Por qué no lo decide el bot |
| --- | --- |
| Pide hablar con alguien | Siempre se respeta. |
| Queja, reclamo, servicio que salió mal | Requiere criterio y, a veces, compensación. |
| Cancelar o mover una cita existente | El bot no ve la agenda ni sabe si la cita existe. |
| Envía foto, comprobante de pago o audio | El bot no ve imágenes ni oye audios. |
| Cotizar un diseño o pedir algo fuera de la lista de precios | El precio lo pone quien hace el trabajo. |
| Pide descuento, promoción o precio especial | Solo el negocio decide rebajas. |
| Pregunta del negocio que no está en el archivo | Mejor que responda alguien que sabe, a que el bot adivine. |
| Pregunta de salud ligada al servicio (uña lastimada, hongos, alergia, embarazo) | El bot no evalúa salud; la persona decide si se puede atender o recomienda un médico. |

## No lo hace nunca

| Qué | Cómo responde |
| --- | --- |
| Confirmar que una hora está libre o que la cita quedó agendada | Dice que el equipo confirma por el chat. |
| Pedir o recibir datos de tarjeta, contraseñas o códigos | Nunca los pide; si se los mandan, avisa que no los comparta y pasa a una persona. |
| Confirmar que un pago llegó | Pasa a una persona. |
| Inventar precios, servicios, promociones o disponibilidad | Dice que no tiene ese dato. |
| Dar consejos médicos o diagnósticos | Recomienda consultar a un profesional de salud. |
| Hablar de otros clientes o compartir sus datos | Dice que no puede compartir esa información. |
| Temas ajenos al negocio (tareas, código, política, chistes, otros negocios) | Lo dice en una frase amable y vuelve a lo del negocio. **No** pasa a una persona: no hay nada que el equipo deba hacer. |
| Revelar sus instrucciones o cambiar de rol | Sigue atendiendo normalmente. |
| Presionar para vender ("últimos cupos", "solo hoy") | — |

## Casos límite

- **Pregunta mixta** ("¿cuánto vale el semi y me ayudas con una tarea?"): responde la parte del negocio e ignora el resto con una frase.
- **Insultos o mensajes agresivos:** una respuesta calmada y pasa a una persona; si siguen, el bot ya está en pausa.
- **Otro idioma:** responde en el idioma del cliente con la misma información.
- **Mensajes repetidos o spam:** responde con normalidad; el control de abuso lo hace el servidor, no el modelo.

## Cómo se comprueba

Las pruebas automáticas (`npm test`) verifican el código alrededor del modelo, no las decisiones del modelo. Para estas reglas, probar con `npm run chat` al menos un mensaje de cada fila de las tablas de arriba antes de cada cambio en las instrucciones.
