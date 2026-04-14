const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

const aiRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: {
    error: "Too many requests, please try again after an hour",
    message:
      "You have exceeded the maximum number of requests per hour. Please try again later.",
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    return req.user?.uid || ipKeyGenerator(req);
  },
});

module.exports = { aiRateLimiter };
