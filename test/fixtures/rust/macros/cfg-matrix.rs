//! cfg matrix fixture: one hint per gated item.

#[cfg(unix)]
fn unix_item() {
    let u = 1;
}

#[cfg(windows)]
fn windows_item() {
    let w = 1;
}

#[cfg(feature = "a")]
fn feature_a() {
    let a = 1;
}

#[cfg(feature = "b")]
fn feature_b() {
    let b = 1;
}

#[cfg(feature = "zz")]
fn feature_zz() {
    let z = 1;
}

#[cfg(test)]
fn test_item() {
    let t = 1;
}

#[cfg(unix)]
#[allow(dead_code)]
#[cfg(feature = "a")]
fn merged() {
    let m = 1;
}

#[cfg(unix)] fn one_liner() {}
