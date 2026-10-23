# Base de conocimiento del asistente de FLOQQ

23 oct. 2026 · @Floqq

Esta es la única fuente a partir de la cual responde el asistente de ayuda de FLOQQ. Cada regla refleja decisiones tomadas para el piloto de BCN; todo lo marcado como **TO DECIDE** aún no está decidido y el asistente nunca debe prometerlo.

- Responder con el lenguaje de los pasajeros, sin términos técnicos.
- Cuando una regla cambie en la app, actualizarla aquí el mismo día, para que el asistente nunca contradiga a la app.
- El asistente responde en el idioma de la app del usuario (EN, FR, ES); la versión en inglés es la de referencia.

## Qué es FLOQQ

FLOQQ pone en contacto a viajeros que aterrizan en el aeropuerto de Barcelona (BCN) más o menos a la misma hora y que van en direcciones compatibles, para que compartan un taxi normal del aeropuerto y dividan la tarifa.

- FLOQQ no tiene ni gestiona taxis y no tiene conductores. Los pasajeros toman juntos el siguiente taxi normal de la parada.
- FLOQQ organiza el emparejamiento, el punto de encuentro, la insignia del grupo y el reparto justo de la tarifa.
- FLOQQ cobra una tarifa de plataforma de **2,49 € por pasajero**. Se reserva en la tarjeta cuando el pasajero asegura su plaza en un grupo y se cobra junto con su parte del taxi después del trayecto. La tarifa del taxi va aparte.
- Alcance del piloto: solo BCN, Terminal 1 y Terminal 2.

**Dos formas de usarla**

1. **Antes de aterrizar:** introduce tu número de vuelo y tu destino antes de volar. FLOQQ busca viajeros mientras estás en el aire y te da el resultado al aterrizar.
2. **Ya has aterrizado:** abre la app en el aeropuerto, elige tu destino y tu terminal, y únete a viajeros que quieren compartir ahora mismo.

**El recorrido en la app:** solicitar un trayecto → buscando tu coincidencia → grupo encontrado (asegura tu plaza) → grupo confirmado → encuentra a tu grupo en el punto de encuentro → en camino → trayecto completado.

## Cuenta y perfil

- **Edad mínima: 18 años.** La fecha de nacimiento es obligatoria al registrarse. Los menores de 18 años no pueden crear una cuenta ni solicitar trayectos.
- **Verificación del correo:** las cuentas nuevas deben confirmar su correo antes de solicitar un trayecto. El correo de verificación se puede reenviar desde la pantalla de espera; revisa la carpeta de spam.
- **Inicio de sesión:** correo y contraseña, Apple o Google.
- **Nombre:** el nombre y los apellidos se editan en Perfil. Los demás pasajeros solo ven el nombre de pila.
- **Cambio de correo:** en Perfil. Se envía un enlace de confirmación a la nueva dirección; el cambio solo se aplica cuando se confirma, y el correo antiguo sigue funcionando hasta entonces. Cuentas de Apple o Google: el correo lo gestiona Apple o Google y no se puede cambiar en FLOQQ.
- **Fecha de nacimiento:** el usuario no puede editarla una vez introducida. Para corregirla, contacta con soporte (traspaso a una persona).
- **Idioma:** la app sigue el idioma del teléfono (EN, FR, ES disponibles; los demás pasan a inglés).
- **Método de pago:** se guarda una vez (Apple Pay, Google Pay o tarjeta) en Perfil → Métodos de pago, donde se puede cambiar.

## Solicitar un trayecto

