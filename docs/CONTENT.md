# Content
Fighter: a folder or zip containing `.def` with sprites (.sff v1/v2), `.air`, `.cmd`, `.cns`, `.snd`, `.act`.
Stage: `.def` with a `[BG ...]` section (3D stages are not supported and are not listed).
Manifest entries are `{"def": "path"}` or `{"zip": "path"}`; `tools/make-zips.js` and `tools/make-manifest.js` build them.
`assets/packs.js` is a generated fallback so `file://` works without fetch.
