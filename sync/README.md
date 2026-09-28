# Sincronización manual iPhone ↔ PC

Cada dispositivo guarda **sus propios datos** (IndexedDB) y funciona sin conexión
y sin el otro. Cuando **tú** lo decides, los sincronizas:

- **Por Wi‑Fi**, con el servicio local del PC arrancado (este directorio), o
- **Con archivos cifrados** (sin red): AirDrop, iCloud Drive, correo, USB…

No hay nube, ni sincronización automática, ni cuentas externas.

## 1. Instalar la app en el iPhone (una vez)

La app instalada guarda sus datos **ligados a la dirección desde la que se
instaló**, separados de Safari. Elige una dirección estable:

- **Recomendado:** tu despliegue estático con HTTPS (p. ej. `task-gestor.netlify.app`).
  Solo sirve los ficheros de la app: tus datos nunca salen del iPhone.
- **Alternativa sin internet:** `https://<ip-del-pc>:4180` (tras instalar el
  certificado del PC, paso 3). Fija la IP del PC en el router (reserva DHCP):
  si la IP cambia, la app instalada desde la IP antigua no la seguirá.

En Safari: **Compartir → Añadir a pantalla de inicio**. Abre siempre la app desde
su icono (es una app independiente de Safari, con sus propios datos).

## 2. Arrancar el servicio en el PC (solo para sincronizar por Wi‑Fi)

```bash
npm run pc        # compila la app y arranca el servicio
# o, si ya está compilada:
npm run sync
```

| Dirección | Para qué |
|---|---|
| `http://localhost:4181` | La app en el PC (datos propios del PC, funciona sin conexión) |
| `https://<ip-del-pc>:4180` | El iPhone en tu Wi‑Fi (app y canal de sincronización) |
| `http://<ip-del-pc>:4182` | Página de configuración del iPhone (certificado) |

El PC **no** tiene que estar encendido para usar el iPhone: solo para sincronizar
por Wi‑Fi. Tampoco hace falta este servicio para usar la app del PC una vez
abierta (queda en caché y funciona sin conexión).

## 3. Confiar en el PC desde el iPhone (una vez)

Safari no abre conexiones seguras a un certificado autofirmado. El servicio crea
una **autoridad de certificación local** (solo tuya, en `sync/.cert/`):

1. En el iPhone abre `http://<ip-del-pc>:4182` (o escanea el QR del terminal /
   de la pantalla Sincronización del PC) y descarga el certificado.
2. **Ajustes → General → VPN y gestión de dispositivos** → instala el perfil.
3. **Ajustes → General → Información → Ajustes de confianza de certificados** →
   activa «Plan Gestor Task - CA local».
4. Comprueba que la huella coincide con la que muestra el PC.

## 4. Emparejar

1. PC: abre `http://localhost:4181` → **Sincronización**. Verás la dirección y el
   **código** (p. ej. `K7M2-9QXA`) y «Recibir sincronizaciones» activado.
2. iPhone: **Más → Sincronización → Emparejar con el PC**, con esa dirección y el código.

Cada dispositivo emparejado recibe su **propia clave secreta**. Puedes revocarlo en
«Dispositivos autorizados». `npm run new-code` genera un código nuevo.

## 5. Sincronizar

- **Wi‑Fi:** en el iPhone, **Sincronizar ahora**. Verás cuántos cambios llegan,
  cuántos salen y los conflictos. Nada se aplica hasta que confirmas.
- **Archivo:** «Exportar paquete» (con contraseña) → ábrelo en el otro dispositivo
  → «Importar» → revisa y confirma → se genera un **archivo de respuesta** →
  impórtalo en el primero. Si la respuesta se pierde, no pasa nada: la siguiente
  sincronización lo recupera.

## Cómo funciona

```
 iPhone (IndexedDB)            PC: servicio local              PC: navegador (IndexedDB)
 ┌──────────────┐  cifrado E2E  ┌───────────────┐  cifrado E2E  ┌──────────────┐
 │ motor 3 vías │ ────────────► │ RELÉ: reenvía │ ────────────► │ motor 3 vías │
 │ + base común │ ◄──────────── │ no guarda nada│ ◄──────────── │ + base común │
 └──────────────┘               └───────────────┘               └──────────────┘
```

- **Base común:** tras cada sincronización ambos guardan la huella de cada dato.
  Así se sabe quién cambió qué: si solo cambió uno, se copia; si cambiaron los
  dos, es un **conflicto** y decides tú.
- **Solo viaja lo que cambió** (más las filas de las que dependen).
- **Finanzas:** los conflictos financieros nunca se resuelven por fecha ni se
  mezclan campo a campo; siempre eliges tú. Los saldos se derivan de los
  movimientos, así que nunca divergen si los movimientos coinciden.
- **Seguro sin supervisión:** mismo contenido en ambos, datos de ejemplo o
  ajustes de fábrica sin tocar, registros de hábito del mismo día.
- **Relaciones:** si un dispositivo borró una cuenta mientras el otro le añadía
  movimientos, la cuenta se conserva.
- **Atómico:** si modificas datos afectados mientras se sincroniza, no se aplica
  nada a medias; basta con repetir.
- **Recuperable:** antes de aplicar se guarda un punto de restauración.

## Seguridad

- Mensajes cifrados de extremo a extremo (AES‑256‑GCM); el relé no puede leerlos.
- Código de emparejamiento de 40 bits; 10 intentos fallidos bloquean la IP 10 min.
- El código y los datos de emparejamiento solo se muestran en el propio PC.
- Archivos de sincronización y copias cifrados con contraseña (PBKDF2 310.000 iteraciones).
- Los datos recibidos se validan (esquemas financieros, importes enteros, tope de
  asignaciones) antes de aplicarse; un paquete inválido se rechaza entero.
- El PIN, el tema y los avisos nunca se sincronizan ni se exportan.
- Nada sale de tu red local.

## Pruebas

```bash
npm test -w gestion-tareas-sync   # servicio real: código, relé, CA/TLS, fuerza bruta
npm run test -w client            # motor, cifrado, IndexedDB y sincronización E2E por red
```
