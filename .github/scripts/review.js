const { context, getOctokit } = require("@actions/github");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Utility functions
//----------------------------------------------------------------------------------------------------------------
function safeParseInt(envVar, defaultValue) {
    const value = parseInt(envVar);
    return !isNaN(value) && value > 0 ? value : defaultValue;
}

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
                console.error("Non-retryable error encountered. Aborting fetchWithBackoff. Details:", error);
                throw error;
            }
        }
    }

    const error = new Error(`Max retries (${maxRetries}) exceeded.`);
    error.status = 504;
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

// Core logic functions
//----------------------------------------------------------------------------------------------------------------

async function updateReadme(octokit, owner, repo, aiGeneratedContent, pull_number) {
    const readmePath = "README.md";
    let readmeSha;
    
    console.log("Attempting to read existing README.md...");
    try {
        const { data } = await octokit.rest.repos.getContents({
            owner,
            repo,
            path: readmePath,
            ref: context.payload.pull_request.head.ref,
        });
        readmeSha = data.sha;
        console.log("README.md file found. Its SHA is:", readmeSha);
    } catch (error) {
        if (error.status === 404) {
            console.warn("README.md not found. Will create a new one.");
            readmeSha = null;
        } else {
            console.error("Error fetching README.md:", error);
            throw error;
        }
    }

    try {
        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: readmePath,
            message: `chore(readme): Update README with changes from PR #${pull_number}`,
            content: Buffer.from(aiGeneratedContent).toString('base64'),
            sha: readmeSha,
            branch: context.payload.pull_request.head.ref,
        });
        console.log("README.md updated successfully.");
    } catch (error) {
        console.error("Failed to update README.md:", error);
        throw error;
    }
}

async function createFeatureDocument(octokit, owner, repo, title, aiGeneratedContent) {
    const featureDocPath = `docs/features/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;

    try {
        await octokit.rest.repos.createOrUpdateFileContents({
            owner,
            repo,
            path: featureDocPath,
            message: `docs(feature): Add feature documentation for "${title}"`,
            content: Buffer.from(aiGeneratedContent).toString('base64'),
            branch: context.payload.pull_request.head.ref,
        });
        console.log("Feature document created successfully at:", featureDocPath);
    } catch (error) {
        console.error("Failed to create feature document:", error);
        throw error;
    }
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

    const readmePrompt = `You are a helpful and expert AI assistant. Based on the following PR summary and changes, decide if the README file needs to be updated. If it does, provide the complete, updated content for the README. If not, respond with just "NO_UPDATE".

    PR Summary: ${reviewBody}
    Git Diff:
    \`\`\`diff
    ${diffContent}
    \`\`\`
    
    If the README needs updating, provide the full content in a single block. Do not add any extra commentary outside of the content block.`;

    let readmeContent = 'NO_UPDATE';
    try {
        const readmeResult = await fetchWithBackoff(() => model.generateContent(readmePrompt));
        readmeContent = readmeResult.response.text().trim();
        if (readmeContent !== 'NO_UPDATE') {
            await updateReadme(octokit, context.repo.owner, context.repo.repo, readmeContent, pull_number);
        }
    } catch (error) {
        console.error("Failed to check or update README. Details:", error);
    }

    const featureLabel = context.payload.pull_request.labels.find(label => label.name === 'feature');
    if (featureLabel) {
        const featureDocPrompt = `You are an expert technical writer. Based on the following PR title and Git diff, create a concise feature document. The document should explain what the new feature is, how to use it, and any new configurations. Format the response as a single markdown file content.

        PR Title: ${context.payload.pull_request.title}
        Git Diff:
        \`\`\`diff
        ${diffContent}
        \`\`\`
        `;
        try {
            const featureDocResult = await fetchWithBackoff(() => model.generateContent(featureDocPrompt));
            const featureDocContent = featureDocResult.response.text();
            await createFeatureDocument(octokit, context.repo.owner, context.repo.repo, context.payload.pull_request.title, featureDocContent);
        } catch (error) {
            console.error("Failed to create feature document. Details:", error);
        }
    }

    await octokit.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: pull_number,
        body: reviewBody,
    });
    console.log("Gemini's final review posted successfully.");
}

