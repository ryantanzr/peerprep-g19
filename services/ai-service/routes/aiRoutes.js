const express = require("express");
const router = express.Router();
const { authenticateToken } = require("../middleware/auth");
const { aiRateLimiter } = require("../middleware/rateLimiter");
const { explainQuestion } = require("../controller/aiController");

router.post("/explain", authenticateToken, aiRateLimiter, explainQuestion);

module.exports = router;
