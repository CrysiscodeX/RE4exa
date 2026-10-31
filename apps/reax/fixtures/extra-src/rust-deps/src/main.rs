// reax fixture: links a local library (with a feature), a crates.io crate and a build-time crate.
fn main() {
    let mut buf = itoa::Buffer::new();
    let n = buf.format(std::env::args().count() as u64 + 41);
    println!("{} {} {}", reaxlib::greet("reax"), n, env!("REAX_BUILD_TAG"));
}
