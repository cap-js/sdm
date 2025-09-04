const { context, getOctokit } = require("@actions/github");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Utility function to safely parse an environment variable as a number
function safeParseInt(envVar, defaultValue) {
  const value = parseInt(envVar);
  return !isNaN(value) && value > 0 ? value : defaultValue;
}

// Fetch and validate environment variables with default values
const MAX_RETRIES = safeParseInt(process.env.MAX_RETRIES, 5);
const INITIAL_DELAY_MS = safeParseInt(process.env.INITIAL_DELAY_MS, 1000);
const MAX_CHUNK_TOKENS = safeParseInt(process.env.MAX_CHUNK_TOKENS, 10000);

async function fetchWithBackoff(func, maxRetries = MAX_RETRIES, initialDelay = INITIAL_DELAY_MS) {
  let retries = 0;
  let delay = initialDelay;

  while (retries < maxRetries) {
    try {
      return await func();
    } catch (error) {
      const retryableErrors = [429, 500, 503, 504];
      if (retryableErrors.includes(error.status)) {
        console.warn(`Transient error (${error.status}) encountered. Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2;
        retries++;
      } else {
        // Log the full error object for non-retryable errors
        console.error("Non-retryable error encountered. Aborting fetchWithBackoff. Details:", error);
        throw error;
      }
    }
  }

  // Throw an error if max retries are exceeded
  const error = new Error(`Max retries (${maxRetries}) exceeded.`);
  error.status = 504; // Set a gateway timeout status for consistency
  throw error;
}

async function getDiff(octokit, owner, repo, pull_number) {
  console.log(`Fetching diff for PR #${pull_number}`);
  const { data: pullRequest } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number,
    mediaType: { format: "diff" },
  });
  return pullRequest;
}

// Function to split the diff into chunks based on token count
async function splitDiffIntoTokens(genAI, diff, maxTokens = MAX_CHUNK_TOKENS) {
  if (!diff || diff.length === 0) {
    return [];
  }
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const lines = diff.split('\n');
  const chunks = [];
  let currentChunk = '';

  for (const line of lines) {
    const tempChunk = currentChunk + line + '\n';
    try {
      const tokenCount = (await model.countTokens(tempChunk)).totalTokens;
      if (tokenCount < maxTokens) {
        currentChunk = tempChunk;
      } else {
        chunks.push(currentChunk);
        currentChunk = line + '\n';
      }
    } catch (error) {
      console.error("Error counting tokens. Skipping chunking for this line. Details:", error);
      chunks.push(currentChunk);
      currentChunk = line + '\n';
    }
  }
  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }
  return chunks;
}

async function performPRReview(octokit, diffContent, pull_number, genAI) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

  const chunks = await splitDiffIntoTokens(genAI, diffContent);
  const chunkReviews = [];

  if (chunks.length === 0) {
    console.log("No diff content to review.");
    return;
  }

  console.log(`Splitting diff into ${chunks.length} chunks for processing...`);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkPrompt = `You are a helpful and expert AI code reviewer named Gemini. Analyze the following Git diff chunk and provide a concise review of its contents. Do not provide a final summary. Focus on a summary of changes, best practices, potential bugs, and recommendations for this specific chunk. Do not recommend adding comments to explain the purpose of code elements.

    Git Diff Chunk:
    \`\`\`diff
    ${chunk}
    \`\`\`
    `;

    try {
      const result = await fetchWithBackoff(() => model.generateContent(chunkPrompt));
      chunkReviews.push(result.response.text());
      console.log(`Review for chunk ${i + 1} of ${chunks.length} generated.`);
    } catch (error) {
      console.error(`Error processing chunk ${i + 1}. Details:`, error);
      chunkReviews.push(`Error: Could not generate review for this chunk due to: ${error.message}`);
    }
  }

  // Now, synthesize the reviews into a single final review
  const synthesisPrompt = `You are a helpful and expert AI code reviewer named Gemini. Synthesize the following partial code reviews into a single, cohesive, and comprehensive final review. Your review must strictly follow this exact markdown format and content:

  ######
  **Gemini Automated Review**
  **Summary of Changes**
  [A brief, high-level summary of all the commits.]
  **Best Practices Review**
  [A concise, bulleted list of all best practices violations. Be specific and include issues like Inconsistent Formatting, Redundant Dependency, Unused Property, Redundant Exclusion, Version Mismatch, and Missing Version in dependency.]
  **Potential Bugs**
  [A concise, bulleted list of all potential bugs or errors. Reference specific issues found.]
  **Recommendations**
  [A prioritized, bulleted list of all actionable recommendations for improving the code. For the most critical recommendations, provide a code snippet showing the improved version.]
  **Quality Rating**
  [A rating out of 10 that reflects the overall quality of the code.]
  **Overall**
  [A brief overall assessment of the code quality and readiness for merge.]
  ######
  
  Partial Reviews to Synthesize:
  ${chunkReviews.join('\n\n---\n\n')}
  `;
  
  let reviewBody = "Review generation failed.";
  try {
    const finalReviewResult = await fetchWithBackoff(() => model.generateContent(synthesisPrompt));
    reviewBody = finalReviewResult.response.text();
    console.log("Gemini's final review generated successfully.");
  } catch (error) {
    console.error(`Error synthesizing final review. Details:`, error);
    reviewBody = `An error occurred while generating the final review. Partial reviews are below:\n\n${chunkReviews.join('\n\n---\n\n')}`;
  }

  await octokit.rest.issues.createComment({
    owner: context.repo.owner,
    repo: context.repo.repo,
    issue_number: pull_number,
    body: reviewBody,
  });
  console.log("Gemini's final review posted successfully.");
}

async function handleCommentResponse(octokit, commentBody, pull_number, genAI) {
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
  const userQuestion = commentBody.replace("Hey Gemini,", "").trim();

  const diffContent = await getDiff(octokit, context.repo.owner, context.repo.repo, pull_number);

  const prompt = `A user has a question about a pull request. The pull request diff is below, followed by the user's question. Please provide a clear and concise answer.

  ---
  Git Diff:
  \`\`\`diff
  ${diffContent}
  \`\`\`

  ---
  User's question:
  ${userQuestion}
  `;

  let response = "Error: Could not generate a response to your comment.";
  try {
    const result = await fetchWithBackoff(() => model.generateContent(prompt));
    response = result.response.text();
    console.log("Gemini's response generated successfully.");
  } catch (error) {
    console.error(`Error generating response to comment. Details:`, error);
  }

  if (response) {
    await octokit.rest.issues.createComment({
      owner: context.repo.owner,
      repo: context.repo.repo,
      issue_number: pull_number,
      body: `## Gemini's Response\n\n${response}`
    });
    console.log("Gemini's response posted successfully.");
  }
}

async function run() {
  try {
    const octokit = getOctokit(process.env.GITHUB_TOKEN);
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    
    const { owner, repo } = context.repo;
    const pull_number = context.payload.pull_request ? context.payload.pull_request.number : context.payload.issue.number;

    if (context.eventName === 'pull_request') {
      const diffContent = await getDiff(octokit, owner, repo, pull_number);
      await performPRReview(octokit, diffContent, pull_number, genAI);
    } else if (context.eventName === 'issue_comment') {
      const commentBody = context.payload.comment.body;
      if (commentBody.startsWith("Hey Gemini,")) {
        await handleCommentResponse(octokit, commentBody, pull_number, genAI);
      }
    }
  } catch (error) {
    console.error(`An error occurred: ${error.message}`);
    throw error;
  }
}

run();
