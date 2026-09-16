use anyhow::{Result, anyhow};
use axum::http::HeaderMap;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

#[derive(Debug, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Option<String>,
    pub scope: Option<String>,
    pub exp: Option<u64>,
    pub aud: Option<serde_json::Value>,
}

// Cached JWKS: stores (json_body, issuer, fetched_at)
static JWKS_CACHE: Lazy<Mutex<Option<(String, String, std::time::Instant)>>> =
    Lazy::new(|| Mutex::new(None));

pub async fn verify_jwt(
    headers: &HeaderMap,
    oidc_endpoint: &str,
    audience: &str,
) -> Result<Claims> {
    let auth_header = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .ok_or_else(|| anyhow!("Missing Authorization header"))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| anyhow!("Invalid Authorization header format"))?;

    // Fetch JWKS and Issuer (with 10-minute cache)
    let (jwks_json, issuer) = fetch_jwks_and_issuer(oidc_endpoint).await?;

    // Decode header to find kid
    let header = decode_header(token)?;
    let kid = header
        .kid
        .as_ref()
        .ok_or_else(|| anyhow!("Token missing kid"))?;

    // Parse JWKS and locate the key by kid. `from_jwk` handles both RSA and
    // OKP (Ed25519) parameter shapes, so we don't hand-parse n/e or x/crv.
    let jwks: JwkSet =
        serde_json::from_str(&jwks_json).map_err(|e| anyhow!("Failed to parse JWKS: {e}"))?;

    let jwk = jwks
        .find(kid)
        .ok_or_else(|| anyhow!("No matching key for kid: {kid}"))?;

    let decoding_key = DecodingKey::from_jwk(jwk)
        .map_err(|e| anyhow!("Failed to build decoding key from JWK: {e}"))?;

    // Accept both RS256 and EdDSA — Rauthy signs with Ed25519 by default, but
    // RSA keeps working for any rotated/legacy tokens still in flight. The
    // header's declared alg drives the verifier; jsonwebtoken 10.x rejects
    // when validation.algorithms contains entries of mixed families relative
    // to the active verifier (decoding.rs:342), so we narrow to the header's
    // alg here after gating it against the cross-family allowlist.
    let allowed = [Algorithm::RS256, Algorithm::EdDSA];
    if !allowed.contains(&header.alg) {
        return Err(anyhow!("Unsupported JWT alg: {:?}", header.alg));
    }
    let mut validation = Validation::new(header.alg);
    validation.algorithms = vec![header.alg];
    validation.set_audience(&[audience]);
    validation.set_issuer(&[&issuer]);
    validation.validate_exp = true;

    let decoded = decode::<Claims>(token, &decoding_key, &validation)?;
    Ok(decoded.claims)
}

pub fn has_scope(claims: &Claims, required: &str) -> bool {
    if required.is_empty() {
        // An empty required scope is a misconfiguration (e.g.
        // DEPLOYD_REQUIRED_SCOPE=""), not "no scope required". Failing open
        // here would silently disable authorization for every route that
        // calls this function; fail closed and log loudly instead.
        tracing::error!(
            "has_scope called with an empty required scope; this is a misconfiguration \
             (DEPLOYD_REQUIRED_SCOPE must be non-empty) and is being denied, not allowed"
        );
        return false;
    }
    claims
        .scope
        .as_ref()
        .map(|s| s.split_whitespace().any(|sc| sc == required))
        .unwrap_or(false)
}

/// Tenant-ownership check for a stored deployment. `owner_sub` is the `sub`
/// claim recorded on the deployment row at create time (see
/// `routes::create_deployment`); `admin_scope` is the optional
/// `DEPLOYD_ADMIN_SCOPE` override.
///
/// Returns true when:
///   * `admin_scope` is configured and the caller's token carries it, or
///   * the row predates ownership tracking (`owner_sub` is `None`), which
///     degrades to the scope-only check that gated every route before this
///     check was added, or
///   * the caller's `sub` claim matches the recorded owner.
///
/// The `owner_sub: None => allowed` branch is intentionally narrow: it
/// exists only to cover genuine legacy rows written before this column
/// existed. `routes::create_deployment` rejects any request whose token is
/// missing a `sub` claim before inserting, so every *new* row always
/// carries a real owner and can never (re-)enter that branch going
/// forward.
///
/// Residual: every M2M caller sharing the same OIDC client (today, all of
/// statecraft's tenant-facing requests) presents the same `sub`, so this
/// check separates *distinct M2M callers* holding the required scope, not
/// individual end-tenants within statecraft. Per-tenant isolation for
/// requests routed through a single M2M identity must happen upstream
/// (statecraft's own project-membership checks) until a per-tenant-scoped
/// credential or signed tenant assertion is threaded through to deployd-api.
pub fn is_owner_or_admin(
    claims: &Claims,
    owner_sub: Option<&str>,
    admin_scope: Option<&str>,
) -> bool {
    if let Some(admin) = admin_scope
        && has_scope(claims, admin)
    {
        return true;
    }
    match owner_sub {
        None => true,
        Some(owner) => claims.sub.as_deref() == Some(owner),
    }
}

