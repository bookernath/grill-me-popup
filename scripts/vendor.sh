#!/usr/bin/env sh
# Re-fetches the vendored, pinned browser assets. The popup is served from
# 127.0.0.1 and must work offline, so these are committed rather than loaded
# from a CDN at runtime.
set -eu
cd "$(dirname "$0")/../vendor"

MERMAID=11.17.2
MARKED=15.0.12
DOMPURIFY=3.4.14
CMFONTS=master   # github.com/aaaakshat/cm-web-fonts — CMU (Computer Modern Unicode), SIL OFL 1.1
NEWCM=ctan       # New Computer Modern (GUST Font License) — the Book weight is darker on screen than CMU
JBMONO=5.3.0     # @fontsource/jetbrains-mono — OFL
COURIER=5.3.0    # @fontsource/courier-prime — OFL
ELITE=5.3.0      # @fontsource/special-elite — Apache-2.0
SSERIF=5.3.0     # @fontsource/source-serif-4 — OFL
SSANS=5.3.0      # @fontsource/source-sans-3 — OFL

get() { echo "  $2"; curl -fsSL "$1" -o "$2"; }

get "https://cdn.jsdelivr.net/npm/mermaid@$MERMAID/dist/mermaid.min.js" mermaid.min.js
get "https://cdn.jsdelivr.net/npm/marked@$MARKED/marked.min.js" marked.min.js
get "https://cdn.jsdelivr.net/npm/dompurify@$DOMPURIFY/dist/purify.min.js" purify.min.js

F="https://cdn.jsdelivr.net/gh/aaaakshat/cm-web-fonts@$CMFONTS/font"
for f in cmunrm cmunbx cmunti cmunbi; do get "$F/Serif/$f.woff" "fonts/$f.woff"; done
for f in cmuntt cmuntb cmunit; do get "$F/Typewriter/$f.woff" "fonts/$f.woff"; done
for f in cmunss cmunsx; do get "$F/Sans/$f.woff" "fonts/$f.woff"; done

N="https://mirrors.ctan.org/fonts/newcomputermodern/otf"
for f in NewCM10-Book NewCM10-BookItalic NewCM10-Bold NewCM10-BoldItalic NewCMMono10-Book; do get "$N/$f.otf" "fonts/$f.otf"; done

FS="https://cdn.jsdelivr.net/npm/@fontsource"
for f in 400-normal 700-normal 400-italic 700-italic; do get "$FS/jetbrains-mono@$JBMONO/files/jetbrains-mono-latin-$f.woff2" "fonts/jetbrains-mono-$f.woff2"; done
for f in 400-normal 700-normal 400-italic; do get "$FS/courier-prime@$COURIER/files/courier-prime-latin-$f.woff2" "fonts/courier-prime-$f.woff2"; done
get "$FS/special-elite@$ELITE/files/special-elite-latin-400-normal.woff2" fonts/special-elite-400-normal.woff2
for f in 400-normal 700-normal 400-italic 700-italic; do get "$FS/source-serif-4@$SSERIF/files/source-serif-4-latin-$f.woff2" "fonts/source-serif-4-$f.woff2"; done
for f in 400-normal 600-normal 700-normal 400-italic; do get "$FS/source-sans-3@$SSANS/files/source-sans-3-latin-$f.woff2" "fonts/source-sans-3-$f.woff2"; done

cat > VERSIONS <<V
mermaid $MERMAID
marked $MARKED
dompurify $DOMPURIFY
cm-web-fonts $CMFONTS ($(date -u +%F))
newcomputermodern $NEWCM ($(date -u +%F))
jetbrains-mono $JBMONO
courier-prime $COURIER
special-elite $ELITE
source-serif-4 $SSERIF
source-sans-3 $SSANS
V
echo done
