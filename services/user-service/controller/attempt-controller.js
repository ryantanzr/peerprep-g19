import {
  createQuestionAttempt,
  findUserById,
  getQuestionAttemptSummaryByUser,
  listQuestionAttemptsByUser,
} from "../model/firebase-repository.js";

/**
 * Allowed question difficulty levels
 * Matches exactly with difficulty values defined in Question Service
 */
const VALID_DIFFICULTIES = ["Easy", "Medium", "Hard"];

/**
 * Question attempt status enumeration
 *
 * attempted - User started the question but did not submit solution
 * solved - User successfully solved the question
 * abandoned - User left the session without completing the question
 */
const VALID_ATTEMPT_STATUSES = ["attempted", "solved", "abandoned"];

/**
 * Pagination limit normalizer
 *
 * Enforces sane bounds for list endpoints:
 * - Default: 20 items
 * - Minimum: 1 item
 * - Maximum: 100 items (prevents expensive large queries)
 *
 * @param {string|number} limitParam Raw limit parameter from request query
 * @returns {number} Normalized safe limit value
 */
function normalizeLimit(limitParam) {
  const parsed = Number.parseInt(limitParam, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return 20;
  return Math.min(parsed, 100);
}

/**
 * Record Question Attempt
 *
 * Logs that a user has attempted a coding question.
 * Called automatically when a user completes or leaves a collaboration session.
 *
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 *              Users can only record attempts for their own account
 *
 * @param {Request} req Express request object with user id parameter
 * @param {Response} res Express response object
 */
export async function createAttempt(req, res) {
  try {
    const userId = req.params.id;
    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    const {
      questionId,
      questionTitle,
      topic,
      difficulty,
      status,
      durationSeconds,
      language,
      sessionId,
    } = req.body || {};

    // Required fields validation
    if (!questionTitle || !topic || !difficulty) {
      return res.status(400).json({
        message: "questionTitle, topic, and difficulty are required",
      });
    }

    // Validate difficulty against allowed values
    if (!VALID_DIFFICULTIES.includes(difficulty)) {
      return res.status(400).json({ message: "Invalid difficulty" });
    }

    // Validate status if provided
    if (status && !VALID_ATTEMPT_STATUSES.includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    // Validate duration is positive integer if provided
    if (
      durationSeconds !== undefined &&
      (!Number.isFinite(durationSeconds) || durationSeconds < 0)
    ) {
      return res.status(400).json({ message: "Invalid durationSeconds" });
    }

    const createdAttempt = await createQuestionAttempt(userId, {
      questionId,
      questionTitle,
      topic,
      difficulty,
      status,
      durationSeconds,
      language,
      sessionId,
    });

    return res.status(201).json({
      message: "Question attempt recorded",
      data: createdAttempt,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Unknown error when recording question attempt!",
    });
  }
}

/**
 * Get Paginated Attempt History
 *
 * Returns cursor based paginated list of all question attempts for a user.
 * Supports filtering by topic, difficulty, and status.
 *
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 *
 * Query Parameters:
 * - limit: Maximum number of results per page (default 20, max 100)
 * - cursor: Pagination cursor from previous response
 * - topic: Filter by question topic
 * - difficulty: Filter by question difficulty
 * - status: Filter by attempt status
 *
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function getAttemptHistory(req, res) {
  try {
    const userId = req.params.id;
    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    const limit = normalizeLimit(req.query.limit);
    const options = {
      limit,
      startAfter: req.query.cursor,
      topic: req.query.topic,
      difficulty: req.query.difficulty,
      status: req.query.status,
    };

    const { attempts, nextCursor } = await listQuestionAttemptsByUser(
      userId,
      options,
    );

    return res.status(200).json({
      message: "Found question attempts",
      data: attempts,
      pagination: {
        limit,
        nextCursor,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Unknown error when getting question attempt history!",
    });
  }
}

/**
 * Get Attempt Summary Statistics
 *
 * Returns aggregated statistics about a user's question attempts:
 * - Total attempts by difficulty
 * - Solved count by difficulty
 * - Success rate metrics
 * - Topic distribution
 *
 * This is a pre-aggregated view optimized for fast query performance.
 *
 * PERMISSIONS: Requires verifyIsOwnerOrAdmin middleware
 *
 * @param {Request} req Express request object
 * @param {Response} res Express response object
 */
export async function getAttemptSummary(req, res) {
  try {
    const userId = req.params.id;
    const user = await findUserById(userId);

    if (!user) {
      return res.status(404).json({ message: `User ${userId} not found` });
    }

    const summary = await getQuestionAttemptSummaryByUser(userId);

    return res.status(200).json({
      message: "Found question attempt summary",
      data: summary,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({
      message: "Unknown error when getting question attempt summary!",
    });
  }
}