// line comment with ) } ]
/* block comment with ( { [
   nested /* still a comment */ ( { [
   ( { [ */
fn f<'a>(x: &'a T) -> &'a str { x }
const CH: char = '}';
const RAW: &str = r#" raw { ( } ]"#;
#[allow(dead_code)]
fn real() {
    let ok = ();
}
