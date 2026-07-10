const { randomUUID } = require("crypto");

function createCorrelationId(prefix = "sync") {
  return `${prefix}-${randomUUID()}`;
}

module.exports = { createCorrelationId };
