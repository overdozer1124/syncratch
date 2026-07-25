/** Lightweight replacement for scratch-vm util/log (avoids tslog). */
module.exports = {
  info: (...args) => console.info("[scratch-vm]", ...args),
  warn: (...args) => console.warn("[scratch-vm]", ...args),
  error: (...args) => console.error("[scratch-vm]", ...args),
  debug: (...args) => console.debug("[scratch-vm]", ...args),
  silly: () => {},
  trace: (...args) => console.trace("[scratch-vm]", ...args),
};
