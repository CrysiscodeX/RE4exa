fn main() {
    println!("cargo:rustc-env=REAX_BUILD_TAG={}", reaxbuild::tag());
}
