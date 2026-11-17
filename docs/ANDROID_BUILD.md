# Plan Task Gestor para Android (APK)

La app de Android es **la misma app** de Windows y de la web: el frontend
React/Vite se empaqueta con **Tauri v2** (soporte oficial de Android). No se
usa Capacitor, React Native ni Flutter.

| Dato | Valor |
|---|---|
| Nombre | Plan Task Gestor |
| Identificador (paquete) | `com.alejandrodukesini.gestortareas` (el mismo que en Windows) |
| Versión | la de `client/package.json` (`versionName`); `versionCode` = mayor·1 000 000 + menor·1 000 + parche |
| SDK mínimo | 24 (Android 7.0) — `client/src-tauri/tauri.android.conf.json` |
| SDK objetivo / compilación | 37 (plantilla de Tauri CLI 2.12) |
| Arquitecturas | arm64-v8a, armeabi-v7a, x86, x86_64 (APK universal) |
| Permisos | `INTERNET` (plantilla de Tauri; la app funciona sin conexión) y `POST_NOTIFICATIONS` (recordatorios; se pide al activarlos) |

## 1. Requisitos

| Herramienta | Versión verificada | Notas |
|---|---|---|
| Node.js | 24 (`.nvmrc`) | |
| Rust | estable (probado con 1.99) | |
| Targets de Rust | `aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android` | |
| Android SDK | platforms 34-36, build-tools 35, platform-tools, cmdline-tools | Gradle descarga el resto (SDK 37) |
| Android NDK | 29.0.14206865 | |
| JDK | **21** | Con JDK 25 Gradle puede fallar: usa el 21 |

## 2. Android Studio / SDK

1. Instala Android Studio (o solo las *command-line tools*).
2. En **SDK Manager › SDK Tools** marca *Android SDK Platform-Tools*,
   *Android SDK Command-line Tools* y *NDK (Side by side)*. Por consola:

   ```powershell
   $env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
   & "$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat" --install "ndk;29.0.14206865"
   ```

   > Desde Git Bash el `;` del nombre del paquete rompe el `.bat`: usa PowerShell o `cmd`.

3. Targets de Rust:

   ```bash
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

## 3. Variables de entorno

| Variable | Valor en este equipo | Persistente |
|---|---|---|
| `ANDROID_HOME` | `%LOCALAPPDATA%\Android\Sdk` | sí (usuario) |
| `NDK_HOME` | `%LOCALAPPDATA%\Android\Sdk\ndk\29.0.14206865` | sí (usuario) |
| `JAVA_HOME` | `C:\Program Files\Java\jdk-21` | **solo en la sesión de compilación** (el global apunta a JDK 25 y no se tocó) |

```powershell
[Environment]::SetEnvironmentVariable("NDK_HOME", "$env:LOCALAPPDATA\Android\Sdk\ndk\29.0.14206865", "User")
```

## 4. Proyecto Android

Ya está inicializado y versionado en `client/src-tauri/gen/android`
(se generó con `npx tauri android init --ci` desde `client/`). Solo hay que
regenerarlo si se borra esa carpeta; después hay que volver a aplicar los
cambios propios (ver «Archivos propios» abajo).

Configuración por plataforma (Tauri la fusiona sola):

- `client/src-tauri/tauri.conf.json` — común + Windows.
- `client/src-tauri/tauri.android.conf.json` — solo Android (`minSdkVersion`).
- `client/src-tauri/capabilities/android.json` — permisos solo Android.

Archivos propios dentro de `gen/android` (no los genera Tauri):

- `app/build.gradle.kts` — bloque `signingConfigs` (firma Release).
- `app/src/main/java/com/alejandrodukesini/gestortareas/MainActivity.kt` — márgenes de barras del sistema y teclado.
- `app/src/main/res/mipmap-*` y `values/ic_launcher_background.xml` — icono (generado con `npx tauri icon`).

## 5. Keystore (firma Release)

Se generó **una sola vez** y vive **fuera del repositorio**:

```
%USERPROFILE%\.plantaskgestor-keys\plantaskgestor-release.jks   ← clave privada
%USERPROFILE%\.plantaskgestor-keys\keystore.properties          ← ruta, alias y contraseña
```

Comando usado (la contraseña se generó aleatoria y solo está en `keystore.properties`):

```bash
keytool -genkeypair -v -keystore plantaskgestor-release.jks -storetype PKCS12 \
  -alias plantaskgestor -keyalg RSA -keysize 4096 -validity 10000 \
  -dname "CN=Plan Task Gestor, O=Alejandro Dukesini, C=CO"
