// reax fixture: C++ with namespaces, a class hierarchy with virtual functions, a template and
// an extern "C" entry, so mangled names, vtables and RTTI appear. Written for reax.
#include <cstdio>

namespace reax {
struct Shape {
  virtual ~Shape() {}
  virtual double area() const = 0;
};
struct Circle : Shape {
  double r;
  explicit Circle(double radius) : r(radius) {}
  double area() const override { return 3.14159 * r * r; }
};
struct Square : Shape {
  double s;
  explicit Square(double side) : s(side) {}
  double area() const override { return s * s; }
};
template <typename T> T twice(T v) { return v + v; }
double total(const Shape *const *shapes, int n) {
  double t = 0;
  for (int i = 0; i < n; i++) t += shapes[i]->area();
  return t;
}
}  // namespace reax

extern "C" int reax_shapes_entry(int n) {
  reax::Circle c(n);
  reax::Square s(n + 1);
  const reax::Shape *all[] = {&c, &s};
  return (int)reax::twice(reax::total(all, 2));
}

int main(int argc, char **) {
  std::printf("%d\n", reax_shapes_entry(argc));
  return 0;
}
