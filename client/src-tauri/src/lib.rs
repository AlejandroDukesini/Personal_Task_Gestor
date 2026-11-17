//! Contenedor nativo (Windows y Android) de la app React.
//!
//! No hay comandos nativos propios: los datos siguen en el almacenamiento de
//! la WebView (IndexedDB/localStorage), dentro del perfil privado de la app
//! (Windows: %LOCALAPPDATA%\com.alejandrodukesini.gestortareas; Android: el
//! directorio privado del paquete). Plugins comunes: `opener`, para abrir
//! enlaces externos en el navegador del sistema, y `notification`, para los
//! recordatorios (la WebView de Tauri no expone la Notification API).
//!
//! Solo en Android: `dialog` + `fs`, para guardar copias de seguridad y
//! exportaciones con el selector de archivos del sistema (la WebView de
//! Android ignora las descargas `<a download>`).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init());

    #[cfg(target_os = "android")]
    let builder = builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    builder
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar la aplicación");
}
