require("dotenv").config();
const express = require("express");
const cors = require("cors");
const aiRoutes = require("./routes/aiRoutes");

const app = express();
const PORT = process.env.PORT || 5050;

app.use(cors());
app.use(express.json());
app.use("/api/ai", aiRoutes);

app.get("/health", (_req, res) => {
	res.status(200).json({ status: "ok" });
});

app.listen(PORT, () => {
	console.log(`AI service running on port ${PORT}`);
});
