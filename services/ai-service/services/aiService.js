const { GoogleGenerativeAI } = require("@google/generative-ai");

class AIService {
  constructor() {
    this.apiKey = process.env.GOOGLE_GEMINI_API_KEY;
    this.model = process.env.GOOGLE_GEMINI_MODEL || "gemini-1.5-flash";
    this.temperature = Number(process.env.GOOGLE_GEMINI_TEMPERATURE || 0.2);
    this.maxTokens = Number(process.env.GOOGLE_GEMINI_MAX_TOKENS || 700);
    this.client = this.apiKey ? new GoogleGenerativeAI(this.apiKey) : null;
  }

  normalizeQuestion(question) {
    if (!question) return {};
    return question.data ? question.data : question;
  }

  sanitizeCode(userCode) {
    if (typeof userCode !== "string") return "";
    return userCode.trim();
  }

  buildPrompt(question, userCode, language = "unknown", focus = "general") {
    const q = this.normalizeQuestion(question);

    const promptPayload = {
      question: {
        title: q.title || "",
        description: q.description || "",
        topics: Array.isArray(q.topics) ? q.topics : [],
        difficulty: q.difficulty || "",
        hints: Array.isArray(q.hints) ? q.hints : [],
      },
      submission: {
        language,
        focus,
        code: this.sanitizeCode(userCode),
      },
      output_format: {
        summary: "Short plain-English explanation of approach (2-4 lines).",
        stepByStep: [
          "Ordered explanation of major blocks/logic decisions.",
        ],
        keyConcepts: ["Data structures, algorithmic concepts, syntax ideas."],
        potentialIssues: [
          "Possible bugs, edge cases, or performance concerns if any.",
        ],
        confidence: "low|medium|high",
      },
    };

    return [
      {
        role: "system",
        content:
          "You explain peer code to students in clear, supportive language. " +
          "Be concise, concrete, and avoid hallucinations. If information is missing, say so.",
      },
      {
        role: "user",
        content:
          "Analyze the following programming question context and peer code. " +
          "Return ONLY valid JSON with keys: summary, stepByStep, keyConcepts, potentialIssues, confidence.\n\n" +
          JSON.stringify(promptPayload, null, 2),
      },
    ];
  }

  stripCodeFence(text) {
    if (!text) return "";
    return text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();
  }

  parseModelResponse(rawText) {
    const cleaned = this.stripCodeFence(rawText);
    try {
      const parsed = JSON.parse(cleaned);
      return {
        summary: parsed.summary || "No summary provided.",
        stepByStep: Array.isArray(parsed.stepByStep) ? parsed.stepByStep : [],
        keyConcepts: Array.isArray(parsed.keyConcepts) ? parsed.keyConcepts : [],
        potentialIssues: Array.isArray(parsed.potentialIssues)
          ? parsed.potentialIssues
          : [],
        confidence: parsed.confidence === "high" ? 0.9 : parsed.confidence === "medium" ? 0.6 : 0.3,
      };
    } catch (_err) {
      return {
        summary: cleaned || "Unable to generate explanation.",
        stepByStep: [],
        keyConcepts: [],
        potentialIssues: [],
        confidence: 0.3,
      };
    }
  }

  async explainQuestion(question, userCode, options = {}) {
    if (!this.client) {
      throw new Error(
        "GOOGLE_GEMINI_API_KEY is not configured for ai-service. Set it in environment variables.",
      );
    }

    const language = options.language || "unknown";
    const focus = options.focus || "general";
    const messages = this.buildPrompt(question, userCode, language, focus);

    const systemMessage = messages.find((m) => m.role === "system");
    const userMessage = messages.find((m) => m.role === "user");

    const model = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: systemMessage ? { parts: [{ text: systemMessage.content }] } : undefined,
    });

    const response = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: userMessage.content }] }],
      generationConfig: {
        temperature: this.temperature,
        maxOutputTokens: this.maxTokens,
      },
    });

    const rawText = response?.response?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return this.parseModelResponse(rawText);
  }
}

module.exports = new AIService();
