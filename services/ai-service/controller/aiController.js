const axios = require("axios");
const aiService = require("../services/aiService");

const QUESTION_SERVICE_URL =
  process.env.QUESTION_SERVICE_URL || "http://localhost:8000";
const QUESTION_FETCH_TIMEOUT_MS = Number(
  process.env.QUESTION_FETCH_TIMEOUT_MS || 5000,
);
const MAX_CODE_CHARS = Number(process.env.MAX_CODE_CHARS || 20000);

function pickQuestionTitle(body) {
  return body.questionTitle || body.questionId || body.questionid || null;
}

const explainQuestion = async (req, res) => {
  try {
    const { code, language, focus } = req.body;
    const questionTitle = pickQuestionTitle(req.body);

    if (!questionTitle || !code) {
      return res
        .status(400)
        .json({
          message:
            "questionTitle (or questionId/questionid) and code are required",
        });
    }

    if (typeof code !== "string" || !code.trim()) {
      return res.status(400).json({ message: "code must be a non-empty string" });
    }

    if (code.length > MAX_CODE_CHARS) {
      return res.status(413).json({
        message: `code exceeds maximum length of ${MAX_CODE_CHARS} characters`,
      });
    }

    const question = await axios.get(
      `${QUESTION_SERVICE_URL}/questions/${encodeURIComponent(questionTitle)}`,
      { timeout: QUESTION_FETCH_TIMEOUT_MS },
    );
    if (!question || !question.data) {
      return res.status(404).json({ message: "Question not found" });
    }

    const explanation = await aiService.explainQuestion(question.data, code, {
      language,
      focus,
    });

    return res.status(200).json({
      questionTitle,
      explanation,
    });
  } catch (error) {
    if (error.response && error.response.status === 404) {
      return res.status(404).json({
        message: "Question not found in question service",
      });
    }

    if (error.response) {
      return res.status(502).json({
        message: "Failed to fetch question from question service",
        detail: error.response.data,
      });
    }

    if (error.code === "ECONNABORTED") {
      return res.status(504).json({
        message: "Question service request timed out",
      });
    }

    return res.status(500).json({
      message: "Failed to explain question",
      detail: error.message,
    });
  }
};

module.exports = { explainQuestion };