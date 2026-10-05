// En release no abre una consola junto a la ventana de la app.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    plan_gestor_task_lib::run()
}