```

Huella SHA-256 del certificado:
`2B:26:B0:B8:8E:40:0D:FE:55:A6:7A:37:AC:C1:CB:0E:03:CA:73:CD:4A:63:F7:56:46:4F:17:F0:8D:BF:52:14`

> ⚠️ **Haz una copia de esa carpeta** (gestor de contraseñas, USB cifrado…).
> Si se pierde el `.jks` o su contraseña, **ninguna versión futura podrá
> instalarse encima** de la actual: habría que desinstalar (y se perderían
> los datos del teléfono que no estén en una copia de seguridad).
> **No generes otro keystore** para las actualizaciones.

Formato de `keystore.properties`:

```properties
storeFile=C:/Users/<usuario>/.plantaskgestor-keys/plantaskgestor-release.jks
storePassword=<contraseña>
keyAlias=plantaskgestor
keyPassword=<contraseña>
```

## 6. Configuración de firma

`app/build.gradle.kts` lee `keystore.properties` de
`%USERPROFILE%\.plantaskgestor-keys\` o de la ruta indicada en la variable
`PLANTASK_KEYSTORE_PROPERTIES` (útil en CI). Si no lo encuentra, el APK
Release sale **sin firmar** (`…-unsigned.apk`) y no se puede instalar.

`.gitignore` excluye `*.jks`, `*.keystore` y `keystore.properties`.

## 7. Generar el APK

Desde la raíz del repositorio (PowerShell):

```powershell
$env:JAVA_HOME = "C:\Program Files\Java\jdk-21"
npm run android:build        # = tauri android build --apk (desde client/)
```

Verificar la firma:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\build-tools\35.0.0\apksigner.bat" verify --print-certs <ruta-del-apk>
```

La huella SHA-256 debe coincidir con la del punto 5.

## 8. Ubicación del instalador

```
client/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
```

## 9. Instalar en el teléfono

1. Copia el `.apk` al teléfono (cable, Drive, Telegram…).
2. Ábrelo desde *Archivos*. Android pedirá permitir **«Instalar apps
   desconocidas»** para la app desde la que lo abres: actívalo solo para ella.
3. Pulsa **Instalar**. Play Protect puede avisar de que la app es desconocida
   (no está en Play Store): *Más detalles › Instalar de todas formas*.

Con cable y depuración USB: `adb install -r app-universal-release.apk`.

## 10. Actualizaciones

1. Sube la versión con `npm run version:set -- X.Y.Z` (actualiza package.json
   y Cargo.toml; el `versionCode` de Android sale de ahí y **debe crecer**).
2. `npm run android:build` con **el mismo keystore**.
3. Instala el APK nuevo encima del anterior (sin desinstalar): los datos se conservan.

Android rechaza la actualización si cambia la firma o si el `versionCode` es
menor o igual que el instalado.

## 11. Datos del usuario

- Se guardan en el almacenamiento privado de la app (IndexedDB de la
  WebView + copia espejo en localStorage), igual que en Windows y la web.
- **Sobreviven** a cerrar la app, reiniciar el teléfono y actualizar con un
  APK firmado con la misma clave.
- **Se borran** al desinstalar la app o al usar *Ajustes › Apps › Plan Task
  Gestor › Borrar datos*.
- Los datos del PC **no pasan solos** al teléfono: usa *Configuración ›
  Copias de seguridad* (exportar en uno, restaurar en el otro) o el
  *Centro de sincronización*.
- En Android, «Descargar copia» abre el selector **Guardar como** del sistema
  (elige Descargas, Drive…). Haz copias periódicas: son la única protección
  frente a una desinstalación.

## 12. Pruebas realizadas (1.4.0)

En el emulador `Pixel API 34` (Android 14, WebView 113), con el APK de release firmado:

| Prueba | Resultado |
|---|---|
| Instalar, abrir, cerrar | ✅ |
| Actualizar encima de una versión anterior (`adb install -r`) | ✅ conserva los datos creados antes |
| Crear, editar (título y fecha con el selector nativo) y eliminar una tarea | ✅ (el `confirm()` se muestra como diálogo nativo) |
| Crear un proyecto | ✅ |
| Crear una nota y escribir (`200+200=` → `400`) | ✅ autoguardado |
| Exportar una nota (`.txt`) con «Guardar como» | ✅ archivo escrito en Descargas con su contenido |
| Forzar cierre y reabrir en modo avión | ✅ datos intactos, sin conexión |
| Minimizar y volver | ✅ mantiene la pantalla |
| Horizontal | ✅ cambia al diseño con panel lateral |
| Pantalla de 320 dp | ✅ (las tarjetas del panel apilan el icono por debajo de 360 px) |
| Teclado virtual | ✅ los formularios quedan por encima del teclado |
| Botón Atrás | ✅ navega el historial; con un panel abierto lo cierra cambiando de pantalla |
| Barra inferior frente a los botones del sistema | ✅ (corregido en `MainActivity.kt`) |

Pendiente: probar en un teléfono físico y en una tablet.

## 13. Problemas frecuentes

| Síntoma | Causa / solución |
|---|---|
| `Package ndk not found` al instalar el NDK | El `;` se pierde en Git Bash: ejecuta `sdkmanager` desde PowerShell. |
| Gradle falla con «Unsupported class file major version» | `JAVA_HOME` apunta a un JDK demasiado nuevo: usa JDK 21. |
| `NDK_HOME` no definido | Defínelo (punto 3) y abre una terminal nueva. |
| Sale `app-universal-release-unsigned.apk` | No se encontró `keystore.properties`: revisa la ruta o `PLANTASK_KEYSTORE_PROPERTIES`. |
| «La app no se instaló» al actualizar | Firma distinta o `versionCode` no mayor. Usa el keystore original y sube la versión. |
| Los recordatorios no llegan con la app cerrada | Limitación conocida: los avisos se calculan con la app abierta (no hay servicio en segundo plano). |
| Google Calendar «no disponible» | Google bloquea su OAuth dentro de WebViews embebidas; úsalo desde la versión web. |
