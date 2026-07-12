#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Workaround for a WebKitGTK crash on Wayland with certain GPU drivers
    // without this, the window dies on startup with a Wayland protocol error
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
