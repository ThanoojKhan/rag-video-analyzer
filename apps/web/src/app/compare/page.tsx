'use client';

import React, { useState, useEffect } from 'react';
import { useChat } from '../../lib/use-chat';
import {
  fetchVideo,
  ingestVideo,
  fetchVideos,
  getVideoStatus,
  type VideoDetails,
} from '../../lib/api-client';
import { VideoMetadataPreview, Button } from '@rag/ui';
import { ChatMessage } from '../../components/chat-message';

export default function ComparePage(): JSX.Element {
  const [videoAId, setVideoAId] = useState('');
  const [videoBId, setVideoBId] = useState('');
  const [videoA, setVideoA] = useState<VideoDetails | null>(null);
  const [videoB, setVideoB] = useState<VideoDetails | null>(null);
  const [isReady, setIsReady] = useState(false);
  const [videoAProgress, setVideoAProgress] = useState<number | null>(null);
  const [videoBProgress, setVideoBProgress] = useState<number | null>(null);

  const [input, setInput] = useState('');
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  const scrollToBottom = (): void => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const { messages, isLoading, error, sendMessage, clearMessages, retry } = useChat({
    videoIds: isReady ? [videoAId, videoBId] : [],
    analysisType: 'comparative',
  });

  const [isIngesting, setIsIngesting] = useState(false);
  const [recentVideos, setRecentVideos] = useState<VideoDetails[]>([]);

  useEffect(() => {
    fetchVideos()
      .then(setRecentVideos)
      .catch((err) => console.error('Failed to fetch recent videos:', err));
  }, []);

  const resolveVideoId = async (input: string): Promise<string> => {
    if (input.startsWith('http://') || input.startsWith('https://')) {
      const res = await ingestVideo({ url: input });
      return res.videoId;
    }
    return input;
  };

  const handleLoadVideos = async (): Promise<void> => {
    if (!videoAId || !videoBId) return;
    setIsIngesting(true);
    clearMessages();
    try {
      const idA = await resolveVideoId(videoAId);
      const idB = await resolveVideoId(videoBId);

      setVideoAId(idA);
      setVideoBId(idB);

      const [va, vb] = await Promise.all([fetchVideo(idA), fetchVideo(idB)]);
      setVideoA(va);
      setVideoB(vb);
      setIsReady(true);
    } catch (err) {
      console.error(err);
      alert('Failed to load or ingest videos. Please verify the URLs or IDs and try again.');
    } finally {
      setIsIngesting(false);
    }
  };

  const handleSend = (e?: React.FormEvent): void => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;
    void sendMessage(input);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading, error]);

  useEffect(() => {
    if (!isReady) return;

    let aInterval: NodeJS.Timeout | undefined = undefined;
    let bInterval: NodeJS.Timeout | undefined = undefined;

    const pollA = async (): Promise<void> => {
      try {
        const status = await getVideoStatus(videoAId);
        setVideoAProgress(status.overallProgress);
        if (status.embeddingStatus === 'COMPLETED' || status.embeddingStatus === 'FAILED') {
          if (aInterval) clearInterval(aInterval);
        }
      } catch (err) {
        console.error('Failed to poll A:', err);
      }
    };

    const pollB = async (): Promise<void> => {
      try {
        const status = await getVideoStatus(videoBId);
        setVideoBProgress(status.overallProgress);
        if (status.embeddingStatus === 'COMPLETED' || status.embeddingStatus === 'FAILED') {
          if (bInterval) clearInterval(bInterval);
        }
      } catch (err) {
        console.error('Failed to poll B:', err);
      }
    };

    void pollA();
    void pollB();
    aInterval = setInterval(pollA, 2000);
    bInterval = setInterval(pollB, 2000);

    return () => {
      clearInterval(aInterval);
      clearInterval(bInterval);
    };
  }, [isReady, videoAId, videoBId]);

  const isChatReady = isReady && videoAProgress === 100 && videoBProgress === 100;

  return (
    <div className="h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md px-6 py-4 flex-none sticky top-0 z-10">
        <h1 className="text-xl font-semibold tracking-tight">Creator Intelligence Workspace</h1>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Video Previews */}
        <div className="w-full h-[45vh] md:h-auto md:w-1/2 xl:w-[45%] border-b md:border-b-0 md:border-r border-slate-800 bg-slate-950/50 overflow-y-auto p-6 flex flex-col gap-6 shrink-0">
          {!isReady ? (
            <div className="space-y-4">
              <h2 className="text-lg font-medium text-slate-200">Load Videos for Comparison</h2>
              <div className="flex flex-col xl:flex-row gap-6">
                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1">Video A</label>
                  <div className="flex flex-col gap-2">
                    <select
                      value={videoAId.startsWith('http') ? '' : videoAId}
                      onChange={(e) => setVideoAId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                      disabled={isIngesting}
                    >
                      <option value="">-- Select previously ingested video --</option>
                      {recentVideos.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title
                            ? v.title.length > 50
                              ? v.title.substring(0, 50) + '...'
                              : v.title
                            : 'Untitled'}{' '}
                          (ID: {v.id})
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center text-xs text-slate-500 uppercase font-medium tracking-wider my-1">
                      <div className="flex-1 border-t border-slate-700"></div>
                      <span className="px-3">OR PASTE NEW URL</span>
                      <div className="flex-1 border-t border-slate-700"></div>
                    </div>
                    <input
                      type="text"
                      value={videoAId}
                      onChange={(e) => setVideoAId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                      disabled={isIngesting}
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </div>
                </div>

                <div className="hidden xl:block w-px bg-slate-800" />

                <div className="flex-1">
                  <label className="block text-sm text-slate-400 mb-1">Video B</label>
                  <div className="flex flex-col gap-2">
                    <select
                      value={videoBId.startsWith('http') ? '' : videoBId}
                      onChange={(e) => setVideoBId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                      disabled={isIngesting}
                    >
                      <option value="">-- Select previously ingested video --</option>
                      {recentVideos.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.title
                            ? v.title.length > 50
                              ? v.title.substring(0, 50) + '...'
                              : v.title
                            : 'Untitled'}{' '}
                          (ID: {v.id})
                        </option>
                      ))}
                    </select>
                    <div className="flex items-center text-xs text-slate-500 uppercase font-medium tracking-wider my-1">
                      <div className="flex-1 border-t border-slate-700"></div>
                      <span className="px-3">OR PASTE NEW URL</span>
                      <div className="flex-1 border-t border-slate-700"></div>
                    </div>
                    <input
                      type="text"
                      value={videoBId}
                      onChange={(e) => setVideoBId(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-700 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500"
                      disabled={isIngesting}
                      placeholder="https://youtube.com/watch?v=..."
                    />
                  </div>
                </div>
              </div>
              <Button onClick={handleLoadVideos} className="w-full mt-6" disabled={isIngesting}>
                {isIngesting ? 'Loading & Ingesting...' : 'Load Videos'}
              </Button>
            </div>
          ) : (
            <div className="space-y-6 flex flex-col h-full">
              <div className="flex justify-between items-center">
                <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">
                  Comparative Context
                </h2>
                <button
                  onClick={() => {
                    setIsReady(false);
                    clearMessages();
                  }}
                  className="text-xs text-sky-400 hover:text-sky-300"
                >
                  Change Videos
                </button>
              </div>

              <div className="flex flex-col xl:flex-row gap-6">
                <div className="flex-1 space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-sky-500 uppercase tracking-widest">
                      Video A
                    </span>
                    {videoAProgress !== null && videoAProgress < 100 && (
                      <span className="text-xs text-sky-400">Embedding: {videoAProgress}%</span>
                    )}
                  </div>
                  {videoAProgress !== null && videoAProgress < 100 && (
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-sky-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${videoAProgress}%` }}
                      />
                    </div>
                  )}
                  {videoA && <VideoMetadataPreview {...videoA} />}
                </div>

                <div className="hidden xl:block w-px bg-slate-800" />

                <div className="flex-1 space-y-2 pt-4 xl:pt-0 border-t xl:border-t-0 border-slate-800">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-bold text-sky-500 uppercase tracking-widest">
                      Video B
                    </span>
                    {videoBProgress !== null && videoBProgress < 100 && (
                      <span className="text-xs text-sky-400">Embedding: {videoBProgress}%</span>
                    )}
                  </div>
                  {videoBProgress !== null && videoBProgress < 100 && (
                    <div className="w-full bg-slate-800 rounded-full h-1.5 overflow-hidden">
                      <div
                        className="bg-sky-500 h-1.5 rounded-full transition-all duration-500"
                        style={{ width: `${videoBProgress}%` }}
                      />
                    </div>
                  )}
                  {videoB && <VideoMetadataPreview {...videoB} />}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Chat UI */}
        <div className="flex-1 flex flex-col bg-slate-900 relative">
          {/* Chat History Area */}
          <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
            {!isReady ? (
              <div className="h-full flex items-center justify-center text-slate-500">
                Load two videos to begin comparative analysis.
              </div>
            ) : !isChatReady ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                <div className="w-12 h-12 border-4 border-slate-800 border-t-sky-500 rounded-full animate-spin"></div>
                <p>Generating embeddings... Chat will be ready soon.</p>
              </div>
            ) : messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 space-y-4 max-w-md mx-auto text-center">
                <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mb-2">
                  <svg
                    className="w-8 h-8 text-sky-500"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13 10V3L4 14h7v7l9-11h-7z"
                    />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-slate-200">Analysis Ready</h3>
                <p className="text-sm">
                  Ask a question to compare the strategies, hooks, or pacing of the selected videos.
                </p>
                <div className="flex flex-wrap justify-center gap-2 pt-4">
                  <button
                    onClick={() => {
                      setInput('Why did Video A get more engagement than Video B?');
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700"
                  >
                    Why did A get more engagement?
                  </button>
                  <button
                    onClick={() => {
                      setInput("What's the engagement rate of each?");
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700"
                  >
                    Engagement rates
                  </button>
                  <button
                    onClick={() => {
                      setInput('Compare the hooks in the first 5 seconds.');
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700"
                  >
                    Compare the hooks
                  </button>
                  <button
                    onClick={() => {
                      setInput("Who's the creator of Video B and what's their follower count?");
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700"
                  >
                    Creator of Video B
                  </button>
                  <button
                    onClick={() => {
                      setInput('Suggest improvements for B based on what worked in A.');
                    }}
                    className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-full transition-colors border border-slate-700"
                  >
                    Suggest improvements for B
                  </button>
                </div>
              </div>
            ) : (
              <div className="max-w-3xl mx-auto flex flex-col w-full pb-4">
                {messages.map((msg) => (
                  <ChatMessage key={msg.turnId} message={msg} />
                ))}

                {error && (
                  <div className="mb-6 p-4 rounded-lg bg-red-900/30 border border-red-800/50 flex gap-3 text-red-200 text-sm shadow-md">
                    <svg
                      className="w-5 h-5 text-red-500 shrink-0"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                      />
                    </svg>
                    <div className="flex-1">
                      <p className="font-medium text-red-400 mb-1">Provider Degradation Detected</p>
                      <p className="mb-2">{error}</p>
                      <button
                        onClick={retry}
                        className="text-xs px-3 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-200 rounded border border-red-500/30 transition-colors"
                      >
                        Retry Analysis
                      </button>
                    </div>
                  </div>
                )}

                <div ref={messagesEndRef} />
              </div>
            )}
          </div>

          {/* Input Area */}
          <div className="p-4 pb-2 bg-slate-900 border-t border-slate-800 flex flex-col items-center">
            <div className="max-w-3xl mx-auto w-full mb-2">
              <form onSubmit={handleSend} className="relative flex items-center">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={
                    isChatReady
                      ? 'Ask about the videos...'
                      : isReady
                        ? 'Processing videos...'
                        : 'Load videos first'
                  }
                  disabled={!isChatReady || isLoading}
                  rows={1}
                  className="w-full bg-slate-950 border border-slate-700 rounded-2xl pl-5 pr-14 py-3.5 text-sm focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-50 disabled:cursor-not-allowed shadow-inner resize-none overflow-hidden min-h-[48px] leading-relaxed"
                  style={{ height: 'auto', minHeight: '48px', maxHeight: '200px' }}
                />
                <button
                  type="submit"
                  disabled={!isChatReady || isLoading || !input.trim()}
                  className="absolute right-3 bottom-3 p-2 rounded-full bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-50 disabled:hover:bg-sky-600 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 12h14M12 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </form>
            </div>
            <span className="text-[10px] text-slate-500 text-center">
              Responses are AI-generated and may contain inaccuracies. Grounded with retrieved
              context. © 2026 Thanooj.
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}
