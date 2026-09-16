use axiomregent::util::paths::discover_workspace_root;
use std::fs;
use tempfile::tempdir;

#[test]
fn test_repo_root_discovery() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Create .axiomregent
    fs::create_dir(root.join(".axiomregent")).unwrap();

    // Test discovering from root
    let discovered = discover_workspace_root(root);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
}

#[test]
fn test_wc_walk_up() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Structure: root/.axiomregent, root/crates/foo
    fs::create_dir(root.join(".axiomregent")).unwrap();
    let nested = root.join("crates/foo");
    fs::create_dir_all(&nested).unwrap();

    let discovered = discover_workspace_root(&nested);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
}

#[test]
fn test_fallback_to_cwd() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // No markers

    let discovered = discover_workspace_root(root);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
}

#[test]
fn test_git_fallback() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // .git but no .axiomregent
    fs::create_dir(root.join(".git")).unwrap();

    let discovered = discover_workspace_root(root);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
}

#[test]
fn test_prefer_axiomregent_over_git() {
    let dir = tempdir().unwrap();
    let root = dir.path();

    // Both exist
    fs::create_dir(root.join(".axiomregent")).unwrap();
    fs::create_dir(root.join(".git")).unwrap();

    let discovered = discover_workspace_root(root);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        root.canonicalize().unwrap()
    );
}

#[test]
fn test_nested_boundary() {
    // /outer/.git
    // /outer/inner/.axiomregent
    // Start at /outer/inner/deep
    // Should find /outer/inner

    let dir = tempdir().unwrap();
    let outer = dir.path();
    fs::create_dir(outer.join(".git")).unwrap();

    let inner = outer.join("inner");
    fs::create_dir_all(&inner).unwrap();
    fs::create_dir(inner.join(".axiomregent")).unwrap();

    let deep = inner.join("deep");
    fs::create_dir_all(&deep).unwrap();

    let discovered = discover_workspace_root(&deep);
    assert_eq!(
        discovered.canonicalize().unwrap(),
        inner.canonicalize().unwrap()
    );
}
