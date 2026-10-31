// The Go answer key for reax (scripts/oracle.ts runs it): Go's own readers of a Go binary.
// debug/buildinfo reads the build information; debug/gosym reads the pclntab function table,
// located through the section name (ELF .gopclntab, Mach-O __gopclntab) or, in a stripped PE,
// the pclntab header that the runtime's symbol pointed at.
//
//	go run ./scripts/oracle-go <binary>   prints JSON on stdout
package main

import (
	"bytes"
	"debug/buildinfo"
	"debug/elf"
	"debug/gosym"
	"debug/pe"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"os"
)

type fn struct {
	Name  string `json:"name"`
	Entry string `json:"entry"`
}

type out struct {
	GoVersion string          `json:"goVersion"`
	Path      string          `json:"path"`
	Main      *buildinfoMod   `json:"main"`
	Deps      []*buildinfoMod `json:"deps"`
	Settings  [][2]string     `json:"settings"`
	Funcs     []fn            `json:"funcs"`
}

type buildinfoMod struct {
	Path    string        `json:"path"`
	Version string        `json:"version"`
	Sum     string        `json:"sum"`
	Replace *buildinfoMod `json:"replace"`
}

func pclntab(path string) ([]byte, error) {
	if f, err := elf.Open(path); err == nil {
		defer f.Close()
		if s := f.Section(".gopclntab"); s != nil {
			return s.Data()
		}
		return nil, fmt.Errorf("no .gopclntab")
	}
	f, err := pe.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	// a stripped PE has no runtime.pclntab symbol: find the 1.20+ header in .rdata
	for _, s := range f.Sections {
		d, err := s.Data()
		if err != nil {
			continue
		}
		for i := 0; i+8 <= len(d); i += 4 {
			if binary.LittleEndian.Uint32(d[i:]) == 0xfffffff1 && d[i+4] == 0 && d[i+5] == 0 && (d[i+7] == 8 || d[i+7] == 4) {
				return d[i:], nil
			}
		}
	}
	return nil, fmt.Errorf("no pclntab header")
}

func main() {
	path := os.Args[1]
	bi, err := buildinfo.ReadFile(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	o := out{GoVersion: bi.GoVersion, Path: bi.Path}
	cp := func(path, version, sum string) *buildinfoMod {
		return &buildinfoMod{Path: path, Version: version, Sum: sum}
	}
	o.Main = cp(bi.Main.Path, bi.Main.Version, bi.Main.Sum)
	for _, d := range bi.Deps {
		m := cp(d.Path, d.Version, d.Sum)
		if d.Replace != nil {
			m.Replace = cp(d.Replace.Path, d.Replace.Version, d.Replace.Sum)
		}
		o.Deps = append(o.Deps, m)
	}
	for _, s := range bi.Settings {
		o.Settings = append(o.Settings, [2]string{s.Key, s.Value})
	}
	data, err := pclntab(path)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	// the 1.18+ header's third word is the text start; gosym takes it from its caller
	ptr := int(data[7])
	var text uint64
	if ptr == 8 {
		text = binary.LittleEndian.Uint64(data[8+2*ptr:])
	} else {
		text = uint64(binary.LittleEndian.Uint32(data[8+2*ptr:]))
	}
	t, err := gosym.NewTable(nil, gosym.NewLineTable(bytes.Clone(data), text))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	for _, f := range t.Funcs {
		o.Funcs = append(o.Funcs, fn{Name: f.Name, Entry: fmt.Sprintf("0x%x", f.Entry)})
	}
	enc := json.NewEncoder(os.Stdout)
	if err := enc.Encode(o); err != nil {
		os.Exit(1)
	}
}
