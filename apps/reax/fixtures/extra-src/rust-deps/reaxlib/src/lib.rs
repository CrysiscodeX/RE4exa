/// The dependency's one function, so the binary links the crate.
pub fn greet(who: &str) -> String {
    if cfg!(feature = "shout") {
        format!("HELLO, {}", who.to_uppercase())
    } else {
        format!("hello, {who}")
    }
}
