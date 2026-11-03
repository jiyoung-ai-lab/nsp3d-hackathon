# Citation Policy — NSP_3D

When citing (referencing, copying, porting, loading) external papers, datasets,
git repos, or code, always state the citation scope and source. Covers: papers,
preprints, datasets, open-source repos and snippets, CDN libraries, and own
pre-existing creations.

## 1. Required record fields

| Field | Content | Example |
|---|---|---|
| Source | Title/authors/URL | Male CNS v1.0, FlyEM, https://male-cns.janelia.org/download/ |
| Pinned version | Version/commit/date | three@0.160.0, male-cns:v1.0 |
| License | SPDX / full-text location | CC BY 4.0, MIT |
| Citation scope | What was taken | "130-node subset", "Module A/B logic", "CSS layout" |
| Applied at | Our file | `../src/vision/camera-vision.js` L1-40 |
| Changed? | As-is / modified | "gain keys renamed to upper/lower" |
| Attribution text | Verbatim when required | "FlyEM Project Team, Male CNS Connectome, v1.0" |

## 2. Record locations

1. `THIRD_PARTY_NOTICES.md` — data/asset/library sources + licenses
2. `CITATIONS.md` — paper/document source list
3. Applied file's top comment — `// adapted from <source> (<scope>)`, one line
4. `CITATIONS.md` registry (#1–#51 + §9 #54–#58) — update when scope changes (registry lives only in CITATIONS.md)

## 3. Rules

- Citations without a pinned version (or commit) are banned. CDN pins are mandatory.
- License-unverified citations are marked `unverified` and held from use.
- Propagate the source's limits and disclaimers (e.g. `synapse_sign_inferred: false`).
- Mark own pre-existing creations as pre-existing (separate from new contributions).
- When citing measured values/numbers, record the source location (page/section/cell) too.

## 4. Citation registry

The registry lives only in `CITATIONS.md` §2 + §9 (unified registry #1–#51 + §9 #54–#58). No separate registry copy in this doc.
