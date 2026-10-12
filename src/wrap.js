// Wraps an async Express handler so rejections reach the error middleware.
// Express 4 does not catch rejected promises on its own; without this, a
// failed query would leave the request hanging instead of returning a 500.
module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
