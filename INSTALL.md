# Instalar Plan Gestor Task

Guía para **usar** la aplicación. No necesitas instalar Node.js, Rust ni
ninguna herramienta de programación. (Para desarrollar o compilar, ver
[`DESKTOP.md`](DESKTOP.md).)

## 1. ¿Qué descargo?

Entra en **[GitHub Releases › última versión](https://github.com/AlejandroDukesini/Personal_Task_Gestor/releases/latest)**
y, en la sección **Assets**, elige **un** archivo:

| Tu caso | Archivo | Tamaño aprox. |
| :--- | :--- | :--- |
| **Solo quiero usar la aplicación** (lo normal) | `PlanGestorTask_<versión>_x64-setup.exe` | 12 MB |
| **El equipo no tiene Internet** (o la conexión es muy mala) | `PlanGestorTask_<versión>_x64-offline-setup.exe` | 220 MB |
| No quiero instalar nada | Usa la [versión web](https://task-gestor.netlify.app/) en el navegador | — |

`SHA256SUMS.txt` es opcional: sirve para comprobar que la descarga no está
dañada (ver [Verificar la descarga](#verificar-la-descarga)). Los archivos
`Source code` son el código fuente; no los necesitas.

### ¿Online u offline?

La app usa **Microsoft Edge WebView2**, el componente con el que Windows
muestra aplicaciones web. **Windows 11 ya lo trae** y Windows 10 lo recibe
con las actualizaciones de Windows/Edge, así que casi siempre está instalado.

| | Instalador normal (online) | Instalador offline |
| :--- | :--- | :--- |
| Si WebView2 **ya está** instalado | Instala sin usar Internet | Instala sin usar Internet |
| Si WebView2 **falta** | Lo descarga de Microsoft (necesita Internet esa vez) | Lo instala desde el propio archivo, sin Internet |
| Tamaño | ~12 MB | ~220 MB (incluye WebView2) |

Una vez instalada, la app funciona **sin conexión**: tus datos se guardan en
el propio equipo. Solo la integración con Google Calendar no está disponible
en la versión de escritorio.

## 2. Requisitos

| Sistema | Estado |
| :--- | :--- |
| **Windows 10 / 11, 64 bits (x64)** | ✅ Instalador disponible. No necesita permisos de administrador (se instala para tu usuario). |
| Windows en ARM | Sin instalador propio; no verificado. |
| macOS, Linux | Sin instalador por ahora. Usa la [versión web](https://task-gestor.netlify.app/) (se puede instalar como app desde el navegador). |
| iPhone / Android | [Versión web](https://task-gestor.netlify.app/) › «Añadir a pantalla de inicio». |

Espacio en disco: unos 15 MB para el programa, más tus datos (y WebView2, si
hubiera que instalarlo).

## 3. Instalar

1. Descarga el archivo `.exe` elegido (normalmente va a la carpeta **Descargas**).
2. Haz doble clic sobre él.
3. Si aparece **«Windows protegió su PC»**, mira el [punto 4](#4-windows-muestra-una-advertencia).
4. Sigue el asistente (Siguiente › Instalar › Finalizar).
5. Abre **Plan Gestor Task** desde el menú Inicio o el acceso directo del escritorio.

### Actualizar a una versión nueva

Descarga el instalador de la versión nueva y ejecútalo encima: reemplaza el
programa y **conserva tus datos**. Por precaución, antes descarga una copia en
**Configuración › Copias de seguridad**.

### Desinstalar

**Configuración de Windows › Aplicaciones › Aplicaciones instaladas ›
Plan Gestor Task › Desinstalar.** El desinstalador ofrece una casilla para
borrar también los datos; si no la marcas, se conservan en
`%LOCALAPPDATA%\com.alejandrodukesini.gestortareas` y una reinstalación
posterior los vuelve a ver.

## 4. Windows muestra una advertencia

Los instaladores **todavía no están firmados** con un certificado de editor
de código (cuesta dinero y no es obligatorio). Por eso Windows SmartScreen
puede mostrar **«Windows protegió su PC»** o «Editor desconocido». Es lo
esperado en programas sin firma:

1. Comprueba que descargaste el archivo **desde la página oficial de
   Releases** enlazada arriba (y, si quieres, [verifícalo](#verificar-la-descarga)).
2. Pulsa **Más información**.
3. Pulsa **Ejecutar de todas formas**.

Si tu antivirus o tu organización bloquea el archivo, no desactives la
protección: usa la [versión web](https://task-gestor.netlify.app/) o pide a tu
administrador que lo autorice.

## Verificar la descarga

Opcional, para comprobar que el archivo es exactamente el publicado. En
PowerShell, dentro de la carpeta de descarga:

```powershell
Get-FileHash .\PlanGestorTask_<versión>_x64-setup.exe
```

El valor `Hash` debe coincidir (sin importar mayúsculas) con la línea de ese
archivo en `SHA256SUMS.txt`. Si no coincide, borra el archivo y descárgalo de
nuevo.

Quien tenga [GitHub CLI](https://cli.github.com) puede comprobar además que
el instalador lo compiló GitHub Actions a partir de este repositorio:

```bash
gh attestation verify PlanGestorTask_<versión>_x64-setup.exe -R AlejandroDukesini/Personal_Task_Gestor
```

## Problemas habituales

| Problema | Solución |
| :--- | :--- |
| «Windows protegió su PC» | Ver [punto 4](#4-windows-muestra-una-advertencia). |
| El instalador normal falla sin Internet | Falta WebView2 y no pudo descargarlo: usa el **instalador offline**. |
| La app abre en blanco o no abre | Instala o repara WebView2 desde [la página oficial de Microsoft](https://developer.microsoft.com/microsoft-edge/webview2/) (o usa el instalador offline) y reinicia el equipo. |
| No veo mis datos de la versión web | Web y escritorio guardan los datos por separado. En la web: Configuración › Copias de seguridad › descargar copia. En el escritorio: restaurar esa copia. |
| Los recordatorios no avisan | Solo funcionan con la app abierta. Revisa Configuración › Sistema › Notificaciones de Windows, en la app y en Windows. |
| Otro problema | Abre un [issue](https://github.com/AlejandroDukesini/Personal_Task_Gestor/issues) indicando versión de la app y de Windows. |

> Tus datos viven solo en tu equipo. Descarga copias de seguridad de vez en
> cuando: no protegen solas frente a un fallo del disco o la pérdida del equipo.
