# MCKL Transfer

[Tiếng Việt](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [Español](README.es.md) · [Português](README.pt.md) · [ไทย](README.th.md) · [简体中文](README.zh-CN.md)

Comparte archivos y chatea a través de tu propio servidor en una LAN o entre dispositivos autorizados en una red superpuesta (overlay). Solo el servidor necesita Node.js; los demás dispositivos usan un navegador. No hay cuentas de nube de MCKL, analítica, base de datos ni dependencias npm de ejecución.

**0.2.0-alpha.2 · Apache-2.0 · experimental.** Consulta los [resultados de verificación](docs/VALIDATION.md) y el [modelo de seguridad](SECURITY.md) antes de desplegarlo. No se garantiza soporte estable ni una velocidad LAN determinada en todos los dispositivos.

## Inicio rápido en una red de confianza

Instala Node.js **24, a partir de 24.22.2**, o **26, a partir de 26.13.0**, con los parches actualizados. Desde el directorio del código fuente:

```sh
npm start
```

No es necesario ejecutar `npm install`. La terminal muestra las direcciones LAN, un código de acceso de seis dígitos y un **código de administrador independiente**. Abre la dirección LAN en otro dispositivo, introduce un nombre de dispositivo y el código de acceso. Entrega el código de administrador únicamente a quien gestione el servidor. Los códigos nunca se exponen mediante la API, ni siquiera en localhost.

La conexión HTTP predeterminada no está cifrada: úsala solo en una red que controles y con personas de confianza. Usa HTTPS o una red superpuesta controlada para otras conexiones. No reenvíes este puerto desde el router a Internet.

### Uso de la aplicación

- Selecciona o arrastra varios archivos. La cola de toda la aplicación transfiere hasta dos archivos a la vez, con velocidad, tiempo estimado y controles para pausar, reanudar, reintentar y cancelar.
- Tras perder la conexión o recargar la página, vuelve a seleccionar el mismo archivo para reanudar. Debes conservar la cookie del dispositivo y la subida no debe haber caducado. El navegador no conserva automáticamente el permiso para leer un archivo después de cerrar la página.
- Usa **una sola pestaña de subida por servidor**. Las pestañas del mismo origen comparten cookies y registros de reanudación. Si dos pestañas reanudan la misma subida, cancelarla en una puede borrar el progreso parcial de la otra. El archivo original permanece intacto; la otra pestaña debe empezar de nuevo al recibir `404`. Esta versión alfa no coordina la propiedad de las subidas entre pestañas.
- Antes de enviar, el navegador lee el archivo original para calcular SHA-256; el host verifica cada bloque y el archivo completo. El cálculo del hash requiere una lectura adicional y puede ser lento en dispositivos menos potentes. No se mantiene el archivo entero en RAM.
- Los archivos completados aparecen en la lista compartida; todos los miembros con sesión iniciada pueden descargarlos. Los miembros solo pueden eliminar los archivos que hayan enviado. El administrador puede eliminar cualquier archivo y revocar sesiones de dispositivos.
- El chat compartido conserva hasta 200 mensajes en RAM; se pierden al reiniciar el host. Mantén la página abierta durante las transferencias, sobre todo en teléfonos. La PWA no garantiza transferencias en segundo plano ni que continúen cuando iOS bloquee la pantalla.

El modelo es **navegador A → el host almacena el archivo → el navegador B lo descarga**. «Subida completada» significa que el host ha recibido y verificado el archivo; no significa que B lo haya descargado o guardado. El host puede leer tanto los archivos como el chat; no hay E2EE ni salas privadas por destinatario.

## Idioma

La interfaz de la aplicación está disponible en **Tiếng Việt** y **English**. Usa el selector de idioma de la barra superior; tu elección se guarda en este navegador. La primera vez, la aplicación sigue el idioma del navegador y usa inglés si no está disponible. Cambiar de idioma no recarga la página ni detiene las transferencias; no se traducen el contenido de los archivos, los mensajes del chat ni los nombres de los dispositivos. El README está disponible en siete idiomas mediante los enlaces al principio de la página.

## Configuración

La aplicación lee las variables de entorno del proceso; no carga archivos `.env` automáticamente. Los tamaños se expresan en bytes y los tiempos en milisegundos.

| Variable | Valor predeterminado | Significado |
|---|---|---|
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Interfaz y puerto de escucha; IPv4 de forma predeterminada |
| `SHARE_DIR` | `./shared` junto al código fuente | Directorio de datos privados; es preferible situarlo fuera del repositorio |
| `DEVICE_NAME` | hostname | Nombre del host, visible solo tras iniciar sesión y en la terminal |
| `SHARE_CODE` | Seis dígitos aleatorios en cada inicio | Código de miembro; se sigue aceptando `LAN_SHARE_CODE` por compatibilidad |
| `ADMIN_CODE` | Valor aleatorio independiente en cada inicio | Al menos 24 caracteres; mantenlo en secreto |
| `MAX_FILE_SIZE` | `21474836480` (20 GiB) | Límite por archivo |
| `MAX_TOTAL_SIZE` | `107374182400` (100 GiB) | Archivos completados más capacidad reservada para subidas |
| `MIN_FREE_SPACE` | `134217728` (128 MiB) | Espacio libre de reserva; no es una cuota de disco del sistema operativo |
| `CHUNK_SIZE` | `4194304` (4 MiB) | Máximo de 16 MiB por solicitud de subida de un bloque |
| `MAX_CONCURRENT_UPLOADS` | `4` | Operaciones simultáneas de escritura/cálculo de hash de subidas en el servidor |
| `MAX_PENDING_UPLOADS` | `128` | Número de subidas incompletas conservadas |
| `UPLOAD_TTL_MS` | `86400000` (24 horas) | Plazo absoluto desde la creación de una subida incompleta |
| `SESSION_TTL_MS`, `MAX_DEVICES` | `43200000` (12 horas), `128` | Duración de una sesión normal y total de sesiones de dispositivos; las sesiones recordadas duran hasta 30 días |
| `REQUEST_TIMEOUT_MS` | `1800000` (30 minutos) | Tiempo para recibir una solicitud; los sockets inactivos durante 60 segundos se desconectan |
| `TLS_KEY_FILE`, `TLS_CERT_FILE` | Sin definir | Par de clave privada/certificado PEM para HTTPS directo |
| `PUBLIC_URL` | Sin definir | Origen externo del proxy, como `https://transfer.example.org`; sin ruta ni consulta |
| `ALLOWED_HOSTS` | Hostname/interfaces locales | Nombres de host/IP concretos adicionales, separados por comas; sin comodines ni puertos |

Ejemplo en PowerShell con un directorio de datos independiente:

```powershell
$env:SHARE_DIR = "D:\MCKL-data"
$env:DEVICE_NAME = "Home transfer host"
npm start
```

Cambiar los códigos después de reiniciar no revoca las sesiones ya concedidas. Usa el panel de gestión de dispositivos para revocarlas. Si se filtra un PIN, cambia el PIN **y** revoca las sesiones que no sean de confianza. Las cookies y la propiedad de los archivos se conservan tras reiniciar. Cerrar sesión o borrar las cookies y volver a vincular crea una identidad nueva; el administrador aún puede eliminar los archivos antiguos.

## HTTPS y conexiones entre redes

### HTTPS directo

Obtén un certificado cuyo SAN coincida con el nombre de host/IP utilizado, emitido por una CA en la que confíen todos los dispositivos. Guarda la clave fuera del código fuente, restringe sus permisos de lectura y configura ambas variables:

```sh
TLS_KEY_FILE=/secure/mckl/server.key TLS_CERT_FILE=/secure/mckl/server.pem npm start
```

Abre la URL `https://...` correspondiente. No ignores los errores de verificación del certificado. Los certificados autofirmados requieren un procedimiento, mediante un canal de confianza, para instalar la confianza en la CA o comprobar las huellas; la aplicación no automatiza la vinculación de certificados. Las cookies HTTPS usan `Secure`, `HttpOnly` y `SameSite=Strict`.

### Grupos privados mediante Tailscale o WireGuard

Instala la red superpuesta en los dispositivos, autoriza a los miembros previstos y limita el puerto del servicio. Mantén la autenticación de MCKL. Con WireGuard gestionas las claves, el enrutamiento, el firewall y el DNS; con Tailscale comprueba las políticas y las rutas directas o por relay. Un rango de IP privadas no demuestra por sí solo que un dispositivo sea de confianza.

Una opción HTTPS para una tailnet es [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve). Una vez que el host tenga un nombre DNS y HTTPS esté configurado en la tailnet, ejecuta MCKL solo en loopback con ese origen:

```sh
HOST=127.0.0.1 PUBLIC_URL=https://YOUR-HOST.YOUR-TAILNET.ts.net npm start
```

En otra terminal:

```sh
tailscale serve --bg http://127.0.0.1:8787
tailscale serve status
```

Abre exactamente la URL HTTPS que proporciona Serve. Este servicio es para la tailnet; limita tu política de acceso. Consulta la [CLI de Serve](https://tailscale.com/docs/reference/tailscale-cli/serve) para conocer los requisitos y cómo desactivarlo. MCKL no instala ni configura Tailscale automáticamente, y esta versión no se ha probado en una tailnet real.

Otros proxies inversos deben reenviar streaming/SSE sin almacenamiento intermedio, conservar Host o definir `PUBLIC_URL` correctamente, configurar límites de tiempo/tamaño del cuerpo adecuados y restringir el acceso al servidor de origen al proxy de confianza. La aplicación no confía en `X-Forwarded-*` para determinar si la conexión es segura.

## Datos, actualizaciones y copias de seguridad

El host guarda `.mckl-manifest.json`, `.mckl-devices.json` (hashes de los tokens de sesión), `.mckl-uploads.json` y `.mckl-objects/` en `SHARE_DIR`. Los nuevos contenidos se almacenan por ID; los nombres visibles están en el manifiesto. No edites ni elimines archivos internos mientras el servidor esté en ejecución. No ejecutes dos procesos sobre el mismo `SHARE_DIR`.

Detén el host antes de realizar una copia de **todo** el directorio de datos. Las copias contienen archivos y estado de acceso del grupo, por lo que deben protegerse. Esta alfa lee manifiestos del MVP antiguo con archivos normales válidos; no migra automáticamente los contenidos antiguos al almacenamiento por objetos. Solo el administrador puede eliminar archivos antiguos sin propietario. Haz una copia antes de actualizar; no se admite volver a una versión anterior una vez escrito el nuevo formato de manifiesto.

Usa únicamente un sistema de archivos local de confianza con ACL estrictas. Se limpian las subidas incompletas caducadas; los archivos completados no se eliminan automáticamente. No se han verificado unidades de red, sincronización en la nube del directorio de datos, cortes de energía reales ni el hardware de almacenamiento. El renombrado atómico/fsync no garantiza protección frente a todos los fallos.

## Si otro dispositivo no puede conectarse

Elige la URL IPv4 de la LAN que aparece en la terminal, usa la misma Wi-Fi y evita el aislamiento de invitados/AP. Comprueba que el firewall abra el puerto solo para las redes/dispositivos previstos. Comprueba el estado desde otro equipo, sustituyendo la dirección de ejemplo:

```sh
curl --connect-timeout 5 http://192.168.1.10:8787/api/health
```

La respuesta esperada es `{"ok":true}`. Un timeout suele requerir revisar el enrutamiento/firewall; un `403` requiere revisar hostname/Origin y `ALLOWED_HOSTS`/`PUBLIC_URL`. No añadas un comodín para evitar el error. El navegador puede solicitar permiso para acceder a la red local.

## Desarrollo, pruebas y versiones

```sh
npm run check
npm test
npm run release:check
npm run release:source
```

El exportador de código fuente usa una lista explícita de archivos permitidos, vuelve a comprobar el archivo comprimido y escribe SHA-256 en `release/`. No comprimas todo el directorio de trabajo. `.gitignore` no excluye archivos de los ZIP de Finder ni elimina datos ya confirmados en Git. Mantén `private: true` para impedir una publicación accidental en npm; el código fuente sigue bajo Apache-2.0.

- [Contribuir](CONTRIBUTING.md), [seguridad](SECURITY.md), [lista de publicación](docs/RELEASE_CHECKLIST.md).
- [Protocolo alfa](docs/PROTOCOL.md), [pruebas y límites de verificación](docs/VALIDATION.md).
- [Arquitectura](docs/research/architecture.md), [rendimiento](docs/research/performance.md), [licencia y hoja de ruta](docs/research/license-and-roadmap.md).

El descubrimiento/QR, WebRTC, el intercambio del portapapeles iniciado por el usuario, la transferencia de carpetas y compartir pantalla forman parte de la hoja de ruta. Un escritorio remoto completo requiere un agente nativo y un modelo de consentimiento independiente; esta versión no incluye control remoto.

## Licencia

[Apache License 2.0](LICENSE). Copyright 2026 hieunguyenak92; consulta [NOTICE](NOTICE). Se permiten el uso, la modificación y la distribución, incluido el uso comercial, según los términos de la licencia. Conserva LICENSE/NOTICE y documenta los cambios según los términos aplicables. No se ofrece garantía.
