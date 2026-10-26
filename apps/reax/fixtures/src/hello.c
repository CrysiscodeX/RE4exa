// reax fixture: a small program with strings, an exported function, a static helper, a jump
// table and libc imports. Written for reax; Apache-2.0.
#include <stdio.h>
#include <string.h>

static const char banner[] = "reax fixture: hello";
const char *const reax_build_tag = "reax-fixture-tag-7f3a";

static int classify(int c) {
  switch (c % 7) {
    case 0: return 11;
    case 1: return 23;
    case 2: return 37;
    case 3: return 41;
    case 4: return 53;
    case 5: return 67;
    default: return 79;
  }
}

__attribute__((visibility("default"))) int reax_add(int a, int b) { return a + b; }

int main(int argc, char **argv) {
  puts(banner);
  int n = classify(argc) + (int)strlen(argv[0]);
  printf("%s %d\n", reax_build_tag, reax_add(n, argc));
  return 0;
}
