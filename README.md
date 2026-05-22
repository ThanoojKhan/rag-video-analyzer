# RAG Video Analyzer

Hey! Welcome to the RAG Video Analyzer. I built this project to easily pull transcripts from social videos (like YouTube and Instagram), process them, and run semantic comparisons against them using an LLM.

Instead of watching hours of videos to find specific talking points, you can just feed the links into this app and chat with the content. It uses local embeddings to keep things fast and cheap, and Gemini for the actual synthesis.

## How it works under the hood

The codebase is split up into a few distinct pieces:

- **The Web App (`apps/web`):** Built with Next.js. It's mostly just a clean UI where you can paste two video URLs side-by-side and chat with them.
- **The API (`apps/api`):** A Fastify server that handles the chat streaming (using Server-Sent Events) and kicks off ingestion jobs. We use LangGraph here to strictly control how the context is fetched and passed to the LLM.
- **The Worker (`workers/ingestion-worker`):** A background process that polls Postgres for new videos. When it finds one, it downloads the audio/transcript, chunks the text, and generates vector embeddings locally using ONNX transformers (`bge-small-en-v1.5`).
- **The Database:** Postgres with `pgvector`. It stores all the metadata and embeddings together so we can filter by video ID before doing the heavy KNN similarity math.

## Getting Started

You'll need Node, pnpm, and Docker installed to run this locally.

1. **Install everything**

   ```bash
   pnpm install
   ```

2. **Spin up the database and cache**
   We need Postgres and Redis running for the worker and API to talk to each other.

   ```bash
   pnpm docker:up
   ```

3. **Run the database migrations**
   Set up the tables and the pgvector extension.

   ```bash
   pnpm --filter @rag/db migrate:deploy
   ```

4. **Set up your environment variables**
   Copy the example `.env` file at the root:

   ```bash
   cp .env.example .env
   ```

   You'll need to drop your Gemini API key in there (`GOOGLE_API_KEY=your_key_here`). If you don't provide one, the app will just run in a mocked "offline" mode which is handy for working on the UI without burning API credits.

5. **Fire it up**
   ```bash
   pnpm dev
   ```

## How to use it

1. Head over to `http://localhost:3000/compare`.
2. Grab a couple of YouTube links and paste them into the Video A and Video B boxes.
3. You'll see a progress bar as the background worker downloads the transcripts and generates the embeddings.
4. Once it hits 100%, just ask a question in the chat! Try something like: _"What's the difference between how these two videos handle their intro hooks?"_

## Troubleshooting / Handy Scripts

If you're hacking on this and things get weird:

- **Checking chunks:** You can hit `GET /api/v1/diagnostics/videos/:id/chunks` to see exactly how the text was sliced up and what the vectors look like.
- **Checking providers:** `GET /api/v1/system/providers` will tell you if your API keys are loaded properly and what local model is running.
- **Nuking embeddings:** If you started the app without an API key (mock mode) and later added one, your old embeddings are probably junk. Run `pnpm run script:rebuild-embeddings` to wipe the slate clean and force the worker to re-embed everything properly.
