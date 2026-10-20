#!/usr/bin/env bash
# Run rex from a checkout without installing it.
exec python3 -I -c 'import sys; sys.path.insert(0, sys.argv.pop(1)); from rex.cli import main; sys.exit(main())' "$(dirname "$(readlink -f "$0")")" "$@"