| Campo | Regla |
| --- | --- |
| Fecha de llegada | Obligatoria. |
| Número de vuelo | Opcional. Si se introduce, la hora de llegada se rellena automáticamente con los datos del vuelo y no se puede editar. |
| Hora de llegada | Se rellena con el vuelo, o la escribe el usuario (con la opción «Ahora») cuando no hay número de vuelo. Las horas escritas son siempre hora de Barcelona. |
| Terminal | T1 o T2. Se fija automáticamente según la aerolínea cuando se da un número de vuelo («¿No es correcto?» permite cambiarla). Elección obligatoria sin número de vuelo. |
| Destino | Búsqueda de dirección (Google). |
| Equipaje grande (máx. 30 kg) | 0 o 1. Cuenta como equipaje facturado. |
| Equipaje de mano | 0, 1 o 2. |
| Espera máx. para formar el grupo | Minutos que el pasajero está dispuesto a esperar a que los demás estén listos. No es la espera del taxi. |
| Pregunta de equipaje facturado | Solo sin número de vuelo: «¿Todavía tienes que recoger equipaje facturado?» |

- **Un solo trayecto activo a la vez.** Para reservar otro, el usuario consulta o cancela primero el actual.
- **Editar:** posible mientras el trayecto sigue buscando o el grupo aún no está confirmado («Editar» en la pantalla Buscando tu coincidencia). Una vez confirmado el grupo, el trayecto no se puede editar: el usuario cancela y crea una solicitud nueva.
- Editar un trayecto que estaba en un grupo en formación lo saca de ese grupo y vuelve a buscar con los nuevos datos.

## Cómo funciona el emparejamiento

FLOQQ busca coincidencias **cada 5 minutos**; no hay una espera máxima garantizada, porque una coincidencia depende de que existan viajeros compatibles.

- **Tamaño del grupo:** de 2 a 3 pasajeros por taxi.
- **Solo la misma terminal:** los pasajeros de la T1 nunca se agrupan con los de la T2.
- **Justo para cada persona:** se comprueban los límites de cada pasajero (tiempo de espera, desvío de ruta, espacio para equipaje), nunca una media. Límites de desvío: **TO DECIDE** (valores pendientes de aprobación).
- **Hora en que estás listo** = cuándo un pasajero puede llegar razonablemente al punto de encuentro, contada desde la llegada del avión a la puerta:

| Vuelo | Sin equipaje facturado | Con equipaje facturado |
| --- | --- | --- |
| Origen Schengen | +15 min | +30 min |
| Origen no Schengen (p. ej. Reino Unido, EE. UU.) | +35 min | +50 min |

- Sin número de vuelo: listo en unos 5 min, o 15 min si queda equipaje facturado por recoger.
- **Hora de encuentro** = la hora más tardía a la que está listo un miembro del grupo. Un grupo solo se forma si nadie esperaría más que su propia espera máxima.
- **Retrasos de vuelo:** las horas se actualizan automáticamente. Un grupo en formación se vuelve a comprobar; un grupo confirmado afectado por un gran cambio lo revisa FLOQQ.
- **Sin coincidencia:** si no se encuentra a nadie compatible antes de la hora de llegada más la espera máxima del pasajero, el trayecto se marca como **Caducado - no se encontró ninguna coincidencia**. No se cobra nada y el usuario puede crear una solicitud nueva.

## Grupo encontrado y asegurar tu plaza

- Cuando se encuentra una coincidencia, el pasajero ve el grupo (nombres de pila, avatares, barrio de cada destino, nunca direcciones exactas), la ruta prevista, la tarifa total estimada y su parte estimada.
- **«Asegurar mi plaza»** reserva un importe en el método de pago guardado: la parte estimada del taxi, la tarifa de plataforma de 2,49 € y un margen por si el taxímetro sube más. Es una retención temporal, no un cobro. Después del trayecto solo se cobran la parte real y la tarifa; el resto se libera.
- Una plaza solo cuenta como asegurada cuando el proveedor de pago confirma la reserva. Si un pago falla, el pasajero puede reintentarlo o cambiar de tarjeta; no hay forma de continuar sin pagar.
- **«No me interesa»** rechaza la coincidencia: el pasajero sale de este grupo y la búsqueda continúa. No se cobra nada por rechazar antes de asegurar.
- **Plazo de respuesta:** una coincidencia debe aceptarse en un tiempo determinado, mostrado como cuenta atrás. Valor: **TO DECIDE**. Si alguien no responde a tiempo, se le retira y los demás vuelven a emparejarse.
- El grupo queda **confirmado** cuando todos los miembros han asegurado su plaza. Solo entonces están disponibles el punto de encuentro y la insignia.