async function handleCommentResponse(octokit, commentBody, number, genAI) {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const userQuestion = commentBody.replace("Hey Gemini,", "").trim();
    let prompt;

    // Check if the comment is on a pull request
    if (context.payload.issue.pull_request) {
        // This is a comment on a PR, so we can get the diff
        const diffContent = await getDiff(octokit, context.repo.owner, context.repo.repo, number);
        prompt = `A user has a question about a pull request. The pull request diff is below, followed by the user's question. Please provide a clear and concise answer.

        ---
        Git Diff:
        \`\`\`diff
        ${diffContent}
        \`\`\`

        ---
        User's question:
        ${userQuestion}
        `;
    } else {
        // This is a comment on a regular issue. We don't have a diff.
        const issueTitle = context.payload.issue.title;
        const issueBody = context.payload.issue.body;
        prompt = `A user has a question about a GitHub issue. The issue's title and body are provided below, followed by the user's question. Please provide a clear and concise answer.

        ---
        Issue Title: ${issueTitle}
        Issue Body: ${issueBody}
        
        ---
        User's question:
        ${userQuestion}
        `;
    }

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
            issue_number: number,
            body: `## Gemini's Response\n\n${response}`
        });
        console.log("Gemini's response posted successfully.");
    }
}

async function handleNewIssue(octokit, owner, repo, issueNumber, issueTitle, issueBody, genAI) {
    console.log(`Processing new issue #${issueNumber}: ${issueTitle}`);
    
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are a helpful and expert AI assistant for a software development team. A new issue has been created. Your task is to:
    1.  Provide a concise, one-paragraph summary of the issue.
    2.  Provide an initial recommendation or a set of actionable steps to solve the issue.
    
    Issue Title: ${issueTitle}
    Issue Body: ${issueBody}
    `;

    let responseBody = "Error: Could not generate a summary and recommendations for this issue.";
    try {
        const result = await fetchWithBackoff(() => model.generateContent(prompt));
        responseBody = result.response.text();
        console.log("AI-generated summary and recommendations received successfully.");
    } catch (error) {
        console.error("Error generating response for new issue:", error);
    }
    
    await octokit.rest.issues.createComment({
        owner,
        repo,
        issue_number: issueNumber,
        body: `## 🤖 AI Summary & Recommendations\n\n${responseBody}`
    });
    console.log("AI response posted as a comment on the new issue.");
}

// Main function
// This is the entry point for the script execution.
//----------------------------------------------------------------------------------------------------------------

async function run() {
    try {
        const octokit = getOctokit(process.env.GITHUB_TOKEN);
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        
        const { owner, repo } = context.repo;

        // Determine the number based on the event payload
        let number;
        if (context.eventName === 'pull_request') {
            number = context.payload.pull_request.number;
        } else if (context.payload.issue) {
            number = context.payload.issue.number;
        } else {
            console.log("Could not determine issue/PR number from payload. Exiting.");
            return;
        }

        // Conditional logic based on event type
        if (context.eventName === 'pull_request') {
            console.log(`Pull Request event detected for #${number}. Initiating review.`);
            const diffContent = await getDiff(octokit, owner, repo, number);
            await performPRReview(octokit, diffContent, number, genAI);
        } else if (context.eventName === 'issues' && context.payload.action === 'opened') {
            console.log(`New Issue event detected for #${number}. Generating summary.`);
            const issueTitle = context.payload.issue.title;
            const issueBody = context.payload.issue.body;
            await handleNewIssue(octokit, owner, repo, number, issueTitle, issueBody, genAI);
        } else if (context.eventName === 'issue_comment' && context.payload.comment.body.startsWith("Hey Gemini,")) {
            console.log(`"Hey Gemini," comment detected on issue/PR #${number}. Initiating response.`);
            await handleCommentResponse(octokit, context.payload.comment.body, number, genAI);
        } else {
            console.log(`Event '${context.eventName}' did not match any triggers. No action taken.`);
        }
    } catch (error) {
        console.error(`An error occurred: ${error.message}`);
        throw error;
    }
}

run();
