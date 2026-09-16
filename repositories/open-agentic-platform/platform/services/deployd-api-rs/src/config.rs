#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub oidc_endpoint: String,
    pub audience: String,
    pub required_scope: String,
    /// Optional scope that, when present on a caller's token, overrides the
    /// per-deployment owner check in `auth::is_owner_or_admin` (e.g. an
    /// operator/support tool that legitimately needs cross-tenant access).
    /// Unset by default: with no admin scope configured, the owner check
    /// applies to every caller holding `required_scope`.
    pub admin_scope: Option<String>,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            port: std::env::var("PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(8080),
            oidc_endpoint: std::env::var("OIDC_ENDPOINT")
                .or_else(|_| std::env::var("LOGTO_ENDPOINT"))
                .unwrap_or_default(),
            audience: std::env::var("DEPLOYD_AUDIENCE")
                .expect("DEPLOYD_AUDIENCE env var is required"),
            required_scope: std::env::var("DEPLOYD_REQUIRED_SCOPE")
                .expect("DEPLOYD_REQUIRED_SCOPE env var is required"),
            admin_scope: std::env::var("DEPLOYD_ADMIN_SCOPE")
                .ok()
                .filter(|s| !s.is_empty()),
        }
    }
}

/// Operator-facing backup configuration translated from `DEPLOYD_BACKUP_*`
/// env vars to Hiqlite's `HQL_*` env vars (spec 145 §3.1 FR-005a). Hiqlite
/// v0.13.1's `BackupConfig` type is in a private module; the only path that
/// produces a non-default `NodeConfig.backup_config` is `NodeConfig::from_env()`,
/// which requires the `HQL_*` env vars set on the process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackupConfig {
    pub s3_endpoint: String,
    pub s3_bucket: String,
    pub s3_region: String,
    pub s3_path_style: bool,
    pub s3_access_key: String,
    pub s3_secret_key: String,
    pub cryptr_keyring: String,
    pub cryptr_active_key: String,
    pub cron_schedule: String,
    pub keep_days: u16,
}

const REQUIRED_KEYS: &[&str] = &[
    "DEPLOYD_BACKUP_S3_ENDPOINT",
    "DEPLOYD_BACKUP_S3_BUCKET",
    "DEPLOYD_BACKUP_S3_REGION",
    "DEPLOYD_BACKUP_S3_ACCESS_KEY",
    "DEPLOYD_BACKUP_S3_SECRET_KEY",
    "DEPLOYD_BACKUP_CRYPTR_KEYRING",
    "DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY",
];

impl BackupConfig {
    /// Read `DEPLOYD_BACKUP_*` env vars from the process environment.
    /// Returns `Ok(None)` when no required key is set (operator hasn't
    /// opted in); `Ok(Some(_))` when all required keys are set;
    /// `Err` on partial config.
    pub fn from_env() -> Result<Option<Self>, String> {
        Self::from_var_lookup(|k| std::env::var(k).ok())
    }

