/**
 * Lightweight, Foundry-agnostic portrait helpers for the Hall of Fame.
 * Artwork overrides never modify Actor/Token documents or damage records.
 */
export function portraitKey(actorId, actorName) {
  const id = String(actorId ?? "").trim();
  if (id) return "id:" + id;
  const name = String(actorName ?? "").trim().toLocaleLowerCase();
  return name ? "name:" + name : "";
}

export function bestPortrait({override, activeToken, placedToken, prototypeToken, actorImage} = {}) {
  const images = [override, activeToken, placedToken, prototypeToken, actorImage];
  for (const candidate of images) {
    if (typeof candidate !== "string") continue;
    const value = candidate.trim();
    if (value && value !== "icons/svg/mystery-man.svg") return value;
  }
  return "";
}
