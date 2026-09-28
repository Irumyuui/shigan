//! Manual sample for Rust: `#[cfg]` gating hints, lifetimes and raw strings.

#[cfg(feature = "extra")]
fn feature_extra() {
    let value = 1;
    let _ = value;
}

#[cfg(unix)]
fn unix_only() {
    let value = 2;
    let _ = value;
}

#[cfg(windows)]
fn windows_only() {
    let value = 3;
    let _ = value;
}

fn borrow<'a>(text: &'a str) -> &'a str {
    let raw = r#" a raw string with { ( } ] "#;
    let _ = raw;
    text
}

fn main() {
    let _ = borrow("hi");
}
