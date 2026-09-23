#!/usr/bin/env bash
set -euo pipefail

# Fetch Tesseract artifacts into public/vendor/tesseract
mkdir -p public/vendor/tesseract/lang

# Versions pinned to tested releases
WORKER_URL="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/worker.min.js"
CORE_URL="https://cdn.jsdelivr.net/npm/tesseract.js-core@2.1.0/tesseract-core.wasm.js"
LANG_URL="https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/lang/por.traineddata"

curl -L -o public/vendor/tesseract/worker.min.js "$WORKER_URL"
curl -L -o public/vendor/tesseract/tesseract-core.wasm.js "$CORE_URL"
curl -L -o public/vendor/tesseract/lang/por.traineddata "$LANG_URL"

ls -lh public/vendor/tesseract
ls -lh public/vendor/tesseract/lang