    fn from_var_lookup<F>(get: F) -> Result<Option<Self>, String>
    where
        F: Fn(&str) -> Option<String>,
    {
        let v = |k: &str| -> Option<String> { get(k).filter(|s| !s.is_empty()) };

        let any_required_set = REQUIRED_KEYS.iter().any(|k| v(k).is_some());
        if !any_required_set {
            return Ok(None);
        }

        let missing: Vec<&str> = REQUIRED_KEYS
            .iter()
            .copied()
            .filter(|k| v(k).is_none())
            .collect();
        if !missing.is_empty() {
            return Err(format!(
                "Partial backup config: missing required env vars: {}",
                missing.join(", ")
            ));
        }

        let s3_path_style = match v("DEPLOYD_BACKUP_S3_PATH_STYLE") {
            None => true,
            Some(s) => s.parse().map_err(|_| {
                format!("DEPLOYD_BACKUP_S3_PATH_STYLE must be 'true' or 'false', got: {s}")
            })?,
        };
        let cron_schedule = v("DEPLOYD_BACKUP_CRON_SCHEDULE")
            .unwrap_or_else(|| "0 0 */6 * * *".to_string());
        let keep_days = match v("DEPLOYD_BACKUP_KEEP_DAYS") {
            None => 28,
            Some(s) => s
                .parse()
                .map_err(|_| format!("DEPLOYD_BACKUP_KEEP_DAYS must be u16, got: {s}"))?,
        };

        Ok(Some(Self {
            s3_endpoint: v("DEPLOYD_BACKUP_S3_ENDPOINT").unwrap(),
            s3_bucket: v("DEPLOYD_BACKUP_S3_BUCKET").unwrap(),
            s3_region: v("DEPLOYD_BACKUP_S3_REGION").unwrap(),
            s3_path_style,
            s3_access_key: v("DEPLOYD_BACKUP_S3_ACCESS_KEY").unwrap(),
            s3_secret_key: v("DEPLOYD_BACKUP_S3_SECRET_KEY").unwrap(),
            cryptr_keyring: v("DEPLOYD_BACKUP_CRYPTR_KEYRING").unwrap(),
            cryptr_active_key: v("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY").unwrap(),
            cron_schedule,
            keep_days,
        }))
    }

    pub(crate) fn to_hql_env_pairs(&self) -> Vec<(&'static str, String)> {
        vec![
            ("HQL_BACKUP_CRON", self.cron_schedule.clone()),
            ("HQL_BACKUP_KEEP_DAYS", self.keep_days.to_string()),
            ("HQL_S3_URL", self.s3_endpoint.clone()),
            ("HQL_S3_BUCKET", self.s3_bucket.clone()),
            ("HQL_S3_REGION", self.s3_region.clone()),
            ("HQL_S3_PATH_STYLE", self.s3_path_style.to_string()),
            ("HQL_S3_KEY", self.s3_access_key.clone()),
            ("HQL_S3_SECRET", self.s3_secret_key.clone()),
            ("ENC_KEYS", self.cryptr_keyring.clone()),
            ("ENC_KEY_ACTIVE", self.cryptr_active_key.clone()),
        ]
    }

