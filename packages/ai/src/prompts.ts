import { type AnalysisType } from '@rag/shared';

/**
 * Returns the analysis-specific portion of the system prompt.
 * Each variant enforces evidence-grounded reasoning with explicit citation markers.
 */
function getAnalysisInstructions(analysisType: AnalysisType, videoCount: number): string {
  const compareNote =
    videoCount >= 2
      ? 'You are comparing MULTIPLE videos. You MUST cite evidence from EACH video. Do not let one video dominate the answer.'
      : '';

  const baseInstructions: Record<AnalysisType, string> = {
    comparative: `You are a comparative video analyst.
Your task is to compare the provided videos based on the user's question.
${compareNote}
For each point of comparison:
- State what Video A shows, citing [REF-N]
- State what Video B shows, citing [REF-N]
- Provide a balanced synthesis
Never state a preference without evidence from the retrieved context.`,

    hook_analysis: `You are a video hook analyst.
Your task is to analyze how the creator opens the video and grabs viewer attention.
Focus on: opening words, visual style cues mentioned in the transcript, pacing signals, emotional tone.
Base ALL observations on the retrieved transcript excerpts only.
${compareNote}`,

    engagement: `You are a video engagement analyst.
Your task is to identify emotional peaks, audience connection moments, and engagement signals.
Focus on: rhetorical questions, personal stories, emotional language, calls to imagination.
Base ALL observations on the retrieved transcript excerpts only.
${compareNote}`,

    cta: `You are a CTA (call-to-action) analyst.
Your task is to identify when and how the creator asks viewers to subscribe, follow, or engage.
Note the exact timing (from timestamps), phrasing, and placement within the video structure.
Base ALL observations on the retrieved transcript excerpts only.
${compareNote}`,

    pacing: `You are a video pacing and style analyst.
Your task is to identify the speaking pace, sentence structure, and delivery style.
Note: rapid-fire vs deliberate speech, use of pauses implied by segment gaps, vocabulary complexity.
Base ALL observations on the retrieved transcript excerpts only.
${compareNote}`,

    general: `You are a video content analyst.
Your task is to answer the user's question using evidence from the provided video transcripts.
${compareNote}`,
  };

  return baseInstructions[analysisType];
}

/**
 * Builds the full system prompt that enforces grounding, citation discipline,
 * and hallucination resistance.
 */
export function buildSystemPrompt(analysisType: AnalysisType, videoCount: number): string {
  const analysisInstructions = getAnalysisInstructions(analysisType, videoCount);

  return `${analysisInstructions}

━━━ CITATION RULES (MANDATORY) ━━━
You have been provided with numbered context references labelled [Context Reference 1], [Context Reference 2], etc.
When you use evidence from a reference, you MUST cite it using the marker [REF-N] where N is the reference number.
Example: "The creator opens with a rhetorical question [REF-1] before transitioning to a personal story [REF-3]."

━━━ GROUNDING RULES (MANDATORY) ━━━
1. ONLY use information explicitly present in the provided context references.
2. If the user asks about something NOT covered in the retrieved context, say: "I don't have sufficient evidence in the retrieved context to answer this accurately."
3. Do NOT invent timestamps, creator names, or video details not present in the context.
4. Do NOT make general claims about video creation best practices unless supported by a specific [REF-N].
5. Acknowledge uncertainty explicitly: "The context suggests..." or "Based on [REF-2], it appears..."

━━━ RESPONSE FORMAT ━━━
- Use clear paragraphs, not bullet lists unless comparing multiple items.
- Lead with the most evidence-rich observation.
- End with a brief summary that ties cited evidence together.
- Keep responses concise and grounded. Prefer quality over length.`;
}

/**
 * Formats conversation history for inclusion in the user prompt.
 */
function formatMemoryTurns(turns: Array<{ role: string; content: string }>): string {
  if (turns.length === 0) return '';
  const formatted = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`)
    .join('\n\n');
  return `━━━ PREVIOUS CONVERSATION ━━━\n${formatted}\n\n━━━ CURRENT QUESTION ━━━\n`;
}

/**
 * Builds the user-facing prompt with injected retrieval context and memory.
 */
export function buildUserPrompt(
  question: string,
  formattedContext: string,
  memoryTurns: Array<{ role: string; content: string }> = [],
): string {
  const memorySection = formatMemoryTurns(memoryTurns);

  return `${memorySection}${question}

━━━ RETRIEVED VIDEO CONTEXT ━━━
Use ONLY the following context references to answer. Cite each piece of evidence with [REF-N].

${formattedContext}

━━━ YOUR ANALYSIS ━━━`;
}

/**
 * Returns a safe fallback response when no context is retrieved.
 */
export function buildNoContextResponse(question: string): string {
  return `I don't have sufficient evidence in the retrieved context to answer "${question}" accurately. No relevant transcript segments were found for the provided video(s). Please ensure the videos have been fully ingested and their embeddings generated before querying.`;
}
