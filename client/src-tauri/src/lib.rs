//! Contenedor de escritorio de la app React.
//!
//! No hay comandos nativos propios: los datos siguen en el almacenamiento de
//! la WebView (IndexedDB/localStorage), dentro del perfil privado de la app
//! en %LOCALAPPDATA%\com.alejandrodukesini.gestortareas. El único plugin es
//! `opener`, para abrir enlaces externos en el navegador del sistema.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("no se pudo iniciar la aplicación");
}
