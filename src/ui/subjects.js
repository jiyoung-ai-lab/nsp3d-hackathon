// NSP 3D — experiment-subject registry (dependency-free: panel + tests read this).
//
// ADD a subject: (1) append one line below, (2) add its nameKey to i18n ko/en,
//   (3) procedural kinds need no other work; a new kind needs a factory branch
//   in app.js getSubjectRoot/getPreviewRoot. REMOVE a subject: delete its line
//   (panel options are built from this list; the loader validates ids).
// kind 'procedural': sync factory (THREE, opts) -> root Group (hand-built geometry).
//   factory 'bee' (default) -> createBee; 'pumpkin' -> createPumpkin;
//   'cutefly' -> createCuteFly (see app.js branches).
// kind 'glb': async factory (THREE, loader, opts) -> root Group; asset is page-relative.
// previewDist (optional): preview-camera distance in meters; default fits ~9mm subjects.
// bodyTint/depthDefault (optional): per-subject color defaults applied at swap,
// overriding the bee-tuned panel values (orange tint would recolor pastel textures).
export const SUBJECTS = [
  { id: 'custom', nameKey: 'beeSubjectCustom', kind: 'procedural', factory: 'bee' },
  // honeybee2 hidden from the panel list (code + asset kept; re-add line to restore).
  { id: 'pumpkin', nameKey: 'beeSubjectPumpkin', kind: 'procedural', factory: 'pumpkin' },
  { id: 'cutefly', nameKey: 'beeSubjectCuteFly', kind: 'procedural', factory: 'cutefly', bodyTint: '#ffffff', depthDefault: 0.85 },
];
export const DEFAULT_SUBJECT_ID = 'custom';
export function getSubject(id) {
  return SUBJECTS.find((s) => s.id === id) || null;
}