## Encontrar a tu grupo

- **Punto de encuentro:** un lugar reconocible en el vestíbulo público de llegadas de tu terminal, después de la recogida de equipajes (por ejemplo el punto de información turística o una cafetería). Los grupos que se encuentran a la misma hora tienen puntos distintos. La tarjeta muestra una foto, cómo llegar desde la salida de equipajes, la hora de encuentro y un botón «Abrir en Google Maps». Una cafetería cerrada sigue siendo un punto de encuentro válido: quedad delante.
- **«Encontrar a mi grupo»:** en la pantalla Grupo confirmado. Antes de aterrizar muestra una vista previa; después de aterrizar inicia la guía.
- **Guía con flecha:** señala el punto de encuentro usando la ubicación del teléfono, que se queda en el teléfono. En interiores el GPS puede fallar entre 10 y 50 m, así que cerca del punto la app muestra la foto y las indicaciones en lugar de la flecha.
- **«Estoy en el punto de encuentro»:** un toque avisa al grupo de que has llegado. Un toque por error se puede deshacer.
- **Insignia:** cada grupo recibe un color, una forma y un número. «Mostrar nuestra insignia» la muestra a pantalla completa; levanta el teléfono y busca la misma insignia.
- **Compartir ubicación con el grupo:** opcional, desactivado por defecto. Solo lo ven los miembros del grupo, solo mientras la pantalla de encuentro está abierta, y se detiene automáticamente cuando empieza el trayecto.
- **Chat de grupo:** todavía no disponible. Para encontraros, usad la foto y las indicaciones del punto de encuentro, «Mostrar nuestra insignia» y «Estoy en el punto de encuentro».
- **«He encontrado a mi grupo»:** cada miembro lo confirma. Cuando todos han confirmado, id juntos a la parada de taxis y tocad «Estamos en el taxi».
- **Falta alguien:** después de 10 minutos, los demás pueden seguir esperando o continuar sin esa persona (marcada como no presentada; deben quedar al menos 2 pasajeros).

## El trayecto y los pagos

- **Dos importes distintos:** la tarifa de FLOQQ de 2,49 € y la parte del pasajero en la tarifa del taxi. Ambos se reservan juntos al asegurar la plaza y se cobran juntos después del trayecto.
- **Quién paga al taxista:** el pasajero cuya parada es la última de la ruta, ya que es el único que sigue en el taxi cuando se para el taxímetro. Se le avisa antes del trayecto. Su propia parte va directamente al taxi, así que FLOQQ solo le cobra la tarifa de 2,49 €.
- **Las partes de los demás:** se reservan en sus tarjetas cuando aseguraron su plaza y se cobran por el importe exacto después del trayecto. La parte no usada de la retención se libera.
- **Recibo:** al final, quien paga fotografía el recibo del taxi en la app. La app lee el total de la foto; quien paga nunca lo escribe. Si la foto no se ve bien o no corresponde al trayecto, el equipo de FLOQQ la revisa a mano.
- **Reparto justo:** FLOQQ calcula cada parte a partir del total real del recibo y de la ruta: cada tramo del trayecto lo comparten los pasajeros que siguen en el taxi durante ese tramo. Nadie paga los kilómetros después de bajarse. Los pasajeros no tienen que hacer nada para esto.
- **Reembolso a quien paga:** recibe las partes de los demás pasajeros a través de la app.
- **Pantalla «En camino»:** solo informativa. FLOQQ no sigue el taxi.
- **«He llegado»:** cada pasajero lo toca al bajarse; abre el resumen Trayecto completado. Los importes muestran «Pendiente» hasta que se procesa el recibo.
- **Valoración:** opcional, de 1 a 5 estrellas; por debajo de 5 estrellas, un breve formulario pregunta qué se podría mejorar.

