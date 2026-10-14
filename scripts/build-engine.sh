#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v em++ >/dev/null
command -v bsdtar >/dev/null
# Reuse unchanged object files across rebuilds when ccache is available.
if command -v ccache >/dev/null; then export EM_COMPILER_WRAPPER=ccache; fi
read_manifest() { bun -e "import m from './engine/manifest.json' with {type:'json'}; console.log(m[process.argv[1]])" "$1"; }
commit=$(read_manifest commit)
mkdir -p .cache public/engine public/source
if [ ! -d .cache/YaneuraOu/.git ]; then
  git init .cache/YaneuraOu
  git -C .cache/YaneuraOu remote add origin "$(read_manifest repository)"
fi
git -C .cache/YaneuraOu fetch --depth 1 origin "$commit"
git -C .cache/YaneuraOu checkout --force --detach "$commit"
git -C .cache/YaneuraOu apply ../../engine/browser.patch
curl -fL --retry 3 "$(read_manifest evaluation)" -o .cache/evaluation.7z
bun -e '
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import manifest from "./engine/manifest.json" with {type:"json"};
if (createHash("sha256").update(readFileSync(".cache/evaluation.7z")).digest("hex") !== manifest.archiveSha256) throw Error("Evaluation checksum mismatch");'
bsdtar -xf .cache/evaluation.7z -C public/engine nn.bin progress.bin eval_options.txt tag.json
make -C .cache/YaneuraOu/source clean COMPILER=em++ TARGET_CPU=WASM YANEURAOU_EDITION=YANEURAOU_ENGINE_SFNN_ka2_2048_8_64_progress8
make -C .cache/YaneuraOu/source -j"$(getconf _NPROCESSORS_ONLN)" normal COMPILER=em++ TARGET_CPU=WASM \
  YANEURAOU_EDITION=YANEURAOU_ENGINE_SFNN_ka2_2048_8_64_progress8 \
  TARGET=../../../public/engine/yaneuraou.js EM_EXPORT_NAME=YaneuraOu \
  EM_INITIAL_MEMORY_SIZE=100663296 PYTHON=python3
# Serve the exact corresponding source alongside the GPL binary.
git -C .cache/YaneuraOu archive "$commit" | gzip -n > public/source/yaneuraou.tar.gz
cp engine/browser.patch engine/manifest.json scripts/build-engine.sh public/source/
cp .cache/YaneuraOu/LICENSE public/source/GPL-3.0.txt
