const { GoogleGenerativeAI } = require("@google/genai");
const chalk = require("chalk");

async function generateDeploymentSummary(apiKey, project, framework) {
  if (!apiKey) {
    console.log(
      chalk.yellow("No Google GenAI API key provided. Skipping AI features.")
    );
    return;
  }

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const prompt = `I am deploying a project named "${project}" built with "${framework}" to a staging server. 
    Generate a short, professional deployment success message that I can show to the user. 
    Keep it under 2 sentences.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    console.log(chalk.magenta("\n🤖 AI Deployment Summary:"));
    console.log(chalk.italic(text));
  } catch (error) {
    console.error(chalk.red("Failed to generate AI content:"), error.message);
  }
}

module.exports = {
  generateDeploymentSummary,
};
