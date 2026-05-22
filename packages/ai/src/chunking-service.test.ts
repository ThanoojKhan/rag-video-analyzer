import { describe, it, expect } from 'vitest';
import { ChunkingService, type SegmentInput } from '../src/chunking-service';

describe('ChunkingService', () => {
  describe('estimateTokenCount', () => {
    it('should return 0 for empty or whitespace-only strings', () => {
      expect(ChunkingService.estimateTokenCount('')).toBe(0);
      expect(ChunkingService.estimateTokenCount('   ')).toBe(0);
      expect(ChunkingService.estimateTokenCount('\n\t')).toBe(0);
    });

    it('should estimate token count using ~1.3 tokens per word', () => {
      // 1 word: 1 * 1.3 = 1.3 -> rounded up to 2
      expect(ChunkingService.estimateTokenCount('hello')).toBe(2);

      // 5 words: 5 * 1.3 = 6.5 -> rounded up to 7
      expect(ChunkingService.estimateTokenCount('this is a simple test')).toBe(7);

      // 10 words: 10 * 1.3 = 13 -> 13
      expect(
        ChunkingService.estimateTokenCount('one two three four five six seven eight nine ten'),
      ).toBe(13);
    });

    it('should handle extra whitespace correctly', () => {
      expect(ChunkingService.estimateTokenCount('  hello   world  ')).toBe(3); // 2 words -> 2.6 -> 3
    });
  });

  describe('chunkTranscript', () => {
    // Helper to generate simple segments
    const createSegments = (texts: string[], durationPerSegment = 5, gap = 0): SegmentInput[] => {
      let currentSeconds = 0;
      return texts.map((text, idx) => {
        const start = currentSeconds;
        const end = currentSeconds + durationPerSegment;
        currentSeconds = end + gap;
        return {
          sequenceIndex: idx,
          startSeconds: start,
          endSeconds: end,
          text,
        };
      });
    };

    it('should handle empty input', () => {
      const chunks = ChunkingService.chunkTranscript([]);
      expect(chunks).toEqual([]);
    });

    it('should group all segments into a single chunk if they fit within maxTokens', () => {
      const segments = createSegments(['Hello world.', 'This is a test.', 'Everything fits here.']);
      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 100,
        minChunkSize: 50,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].chunkIndex).toBe(0);
      expect(chunks[0].text).toBe('Hello world. This is a test. Everything fits here.');
      expect(chunks[0].startSeconds).toBe(0);
      expect(chunks[0].endSeconds).toBe(15);
      expect(chunks[0].transcriptSegmentStart).toBe(0);
      expect(chunks[0].transcriptSegmentEnd).toBe(2);
      expect(chunks[0].tokenCount).toBe(ChunkingService.estimateTokenCount(chunks[0].text));
    });

    it('should split on sentence boundaries if minChunkSize is exceeded', () => {
      const segments = createSegments([
        'This is the first segment.', // 5 words -> 7 tokens
        'Here is the second segment.', // 5 words -> 7 tokens
        'Third segment starts here.', // 4 words -> 6 tokens
        'Fourth segment ends here.', // 4 words -> 6 tokens
      ]);

      // If maxTokens=500, minChunkSize=10, sentence boundaries are punctuation.
      // After first two segments, total tokens = ~14. Since 14 >= 10 (minChunkSize) and first two segments end with punctuation,
      // it should split!
      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 500,
        minChunkSize: 10,
        overlapTokens: 0,
      });

      expect(chunks.length).toBeGreaterThan(1);
      // Let's verify the first chunk contains segment 0 and 1
      expect(chunks[0].transcriptSegmentStart).toBe(0);
      expect(chunks[0].transcriptSegmentEnd).toBe(1);
      expect(chunks[0].text).toBe('This is the first segment. Here is the second segment.');
      // The second chunk contains segment 2 and 3
      expect(chunks[1].transcriptSegmentStart).toBe(2);
      expect(chunks[1].transcriptSegmentEnd).toBe(3);
    });

    it('should split on time gaps if minChunkSize is exceeded', () => {
      const segments = [
        { sequenceIndex: 0, startSeconds: 0, endSeconds: 5, text: 'Hello word' },
        { sequenceIndex: 1, startSeconds: 5, endSeconds: 10, text: 'Some text' },
        // Large gap of 10s here (20 - 10 = 10 > 3s gap threshold)
        { sequenceIndex: 2, startSeconds: 20, endSeconds: 25, text: 'New topic' },
        { sequenceIndex: 3, startSeconds: 25, endSeconds: 30, text: 'After pause' },
      ];

      // minChunkSize=5 (so hello word + some text = 4 words -> 6 tokens >= 5 tokens)
      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 500,
        minChunkSize: 5,
        timeGapThresholdSeconds: 3.0,
        overlapTokens: 0,
      });

      expect(chunks).toHaveLength(2);
      expect(chunks[0].transcriptSegmentStart).toBe(0);
      expect(chunks[0].transcriptSegmentEnd).toBe(1);
      expect(chunks[0].text).toBe('Hello word Some text');
      expect(chunks[0].endSeconds).toBe(10);

      expect(chunks[1].transcriptSegmentStart).toBe(2);
      expect(chunks[1].transcriptSegmentEnd).toBe(3);
      expect(chunks[1].text).toBe('New topic After pause');
      expect(chunks[1].startSeconds).toBe(20);
    });

    it('should respect maxTokens hard limit even if no sentence boundary or time gap exists', () => {
      // 10 segments of 3 words each. Total 30 words (~39 tokens).
      const segments = createSegments(
        [
          'one two three',
          'four five six',
          'seven eight nine',
          'ten eleven twelve',
          'thirteen fourteen fifteen',
        ],
        5,
        0,
      );

      // maxTokens=15 (~11 words). It must split when it reaches 15 tokens.
      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 15,
        minChunkSize: 100, // force it to ignore semantic boundaries
        overlapTokens: 0,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.tokenCount).toBeLessThanOrEqual(15);
      }
    });

    it('should support slide-window overlap', () => {
      const segments = createSegments([
        'This is the first segment.', // 5 words -> 7 tokens
        'Here is the second segment.', // 5 words -> 7 tokens
        'Third segment starts here', // 4 words -> 6 tokens
        'Fourth segment ends here.', // 4 words -> 6 tokens
      ]);

      // Split after segment 1 (14 tokens). minChunkSize = 10, overlapTokens = 10.
      // So segment 1 (7 tokens) should be pulled into the second chunk as overlap!
      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 500,
        minChunkSize: 10,
        overlapTokens: 10,
      });

      expect(chunks).toHaveLength(2);
      expect(chunks[0].transcriptSegmentStart).toBe(0);
      expect(chunks[0].transcriptSegmentEnd).toBe(1);
      expect(chunks[0].text).toBe('This is the first segment. Here is the second segment.');

      // Second chunk should overlap and start with segment 1
      expect(chunks[1].transcriptSegmentStart).toBe(1);
      expect(chunks[1].transcriptSegmentEnd).toBe(3);
      expect(chunks[1].text).toBe(
        'Here is the second segment. Third segment starts here Fourth segment ends here.',
      );
      expect(chunks[1].startSeconds).toBe(5); // Start of segment 1
      expect(chunks[1].endSeconds).toBe(20);
    });

    it('should not enter an infinite loop and should keep single large segments exceeding maxTokens', () => {
      const segments = [
        {
          sequenceIndex: 0,
          startSeconds: 0,
          endSeconds: 5,
          text: 'This is a single exceptionally long segment that exceeds the token count limit on its own.',
        },
      ];

      const chunks = ChunkingService.chunkTranscript(segments, {
        maxTokens: 10,
      });

      expect(chunks).toHaveLength(1);
      expect(chunks[0].transcriptSegmentStart).toBe(0);
      expect(chunks[0].transcriptSegmentEnd).toBe(0);
      expect(chunks[0].tokenCount).toBeGreaterThan(10);
    });
  });
});
