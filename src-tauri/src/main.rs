use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
  let app_url = option_env!("DESKTOP_APP_URL").unwrap_or("http://localhost:3000");
  let external_url = app_url.parse().expect("DESKTOP_APP_URL phải là URL hợp lệ");

  tauri::Builder::default()
    .setup(move |app| {
      WebviewWindowBuilder::new(app, "main", WebviewUrl::External(external_url))
        .title("AI Content Modeling")
        .inner_size(1440.0, 920.0)
        .min_inner_size(1100.0, 720.0)
        .build()?;
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("Không thể chạy AI Content Modeling Desktop");
}
