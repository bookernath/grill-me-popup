# Vendored assets

Everything in this directory is served to the popup from `127.0.0.1` so the UI works offline and never loads from a CDN at runtime. Re-fetch with `npm run vendor` (pinned versions live in `scripts/vendor.sh`; what is currently checked in is recorded in `VERSIONS`).

| Asset | Source | License |
|---|---|---|
| `marked.min.js` | [markedjs/marked](https://github.com/markedjs/marked) | MIT |
| `purify.min.js` | [cure53/DOMPurify](https://github.com/cure53/DOMPurify) | Apache-2.0 / MPL-2.0 |
| `mermaid.min.js` | [mermaid-js/mermaid](https://github.com/mermaid-js/mermaid) | MIT |
| `fonts/cmun*.woff` | [CMU — Computer Modern Unicode](https://cm-unicode.sourceforge.io/) via [aaaakshat/cm-web-fonts](https://github.com/aaaakshat/cm-web-fonts) | SIL Open Font License 1.1 |
| `fonts/NewCM*.otf` | [New Computer Modern](https://ctan.org/pkg/newcomputermodern) (CTAN) | GUST Font License |
| `fonts/source-serif-4-*`, `fonts/source-sans-3-*` | Adobe, via [Fontsource](https://fontsource.org) | SIL OFL 1.1 |
| `fonts/courier-prime-*` | Quote-Unquote Apps, via Fontsource | SIL OFL 1.1 |
| `fonts/special-elite-*` | Astigmatic, via Fontsource | Apache-2.0 |
| `fonts/jetbrains-mono-*` | [JetBrains](https://www.jetbrains.com/lp/mono/), via Fontsource | SIL OFL 1.1 |
