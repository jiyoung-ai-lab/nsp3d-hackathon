// NSP 3D — shared recording helpers (pure: browser + node, zero dependencies).
// Filename carries the recording source + local datetime; duration is capped
// because MediaRecorder chunks accumulate in RAM (~bitrate x seconds).
export const REC_MAX_S = 180;
const p2 = (n) => String(n).padStart(2, '0');
export function recStamp(d = new Date()) {
  return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}_${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}
export function recFilename(page, source, d = new Date()) {
  const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]+/g, '_');
  return `nsp3d_${safe(page)}_${safe(source)}_${recStamp(d)}.webm`;
}
export function recElapsed(startMs, nowMs = Date.now()) {
  const s = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  return `${Math.floor(s / 60)}:${p2(s % 60)}`;
}
export function recCapped(startMs, nowMs = Date.now()) {
  return nowMs - startMs >= REC_MAX_S * 1000;
}
