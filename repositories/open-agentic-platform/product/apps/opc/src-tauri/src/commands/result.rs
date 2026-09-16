/// Standard result type for all Tauri command handlers.
/// The `Err` variant serialises to a plain string so the JS layer receives
/// a typed rejection rather than an opaque error object.
pub type AppResult<T> = Result<T, String>;

/// Extension trait to convert any `Display` error into `AppResult`.
pub trait IntoAppResult<T> {
    fn app_err(self) -> AppResult<T>;
}

impl<T, E: std::fmt::Display> IntoAppResult<T> for Result<T, E> {
    fn app_err(self) -> AppResult<T> {
        self.map_err(|e| e.to_string())
    }
}