**TO DECIDE antes de que el asistente responda con detalle:** plazo para reclamar los importes del recibo, plazo y alternativa si quien paga nunca sube el recibo, condiciones exactas de la Garantía de pago del trayecto (si FLOQQ cubre una parte que no se puede cobrar) y plazo de pago a quien paga. La validación legal del flujo de pago en España está pendiente.

## Cancelaciones, reembolsos y retrasos

| Situación | Qué pasa |
| --- | --- |
| Cancelar mientras sigue buscando | Gratis. Trayecto cancelado, no se cobra nada. |
| Rechazar una coincidencia antes de asegurar | Gratis. La búsqueda continúa. |
| No se encuentra coincidencia a tiempo | El trayecto caduca automáticamente. No se cobra nada. |
| Cancelar después de asegurar la plaza, antes de que se confirme el grupo | Gratis. Se libera toda la reserva, tarifa incluida. No se cobra nada. |
| Cancelar después de confirmar el grupo, más de 24 horas antes del trayecto | Gratis. Se libera toda la reserva, tarifa incluida. |
| Cancelar después de confirmar el grupo, menos de 24 horas antes del trayecto | Se cobra la tarifa de 2,49 €; el resto de la reserva se libera. La app lo muestra antes de que el usuario confirme. |
| Otro miembro cancela o no se presenta | El grupo se recalcula si quedan al menos 2; si no, todos vuelven a buscar. Efecto sobre los 2,49 € de quienes se quedan: **TO DECIDE** |
| Vuelo retrasado | La hora se actualiza automáticamente; un grupo en formación se vuelve a comprobar, un grupo confirmado lo revisa FLOQQ. |
| La aerolínea cambia la terminal | El pasajero pasa a una nueva búsqueda en la terminal correcta si el grupo aún no está confirmado; si no, FLOQQ lo revisa. |
| El grupo nunca se encontró en el aeropuerto | El trayecto se marca para revisión de FLOQQ y no se procesa ningún pago de la parte del taxi hasta que se resuelva. |

La cancelación se hace desde «Mi trayecto» o desde la pantalla Buscando tu coincidencia, siempre con un paso de confirmación. El asistente nunca cancela un trayecto por sí mismo (ver Reglas del asistente).

## Seguridad, privacidad y datos

- **Emergencias:** ante cualquier emergencia, llama primero al **112** (número europeo de emergencias). El asistente lo dice de inmediato y no intenta gestionar la emergencia por sí mismo.
- **Qué ven los demás pasajeros:** nombre de pila, avatar, barrio del destino, estado del vuelo y estado del encuentro. Nunca apellidos, correo, teléfono, dirección exacta ni fecha de nacimiento.
- **Ubicación:** se usa en el teléfono para la guía con flecha. Se comparte con el grupo solo si el pasajero lo activa, solo durante el encuentro, y nunca se guarda.
- **Chat de grupo:** todavía no disponible, así que no hay nada que denunciar o bloquear en la app. Los problemas de seguridad con otro pasajero van al equipo de FLOQQ (traspaso a una persona).
- **Las valoraciones** nunca se muestran a los demás pasajeros.
- **Eliminación de la cuenta:** cómo solicitarla: **TO DECIDE**.
- **Pagos:** los datos de la tarjeta los gestiona Stripe; FLOQQ nunca ve ni guarda números de tarjeta completos.

## Solución de problemas

