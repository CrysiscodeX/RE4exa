// Go extractor for dissect. Reads absolute .go paths (one per line) on stdin and
// writes one JSON object per file on stdout. Uses go/parser only; nothing is built or run.
package main

import (
	"bufio"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"regexp"
	"strconv"
	"strings"
)

type sym struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	Line     int    `json:"line"`
	End      int    `json:"end"`
	Doc      string `json:"doc,omitempty"`
	Parent   string `json:"parent,omitempty"`
	Exported bool   `json:"exported"`
	Params   int    `json:"params"`
}
type call struct {
	From string `json:"from,omitempty"`
	To   string `json:"to"`
	Line int    `json:"line"`
}
type out struct {
	Path      string   `json:"path"`
	Package   string   `json:"package"`
	Symbols   []sym    `json:"symbols"`
	Imports   []string `json:"imports"`
	Calls     []call   `json:"calls"`
	Env       []string `json:"env"`
	Signals   []string `json:"signals"`
	Timers    int      `json:"timers"`
	Goroutine int      `json:"goroutines"`
	States    []string `json:"states"`
	Lifecycle []string `json:"lifecycle"`
	Commands  []string `json:"commands"`
	Errors    string   `json:"errors,omitempty"`
}

var lifecycle = regexp.MustCompile(`(?i)^(start|stop|close|dispose|cleanup|shutdown|teardown|setup|init|open|resume|retry|restart|reconnect|heartbeat|checkpoint|commit|rollback|abort|cancel|drain|flush|claim|release|acquire|spawn|kill|terminate|attach|detach|connect|disconnect|recover|restore|migrate|compact|expire|evict|schedule|tick|poll|run|serve|listen|watch)`)
var stateWords = map[string]bool{"pending": true, "running": true, "completed": true, "failed": true, "cancelled": true, "canceled": true, "sleeping": true, "queued": true, "succeeded": true, "aborted": true, "timeout": true, "open": true, "closed": true, "resolved": true, "blocked": true, "idle": true, "active": true, "ready": true, "starting": true, "stopping": true, "stopped": true, "exited": true, "expired": true, "retrying": true}

func selector(e ast.Expr) string {
	switch v := e.(type) {
	case *ast.Ident:
		return v.Name
	case *ast.SelectorExpr:
		if x := selector(v.X); x != "" {
			return x + "." + v.Sel.Name
		}
		return v.Sel.Name
	}
	return ""
}

func firstLine(g *ast.CommentGroup) string {
	if g == nil {
		return ""
	}
	t := strings.TrimSpace(strings.SplitN(g.Text(), "\n", 2)[0])
	if len(t) > 240 {
		t = t[:240]
	}
	return t
}

func extract(path string) out {
	o := out{Path: path, Symbols: []sym{}, Imports: []string{}, Calls: []call{}, Env: []string{}, Signals: []string{}, States: []string{}, Lifecycle: []string{}, Commands: []string{}}
	fs := token.NewFileSet()
	f, err := parser.ParseFile(fs, path, nil, parser.ParseComments|parser.SkipObjectResolution)
	if err != nil && f == nil {
		o.Errors = "parse"
		return o
	}
	o.Package = f.Name.Name
	for _, im := range f.Imports {
		if p, e := strconv.Unquote(im.Path.Value); e == nil {
			o.Imports = append(o.Imports, p)
		}
	}
	seen := map[*[]string]map[string]bool{}
	add := func(list *[]string, v string) {
		if seen[list] == nil {
			seen[list] = map[string]bool{}
		}
		if !seen[list][v] {
			seen[list][v] = true
			*list = append(*list, v)
		}
	}
	for _, d := range f.Decls {
		switch v := d.(type) {
		case *ast.FuncDecl:
			s := sym{Kind: "function", Name: v.Name.Name, Line: fs.Position(v.Pos()).Line, End: fs.Position(v.End()).Line, Doc: firstLine(v.Doc), Exported: v.Name.IsExported(), Params: v.Type.Params.NumFields()}
			if v.Recv != nil && len(v.Recv.List) > 0 {
				s.Kind = "method"
				t := v.Recv.List[0].Type
				if st, ok := t.(*ast.StarExpr); ok {
					t = st.X
				}
				if ix, ok := t.(*ast.IndexExpr); ok {
					t = ix.X
				}
				s.Parent = selector(t)
			}
			o.Symbols = append(o.Symbols, s)
			if lifecycle.MatchString(v.Name.Name) {
				o.Lifecycle = append(o.Lifecycle, v.Name.Name)
			}
			if v.Name.Name == "main" && o.Package == "main" {
				o.Commands = append(o.Commands, "main")
			}
			if v.Body != nil {
				from := v.Name.Name
				ast.Inspect(v.Body, func(n ast.Node) bool {
					switch c := n.(type) {
					case *ast.CallExpr:
						name := selector(c.Fun)
						if name == "" {
							return true
						}
						if len(o.Calls) < 400 {
							o.Calls = append(o.Calls, call{From: from, To: name, Line: fs.Position(c.Pos()).Line})
						}
						if (name == "os.Getenv" || name == "os.LookupEnv") && len(c.Args) > 0 {
							if bl, ok := c.Args[0].(*ast.BasicLit); ok {
								if s, e := strconv.Unquote(bl.Value); e == nil {
									add(&o.Env, s)
								}
							}
						}
						if name == "signal.Notify" {
							for _, a := range c.Args[1:] {
								add(&o.Signals, selector(a))
							}
						}
						if name == "time.NewTicker" || name == "time.Tick" || name == "time.AfterFunc" || name == "time.NewTimer" {
							o.Timers++
						}
					case *ast.GoStmt:
						o.Goroutine++
					case *ast.BasicLit:
						if c.Kind == token.STRING {
							if s, e := strconv.Unquote(c.Value); e == nil && stateWords[s] {
								add(&o.States, s)
							}
						}
					}
					return true
				})
			}
		case *ast.GenDecl:
			for _, sp := range v.Specs {
				if ts, ok := sp.(*ast.TypeSpec); ok {
					kind := "type"
					switch ts.Type.(type) {
					case *ast.StructType:
						kind = "class"
					case *ast.InterfaceType:
						kind = "interface"
					}
					doc := firstLine(ts.Doc)
					if doc == "" {
						doc = firstLine(v.Doc)
					}
					o.Symbols = append(o.Symbols, sym{Kind: kind, Name: ts.Name.Name, Line: fs.Position(ts.Pos()).Line, End: fs.Position(ts.End()).Line, Doc: doc, Exported: ts.Name.IsExported()})
				}
			}
		}
	}
	return o
}

func main() {
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 1<<20), 1<<20)
	enc := json.NewEncoder(os.Stdout)
	for in.Scan() {
		p := strings.TrimSpace(in.Text())
		if p != "" {
			_ = enc.Encode(extract(p))
		}
	}
}
