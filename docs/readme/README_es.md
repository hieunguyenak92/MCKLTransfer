<div align="center">

[English](../../README.md) · [简体中文](README_zh-CN.md) · [日本語](README_ja.md) · [Tiếng Việt](README_vi.md) · [ไทย](README_th.md) · **Español** · [Português](README_pt.md)

# MCKL Transfer

**Tus archivos. Tus dispositivos. Tu propio espacio.**

Comparte desde el navegador con un servidor que controlas: para ti, tu familia o un equipo pequeño.

[Descargar la última versión](https://github.com/hieunguyenak92/MCKLTransfer/releases/latest) · [Configuración](../CONFIGURATION.md) · [Apoyar con una estrella](https://github.com/hieunguyenak92/MCKLTransfer)

**0.5.0 · Apache-2.0 · Sin instalar clientes · Sin dependencias npm de ejecución**

</div>

Pasa un vídeo al ordenador, envía documentos a otro dispositivo o crea una pequeña bandeja de entrada para tu equipo. MCKL Transfer convierte un equipo en tu punto de intercambio. Los demás se conectan con el navegador. No necesitas una cuenta de nube de MCKL.

## Lo que marca la diferencia

| Función | Para qué sirve |
|---|---|
| Subidas reanudables | Pausa, reintenta y verifica SHA-256; recupera el mismo resultado si se pierde la respuesta final |
| Compartir con intención | Espacio común, inbox por destinatario y salas con miembros elegidos |
| Invitaciones por QR | Enlaces de un solo uso con caducidad y aprobación opcional del host |
| Carpetas y descargas por lotes | Conserva rutas relativas y descarga una selección como `.tar` por streaming |
| Herramientas cotidianas | Búsqueda, chat, historial de transferencias y caducidad de archivos |
| Transferencia directa experimental | Sesiones WebRTC aceptadas por el destinatario, con diagnóstico direct/relay |
| Recursos bajo control | Cuotas por dispositivo, límite de archivos y descargas, y leases de subida entre pestañas |

## Empieza en minutos

En el host, usa Node.js **24.x desde 24.22.2**, o **26.x desde 26.13.0**.

```sh
git clone https://github.com/hieunguyenak92/MCKLTransfer.git
cd MCKLTransfer
npm start
```

No hace falta `npm install`. También puedes descargar el código desde [Releases](https://github.com/hieunguyenak92/MCKLTransfer/releases).

1. Abre la URL LAN de la terminal en el navegador de otro dispositivo.
2. Introduce un nombre y el código de acceso de seis dígitos.
3. Elige el destino y envía archivos o carpetas.

El **código de administrador independiente** es para quien gestiona el host. Desde su panel puede aprobar o revocar dispositivos, crear invitaciones y administrar salas.

HTTP, la opción predeterminada, no cifra la conexión. Úsalo en una LAN controlada y de confianza; para otras conexiones configura HTTPS de confianza o una red Tailscale/WireGuard con acceso restringido. No publiques directamente este puerto HTTP en Internet.

## Un espacio común o una bandeja privada

- **Espacio compartido:** archivos y chat para los miembros aprobados.
- **Inbox privado:** acceso para el remitente, el destinatario elegido y el administrador de confianza.
- **Salas:** el administrador elige sus miembros; los permisos se aplican a listados, descargas y eventos.

El botón de invitación crea un enlace y un QR válidos durante diez minutos. Se pueden utilizar una sola vez y no sobreviven al reinicio del servidor. Para exigir aprobación del host al conectar:

```sh
REQUIRE_APPROVAL=1 npm start
```

Si se corta una subida, vuelve a seleccionar el mismo archivo. Se necesitan la misma cookie y una subida que no haya caducado. Los leases del servidor impiden que varias pestañas modifiquen simultáneamente la misma subida.

«Guardado en el host» y «guardado por el destinatario» son estados distintos. En los navegadores compatibles, el guardado verificado envía un recibo después de escribir el archivo y comprobar SHA-256.

## WebRTC directo — experimental

Cuando ambos dispositivos están conectados, puedes elegir una sesión que no almacena el archivo en el host.

1. Selecciona al destinatario y el archivo para envío directo.
2. El destinatario acepta y elige dónde guardarlo.
3. **Comparad los códigos de ambos dispositivos mediante otro canal de confianza y confirmad en los dos.**
4. El receptor escribe bloques pequeños y verifica el tamaño y SHA-256.

Requiere HTTPS o localhost. Para recibir se necesita `showSaveFilePicker`; el objetivo principal es Chromium de escritorio. El archivo completo no se acumula en un Blob en RAM. En dispositivos no compatibles o si la conexión falla, puedes elegir explícitamente la ruta por el host. Un cambio de almacenamiento o privacidad no queda oculto en un fallback automático.

No se configura ningún STUN/TURN externo de forma predeterminada. Puedes definir servidores propios mediante `ICE_SERVERS`. La ruta relay indica el uso de TURN; no se garantiza una conexión directa en todas las redes. Consulta la [configuración](../CONFIGURATION.md).

## Privacidad y límites claros

El host puede leer los archivos y chats que pasan por él. El inbox privado aplica control de acceso; no ofrece E2EE frente al host. El cifrado de la sesión directa y la comparación de códigos tampoco protegen contra JavaScript malicioso servido por un host comprometido.

Mantén la página abierta durante la transferencia, especialmente en móviles. La PWA no garantiza envíos en segundo plano ni con la pantalla del iPhone bloqueada. No incluye escritorio remoto.

## Operación y actualizaciones

- `SHARE_DIR` contiene los datos privados. Consulta [Configuración](../CONFIGURATION.md) para cuotas, límites de archivos, caducidad, HTTPS e ICE. Los archivos `.env` no se cargan automáticamente.
- Antes de actualizar, detén el servidor y protege una copia de todo el directorio de datos. Un bloqueo rechaza otro proceso de host que use el mismo directorio.
- Las sesiones se conservan tras un apagado y reinicio normales. Tras una interrupción inesperada se exige volver a vincular por seguridad; la recuperación de la propiedad anterior requiere al administrador.
- La caducidad no equivale a borrado seguro ni elimina copias de seguridad. No se garantiza un comportamiento uniforme en unidades de red o ante cortes de energía.

La velocidad depende de red, disco, cálculo de hashes y dispositivo. Los métodos y el alcance de la verificación se documentan en [Validación](../VALIDATION.md); una medición loopback no es una promesa de velocidad LAN.

## Idiomas y desarrollo

La aplicación permite cambiar entre **Tiếng Việt y English**. El README está disponible en siete idiomas desde los enlaces superiores.

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

[Protocolo](../PROTOCOL.md) · [Seguridad](../../SECURITY.md) · [Contribuir](../../CONTRIBUTING.md)

Si te resulta útil, deja una **estrella** para apoyar el proyecto. Los informes reproducibles y las pruebas en dispositivos reales también ayudan a mejorar la siguiente versión.

[Apache License 2.0](../../LICENSE): uso comercial, modificación y distribución según sus términos. Conserva [NOTICE](../../NOTICE), incluido el aviso MIT de la biblioteca QR. Sin garantía.
