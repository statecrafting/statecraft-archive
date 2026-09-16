//! napi-rs bindings. Async, plain-JSON-in / plain-JSON-out so the Encore.ts
//! fleet service never marshals native types (statecraft spec 006 §2). napi-derive
//! lower-cases snake_case to camelCase, so the JS surface reads `placeApp`,
//! `appStatus`, `updateApp`, `backupApp`, `removeApp`. Compiled only under the
//! `node` feature; each returns a Promise the service awaits.

use napi_derive::napi;

use crate::kube_ops;
use crate::types::{BackupTarget, DeploySpec};

fn err(e: String) -> napi::Error {
    napi::Error::from_reason(e)
}

fn parse<T: serde::de::DeserializeOwned>(json: &str, what: &str) -> napi::Result<T> {
    serde_json::from_str(json).map_err(|e| err(format!("parse {what}: {e}")))
}

fn dump<T: serde::Serialize>(value: &T) -> napi::Result<String> {
    serde_json::to_string(value).map_err(|e| err(format!("serialize: {e}")))
}

/// Place an app: returns the app status JSON once the rollout is ready.
#[napi]
pub async fn place_app(spec_json: String) -> napi::Result<String> {
    let spec: DeploySpec = parse(&spec_json, "DeploySpec")?;
    let status = kube_ops::place_app(&spec).await.map_err(err)?;
    dump(&status)
}

/// The live status JSON of a placed app.
#[napi]
pub async fn app_status(name: String, namespace: String) -> napi::Result<String> {
    let status = kube_ops::app_status(&name, &namespace)
        .await
        .map_err(err)?;
    dump(&status)
}

/// Change an app's image (Recreate rollout); returns the app status JSON.
#[napi]
pub async fn update_app(spec_json: String) -> napi::Result<String> {
    let spec: DeploySpec = parse(&spec_json, "DeploySpec")?;
    let status = kube_ops::update_app(&spec).await.map_err(err)?;
    dump(&status)
}

/// Back up an app's `/data` to the target; returns the artifact location JSON.
#[napi]
pub async fn backup_app(
    name: String,
    namespace: String,
    target_json: String,
) -> napi::Result<String> {
    let target: BackupTarget = parse(&target_json, "BackupTarget")?;
    let result = kube_ops::backup_app(&name, &namespace, &target)
        .await
        .map_err(err)?;
    dump(&result)
}

/// Remove an app's per-app resources; returns the remove result JSON.
#[napi]
pub async fn remove_app(name: String, namespace: String) -> napi::Result<String> {
    let result = kube_ops::remove_app(&name, &namespace)
        .await
        .map_err(err)?;
    dump(&result)
}
