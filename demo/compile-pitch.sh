#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
xelatex -interaction=nonstopmode twiin-pitch.tex
xelatex -interaction=nonstopmode twiin-pitch.tex
echo "Done: $(pwd)/twiin-pitch.pdf"
