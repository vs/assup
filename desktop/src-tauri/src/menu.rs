use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder, PredefinedMenuItem},
    AppHandle, Manager, Wry,
};

pub fn create_menu(app: &AppHandle) -> tauri::Result<tauri::menu::Menu<Wry>> {
    // View menu with navigation shortcuts
    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("reload", "Reload").accelerator("CmdOrCtrl+R").build(app)?)
        .separator()
        .item(&MenuItemBuilder::with_id("nav_allocation", "Allocation").accelerator("CmdOrCtrl+1").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_positions", "Positions").accelerator("CmdOrCtrl+2").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_scanner", "Scanner").accelerator("CmdOrCtrl+3").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_watchlists", "Watchlists").accelerator("CmdOrCtrl+4").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_profit", "Profit").accelerator("CmdOrCtrl+5").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_wheel", "Wheel").accelerator("CmdOrCtrl+6").build(app)?)
        .item(&MenuItemBuilder::with_id("nav_taxes", "Taxes").accelerator("CmdOrCtrl+7").build(app)?)
        .build()?;

    // Window menu
    let window_menu = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .item(&SubmenuBuilder::new(app, "Assup")
            .item(&PredefinedMenuItem::about(app, None, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .item(&PredefinedMenuItem::show_all(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?)
        .item(&SubmenuBuilder::new(app, "Edit")
            .item(&PredefinedMenuItem::undo(app, None)?)
            .item(&PredefinedMenuItem::redo(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::cut(app, None)?)
            .item(&PredefinedMenuItem::copy(app, None)?)
            .item(&PredefinedMenuItem::paste(app, None)?)
            .item(&PredefinedMenuItem::select_all(app, None)?)
            .build()?)
        .item(&view_menu)
        .item(&window_menu)
        .build()?;

    Ok(menu)
}

pub fn handle_menu_event(app: &AppHandle, event_id: &str) {
    let window = match app.get_webview_window("main") {
        Some(w) => w,
        None => return,
    };

    match event_id {
        "reload" => {
            let _ = window.eval("window.location.reload()");
        }
        "nav_allocation" => {
            let _ = window.eval("window.location.href = '/'");
        }
        "nav_positions" => {
            let _ = window.eval("window.location.href = '/positions'");
        }
        "nav_scanner" => {
            let _ = window.eval("window.location.href = '/scanner'");
        }
        "nav_watchlists" => {
            let _ = window.eval("window.location.href = '/watchlists'");
        }
        "nav_profit" => {
            let _ = window.eval("window.location.href = '/profit'");
        }
        "nav_wheel" => {
            let _ = window.eval("window.location.href = '/wheel'");
        }
        "nav_taxes" => {
            let _ = window.eval("window.location.href = '/taxes'");
        }
        _ => {}
    }
}
