fn main() {
    // Only wire the napi cdylib link args for the addon build. Under
    // `cargo test --no-default-features` the `node` feature is off and the
    // test harness must not carry Node's dynamic-lookup link flags.
    if std::env::var_os("CARGO_FEATURE_NODE").is_some() {
        napi_build::setup();
    }
}