    pub fn apply_to_hql_env(&self) {
        for (k, v) in self.to_hql_env_pairs() {
            // SAFETY: init_db is called once at process startup before any
            // worker thread reads or mutates the process environment; no
            // concurrent access is possible at this point in the lifecycle.
            unsafe { std::env::set_var(k, v) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn from_pairs(pairs: &[(&str, &str)]) -> Result<Option<BackupConfig>, String> {
        let map: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
            .collect();
        BackupConfig::from_var_lookup(|k| map.get(k).cloned())
    }

    fn full_config() -> BackupConfig {
        BackupConfig {
            s3_endpoint: "https://s3.example.com".to_string(),
            s3_bucket: "deployd-backups".to_string(),
            s3_region: "us-east-1".to_string(),
            s3_path_style: true,
            s3_access_key: "AKIAEXAMPLE".to_string(),
            s3_secret_key: "supersecret".to_string(),
            cryptr_keyring: "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=".to_string(),
            cryptr_active_key: "k1".to_string(),
            cron_schedule: "0 0 */6 * * *".to_string(),
            keep_days: 28,
        }
    }

    #[test]
    fn from_env_returns_none_when_no_vars_set() {
        assert_eq!(from_pairs(&[]), Ok(None));
    }

    #[test]
    fn from_env_returns_none_when_required_keys_are_empty_strings() {
        let pairs: Vec<(&str, &str)> = REQUIRED_KEYS.iter().map(|k| (*k, "")).collect();
        assert_eq!(from_pairs(&pairs), Ok(None));
    }

    #[test]
    fn from_env_returns_some_with_full_config() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
        ];
        let cfg = from_pairs(&pairs).unwrap().unwrap();
        assert_eq!(cfg, full_config());
    }

    #[test]
    fn from_env_uses_defaults_for_optional_keys() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
        ];
        let cfg = from_pairs(&pairs).unwrap().unwrap();
        assert!(cfg.s3_path_style);
        assert_eq!(cfg.cron_schedule, "0 0 */6 * * *");
        assert_eq!(cfg.keep_days, 28);
    }

    #[test]
    fn from_env_honors_optional_overrides() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
            ("DEPLOYD_BACKUP_S3_PATH_STYLE", "false"),
            ("DEPLOYD_BACKUP_CRON_SCHEDULE", "0 0 0 * * *"),
            ("DEPLOYD_BACKUP_KEEP_DAYS", "7"),
        ];
        let cfg = from_pairs(&pairs).unwrap().unwrap();
        assert!(!cfg.s3_path_style);
        assert_eq!(cfg.cron_schedule, "0 0 0 * * *");
        assert_eq!(cfg.keep_days, 7);
    }

    #[test]
    fn from_env_errors_on_partial_config_missing_secret_key() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            // DEPLOYD_BACKUP_S3_SECRET_KEY missing
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
        ];
        let err = from_pairs(&pairs).unwrap_err();
        assert!(err.contains("DEPLOYD_BACKUP_S3_SECRET_KEY"), "got: {err}");
    }

    #[test]
    fn from_env_errors_on_partial_config_missing_cryptr_keys() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            // DEPLOYD_BACKUP_CRYPTR_KEYRING + DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY missing
        ];
        let err = from_pairs(&pairs).unwrap_err();
        assert!(err.contains("DEPLOYD_BACKUP_CRYPTR_KEYRING"), "got: {err}");
        assert!(err.contains("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY"), "got: {err}");
    }

    #[test]
    fn from_env_errors_on_invalid_path_style_value() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
            ("DEPLOYD_BACKUP_S3_PATH_STYLE", "yes"),
        ];
        let err = from_pairs(&pairs).unwrap_err();
        assert!(err.contains("DEPLOYD_BACKUP_S3_PATH_STYLE"), "got: {err}");
    }

    #[test]
    fn from_env_errors_on_invalid_keep_days() {
        let pairs = [
            ("DEPLOYD_BACKUP_S3_ENDPOINT", "https://s3.example.com"),
            ("DEPLOYD_BACKUP_S3_BUCKET", "deployd-backups"),
            ("DEPLOYD_BACKUP_S3_REGION", "us-east-1"),
            ("DEPLOYD_BACKUP_S3_ACCESS_KEY", "AKIAEXAMPLE"),
            ("DEPLOYD_BACKUP_S3_SECRET_KEY", "supersecret"),
            (
                "DEPLOYD_BACKUP_CRYPTR_KEYRING",
                "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
            ),
            ("DEPLOYD_BACKUP_CRYPTR_ACTIVE_KEY", "k1"),
            ("DEPLOYD_BACKUP_KEEP_DAYS", "not-a-number"),
        ];
        let err = from_pairs(&pairs).unwrap_err();
        assert!(err.contains("DEPLOYD_BACKUP_KEEP_DAYS"), "got: {err}");
    }

    #[test]
    fn to_hql_env_pairs_translates_all_fields() {
        let cfg = full_config();
        let pairs = cfg.to_hql_env_pairs();
        let map: std::collections::BTreeMap<_, _> = pairs.into_iter().collect();
        assert_eq!(map.get("HQL_BACKUP_CRON").unwrap(), "0 0 */6 * * *");
        assert_eq!(map.get("HQL_BACKUP_KEEP_DAYS").unwrap(), "28");
        assert_eq!(map.get("HQL_S3_URL").unwrap(), "https://s3.example.com");
        assert_eq!(map.get("HQL_S3_BUCKET").unwrap(), "deployd-backups");
        assert_eq!(map.get("HQL_S3_REGION").unwrap(), "us-east-1");
        assert_eq!(map.get("HQL_S3_PATH_STYLE").unwrap(), "true");
        assert_eq!(map.get("HQL_S3_KEY").unwrap(), "AKIAEXAMPLE");
        assert_eq!(map.get("HQL_S3_SECRET").unwrap(), "supersecret");
        assert_eq!(
            map.get("ENC_KEYS").unwrap(),
            "k1/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
        );
        assert_eq!(map.get("ENC_KEY_ACTIVE").unwrap(), "k1");
    }
}
