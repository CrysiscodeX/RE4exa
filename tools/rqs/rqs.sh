#!/usr/bin/env bash
# Run rqs from a checkout without installing it.
exec python3 -I "$(dirname "$(readlink -f "$0")")/run.py" "$@"
