// reax fixture: a shared library with exported functions and data, a function-pointer table,
// and a hidden function that must not appear in the export table. Written for reax; Apache-2.0.
#define EXPORT __attribute__((visibility("default")))
#ifdef __wasm__
#undef EXPORT
#define EXPORT __attribute__((visibility("default"), used))
#endif

EXPORT int reax_counter = 3;

__attribute__((visibility("hidden"))) int reax_hidden(int x) { return x * 3 + reax_counter; }

EXPORT int reax_add(int a, int b) { return a + b; }
EXPORT int reax_mul(int a, int b) { return a * b; }
EXPORT const char *reax_version(void) { return "reax-fixture-lib 1.0.0"; }

typedef int (*op_fn)(int, int);
static const op_fn ops[] = { reax_add, reax_mul };

EXPORT int reax_apply(int which, int a, int b) {
  if (which < 0 || which > 1) return reax_hidden(a);
  return ops[which](a, b);
}
