mod fs_api;

use fs_api::{ConfigDir, Roots};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // Remembers window size, position and monitor between launches.
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(Roots::default())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default().level(log::LevelFilter::Info).build(),
                )?;
            }

            // Workspaces, drafts and settings live beside the app, not in the user's
            // folders, which is what the dev middleware's config directory stands in for.
            let config = app.path().app_config_dir()?;
            std::fs::create_dir_all(&config)?;
            app.manage(ConfigDir(config));

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            fs_api::fs_roots,
            fs_api::fs_add_root,
            fs_api::fs_remove_root,
            fs_api::fs_list_dir,
            fs_api::fs_read_file,
            fs_api::fs_stat,
            fs_api::fs_write_file,
            fs_api::fs_write_asset,
            fs_api::fs_create,
            fs_api::fs_rename,
            fs_api::fs_trash,
            fs_api::fs_find_files,
            fs_api::fs_search_content,
            fs_api::config_read,
            fs_api::config_write,
            fs_api::config_delete,
            fs_api::config_list,
            fs_api::pick_folder,
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
