fn control_flow(xs: &[i32], y: Option<i32>) {
    loop {
        break;
    }
    while cond() {
        work();
    }
    while let Some(x) = y {
        use_it(x);
    }
    for x in xs {
        println!("{x}");
    }
    for i in 0..10 { tick(i); }
    'outer: for a in xs {
        for b in xs {
            if *a == *b {
                continue 'outer;
            }
        }
    }
    if let Some(v) = y {
        consume(v);
    } else { fallback(); }
    match y {
        Some(_) => {
            consume('}');
        }
        None => {}
    }
}
