#!/usr/bin/env bash
set -euo pipefail
# Compatibiliteit: oude naam blijft werken, ook na overgang naar poort 8090.
exec bash "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/update.sh" "$@"