| Problema | Qué decir al usuario |
| --- | --- |
| No recibió el correo de verificación | Revisar spam y luego usar «Reenviar correo de verificación». Si sigue sin llegar → traspaso a una persona. |
| No puede crear un trayecto | Comprobar: correo verificado, fecha de nacimiento introducida (18 años o más), ningún otro trayecto activo, método de pago guardado. |
| Número de vuelo no reconocido | Comprobar el formato (código de aerolínea + número, p. ej. VY1803) y la fecha. Si no, dejarlo vacío e introducir a mano la hora de llegada y la terminal. |
| Terminal incorrecta | Tocar «¿No es correcto?» debajo de la terminal para cambiarla. |
| Lleva mucho tiempo buscando | El emparejamiento se hace cada 5 minutos y depende de viajeros compatibles. Una espera máxima más larga ayuda. Si no se encuentra a nadie, el trayecto caduca gratis. |
| Ha fallado el pago | Reintentarlo o cambiar la tarjeta en Perfil → Métodos de pago. Cobrado pero sin plaza asegurada → traspaso a una persona. |
| No aparece la flecha | Activar la ubicación para FLOQQ en los ajustes del teléfono. En interiores, cerca del punto, la app muestra la foto y las indicaciones en su lugar. |
| La flecha apunta mal | Mover el teléfono dibujando un ocho para calibrar la brújula, y sostenerlo en horizontal. |
| No encuentra al grupo | Usar la foto y las indicaciones, «Mostrar nuestra insignia» y «Estoy en el punto de encuentro». |
| Los importes muestran «Pendiente» | Es normal hasta que se procesa el recibo de quien paga; se avisa al usuario cuando sea definitivo. |
| No llegan las notificaciones | Permitir las notificaciones de FLOQQ en los ajustes del teléfono. |

## Reglas del asistente

**El asistente puede:**

- Explicar cómo funciona FLOQQ, usando solo esta base de conocimiento.
- Consultar la información del usuario que ha iniciado sesión, solo lectura: estado del trayecto, estado del grupo, punto de encuentro, estado del pago y del reembolso.
- Guiar al usuario a la pantalla o al botón adecuado para que lo haga él mismo.
- Crear una solicitud de soporte para el equipo de FLOQQ, con la conversación y el trayecto adjuntos.

**El asistente nunca:**

- Cancela, edita, reembolsa, cobra ni cambia nada por sí mismo.
- Comparte la información de otro pasajero.
- Promete un reembolso, una compensación ni nada marcado como TO DECIDE.
- Se inventa una respuesta: si no está en esta base de conocimiento ni en los datos del usuario, lo dice y ofrece una persona.

**Traspasar a una persona cuando:**

- el usuario pide una persona;
- hay dinero de por medio y algo parece incorrecto (cobrado dos veces, cobrado sin plaza, parte incorrecta, reembolso que falta);
- hay un problema de seguridad, acoso o un conflicto entre pasajeros;
- se trata de corregir la fecha de nacimiento o eliminar la cuenta;
- el asistente no ha podido resolver el problema después de dos intentos.

**Siempre:** decir al usuario desde el principio que está hablando con un asistente de IA, responder en el idioma de su app y, ante cualquier emergencia, decirle que llame primero al 112.

## Decisiones pendientes antes del lanzamiento

El asistente trata cada uno de estos puntos como «aún no decidido» y traspasa a una persona hasta que se complete arriba.

- [x] Reglas de reembolso de la tarifa de 2,49 € cuando el usuario cancela (como lo hace la app hoy; ver la tabla de cancelaciones)
- [ ] Efecto de una no presentación sobre la tarifa de los pasajeros que se quedan
- [ ] Plazo para responder a una coincidencia (minutos)
- [ ] Límites de desvío por pasajero
- [ ] Plazo para reclamar los importes del recibo
- [ ] Plazo y alternativa cuando quien paga no sube el recibo
- [ ] Condiciones de la Garantía de pago del trayecto
- [ ] Plazo de pago a quien paga
- [ ] Validación legal del flujo de pago en España
- [ ] Proceso de eliminación de cuenta
- [ ] Datos de contacto del soporte y tiempo de respuesta humano
