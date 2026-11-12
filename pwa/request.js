export function requestTimeoutSignal(ms = 15000) {
  if (typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);

  const controller = new AbortController();
  setTimeout(() => controller.abort(), ms);
  return controller.signal;
}
