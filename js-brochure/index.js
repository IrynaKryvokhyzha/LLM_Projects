// index.js - Main application file

// Import required libraries
const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const OpenAI = require("openai");
const Anthropic = require("@anthropic-ai/sdk");
const dotenv = require("dotenv");
const path = require("path");
const activeConnections = {};

// Load environment variables
dotenv.config();

// Initialize Express app
const app = express();
app.use(express.json());
app.use(express.static("public"));

// Initialize API clients
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Log API key information for debugging
if (process.env.OPENAI_API_KEY) {
  console.log(
    `OpenAI API Key exists and begins ${process.env.OPENAI_API_KEY.substring(
      0,
      8
    )}`
  );
} else {
  console.log("OpenAI API Key not set");
}

if (process.env.ANTHROPIC_API_KEY) {
  console.log(
    `Anthropic API Key exists and begins ${process.env.ANTHROPIC_API_KEY.substring(
      0,
      7
    )}`
  );
} else {
  console.log("Anthropic API Key not set");
}

if (process.env.GOOGLE_API_KEY) {
  console.log(
    `Google API Key exists and begins ${process.env.GOOGLE_API_KEY.substring(
      0,
      8
    )}`
  );
} else {
  console.log("Google API Key not set");
}

// Website class equivalent
class Website {
  constructor(url) {
    this.url = url;
  }

  async fetchContents() {
    try {
      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.0.0 Safari/537.36",
      };

      const response = await axios.get(this.url, { headers });
      const $ = cheerio.load(response.data);

      this.title = $("title").text() || "No title found";

      // Remove irrelevant elements
      $("script, style, img, input").remove();

      this.text = $("body").text().trim().replace(/\s+/g, "\n");

      return this.getContents();
    } catch (error) {
      console.error(`Error fetching website: ${error.message}`);
      return `Error fetching website: ${error.message}`;
    }
  }

  getContents() {
    return `Webpage Title:\n${this.title}\nWebpage Contents:\n${this.text}\n\n`;
  }
}

// System prompt for AI
const systemPrompt =
  "You are an assistant that analyzes the contents of several relevant pages from a company website " +
  "and creates a short brochure about the company for prospective customers, investors and recruits. Respond in markdown." +
  "Include details of company culture, customers and careers/jobs if you have the information.";

// Stream GPT response
async function* streamGPT(prompt) {
  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: prompt },
  ];

  const stream = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: messages,
    stream: true,
  });

  for await (const chunk of stream) {
    yield chunk.choices[0]?.delta?.content || "";
  }
}

// Stream Claude response
async function* streamClaude(prompt) {
  const stream = await claude.messages.stream({
    model: "claude-3-haiku-20240307",
    max_tokens: 1000,
    temperature: 0.7,
    system: systemPrompt,
    messages: [{ role: "user", content: prompt }],
  });

  for await (const chunk of stream.text_stream) {
    yield chunk || "";
  }
}
app.all("/generate-brochure", async (req, res) => {
  // Check if this is an SSE connection request (GET)
  if (req.method === "GET") {
    // Set headers for SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // Store connection for later use
    const connectionId = Date.now().toString();
    activeConnections[connectionId] = res;

    // Send connection ID to client
    res.write(`data: ${JSON.stringify({ connectionId })}\n\n`);

    // Handle client disconnect
    req.on("close", () => {
      delete activeConnections[connectionId];
    });
    return;
  }

  // Handle the POST request
  if (req.method === "POST") {
    try {
      const { companyName, url, model, connectionId } = req.body;

      if (
        !companyName ||
        !url ||
        !connectionId ||
        !activeConnections[connectionId]
      ) {
        return res.status(400).json({ error: "Invalid request parameters" });
      }

      const clientConnection = activeConnections[connectionId];

      // Create website instance and fetch contents
      const website = new Website(url);
      const websiteContents = await website.fetchContents();

      // Prepare prompt
      const prompt =
        `You are looking at a company called: ${companyName}\n` +
        `Here are the contents of its landing page and other relevant pages; use this information to build a short brochure of the company in markdown.\n` +
        websiteContents;

      // Stream response based on selected model
      if (model === "GPT") {
        try {
          for await (const chunk of streamGPT(prompt)) {
            clientConnection.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        } catch (error) {
          clientConnection.write(
            `data: ${JSON.stringify({ error: error.message })}\n\n`
          );
        }
      } else if (model === "Claude") {
        try {
          for await (const chunk of streamClaude(prompt)) {
            clientConnection.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          }
        } catch (error) {
          clientConnection.write(
            `data: ${JSON.stringify({ error: error.message })}\n\n`
          );
        }
      } else {
        clientConnection.write(
          `data: ${JSON.stringify({ error: "Unknown model" })}\n\n`
        );
      }

      // Send completion message
      clientConnection.write(`data: ${JSON.stringify({ done: true })}\n\n`);

      res.status(200).json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
