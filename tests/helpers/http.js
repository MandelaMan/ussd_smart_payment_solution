/**
 * Lightweight Express-style harness for webhook/controller unit tests
 * without starting the HTTP server.
 */
function mockRes() {
  const state = { statusCode: 200, body: null, headers: {} };
  const res = {
    status(code) {
      state.statusCode = code;
      return res;
    },
    json(payload) {
      state.body = payload;
      return res;
    },
    setHeader(k, v) {
      state.headers[k] = v;
    },
  };
  return { res, state };
}

module.exports = { mockRes };
