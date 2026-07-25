/**
 * Minimal format-message setup for Stretch3 extensions outside Scratch GUI.
 * Extensions call formatMessage({id, default, description}) and expect a string.
 */
const formatMessage = require("format-message");

try {
  formatMessage.setup({
    locale: "ja",
    missingTranslation: "ignore",
  });
} catch {
  // setup may already have run
}

module.exports = formatMessage;