async fn fetch_jwks_and_issuer(oidc_endpoint: &str) -> Result<(String, String)> {
    // Check cache
    {
        let cache = JWKS_CACHE
            .lock()
            .map_err(|e| anyhow!("JWKS cache lock poisoned: {}", e))?;
        if let Some((cached_body, cached_iss, ts)) = cache.as_ref()
            && ts.elapsed() < std::time::Duration::from_secs(600)
        {
            return Ok((cached_body.clone(), cached_iss.clone()));
        }
    }

    let url = format!(
        "{}/auth/v1/.well-known/openid-configuration",
        oidc_endpoint.trim_end_matches('/')
    );
    let resp: serde_json::Value = reqwest::get(&url).await?.json().await?;
    let jwks_uri = resp["jwks_uri"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("No jwks_uri in OIDC discovery"))?;
    let issuer = resp["issuer"]
        .as_str()
        .map(String::from)
        .ok_or_else(|| anyhow!("No issuer in OIDC discovery"))?;

    let body = reqwest::get(&jwks_uri).await?.text().await?;

    {
        let mut cache = JWKS_CACHE
            .lock()
            .map_err(|e| anyhow!("JWKS cache lock poisoned: {}", e))?;
        *cache = Some((body.clone(), issuer.clone(), std::time::Instant::now()));
    }
    Ok((body, issuer))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(sub: Option<&str>, scope: Option<&str>) -> Claims {
        Claims {
            sub: sub.map(str::to_string),
            scope: scope.map(str::to_string),
            exp: None,
            aud: None,
        }
    }

    #[test]
    fn has_scope_denies_when_required_is_empty() {
        // Regression: DEPLOYD_REQUIRED_SCOPE="" must fail closed, not
        // silently authorize every caller.
        let c = claims(Some("client-a"), Some("deploy:write"));
        assert!(!has_scope(&c, ""));
    }

    #[test]
    fn has_scope_matches_one_of_several_scopes() {
        let c = claims(Some("client-a"), Some("read write deploy:write"));
        assert!(has_scope(&c, "deploy:write"));
        assert!(!has_scope(&c, "deploy:admin"));
    }

    #[test]
    fn has_scope_denies_when_claims_carry_no_scope() {
        let c = claims(Some("client-a"), None);
        assert!(!has_scope(&c, "deploy:write"));
    }

    #[test]
    fn is_owner_or_admin_allows_legacy_rows_without_recorded_owner() {
        let c = claims(Some("client-a"), None);
        assert!(is_owner_or_admin(&c, None, None));
    }

    #[test]
    fn is_owner_or_admin_allows_matching_owner() {
        let c = claims(Some("client-a"), None);
        assert!(is_owner_or_admin(&c, Some("client-a"), None));
    }

    #[test]
    fn is_owner_or_admin_denies_mismatched_owner_without_admin_scope() {
        let c = claims(Some("client-b"), None);
        assert!(!is_owner_or_admin(&c, Some("client-a"), None));
    }

    #[test]
    fn is_owner_or_admin_denies_mismatched_owner_when_admin_scope_not_held() {
        let c = claims(Some("client-b"), Some("deploy:write"));
        assert!(!is_owner_or_admin(
            &c,
            Some("client-a"),
            Some("deploy:admin")
        ));
    }

    #[test]
    fn is_owner_or_admin_allows_mismatched_owner_when_admin_scope_held() {
        let c = claims(Some("client-b"), Some("deploy:admin"));
        assert!(is_owner_or_admin(
            &c,
            Some("client-a"),
            Some("deploy:admin")
        ));
    }
}
