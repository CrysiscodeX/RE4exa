#!/usr/bin/env bash
# Run dissect from a checkout without installing it.
exec python3 -I "$(dirname "$(readlink -f "$0")")/run.py" "$@"
