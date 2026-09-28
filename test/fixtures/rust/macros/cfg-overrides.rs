#[cfg(unix)]
fn unix_item() {
    let u = 1;
}

#[cfg(feature = "a")]
fn feature_a() {
    let a = 1;
}
