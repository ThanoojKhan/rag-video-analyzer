import { describe, it, expect } from 'vitest';
import { TranscriptPipeline } from '../src/transcript-pipeline';

describe('TranscriptPipeline', () => {
  describe('normalizeSegments', () => {
    it('should normalize transcript segments', () => {
      const rawSegments = [
        { start: '0.0', end: '5.0', text: 'Hello world' },
        { start: 10.5, end: 15.2, content: 'Second segment' },
        { start: 20, end: 25, text: '  Third segment  ' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);

      expect(normalized).toHaveLength(3);
      expect(normalized[0]).toEqual({
        sequenceIndex: 0,
        startSeconds: 0,
        endSeconds: 5,
        text: 'Hello world',
        sourceType: 'extracted',
      });
      expect(normalized[1]).toEqual({
        sequenceIndex: 1,
        startSeconds: 10.5,
        endSeconds: 15.2,
        text: 'Second segment',
        sourceType: 'extracted',
      });
      expect(normalized[2]).toEqual({
        sequenceIndex: 2,
        startSeconds: 20,
        endSeconds: 25,
        text: 'Third segment',
        sourceType: 'extracted',
      });
    });

    it('should set sourceType correctly', () => {
      const rawSegments = [{ start: 0, end: 5, text: 'Hello' }];

      const native = TranscriptPipeline.normalizeSegments(rawSegments, 'native');
      expect(native[0].sourceType).toBe('native');

      const generated = TranscriptPipeline.normalizeSegments(rawSegments, 'generated');
      expect(generated[0].sourceType).toBe('generated');
    });

    it('should filter out empty segments', () => {
      const rawSegments = [
        { start: 0, end: 5, text: 'Hello' },
        { start: 5, end: 10, text: '   ' },
        { start: 10, end: 15, text: '' },
        { start: 15, end: 20, text: 'World' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized).toHaveLength(2);
      expect(normalized[0].text).toBe('Hello');
      expect(normalized[1].text).toBe('World');
    });

    it('should preserve segment order', () => {
      const rawSegments = [
        { start: 0, end: 5, text: 'First' },
        { start: 5, end: 10, text: 'Second' },
        { start: 10, end: 15, text: 'Third' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized.map((s) => s.text)).toEqual(['First', 'Second', 'Third']);
      expect(normalized.map((s) => s.sequenceIndex)).toEqual([0, 1, 2]);
    });

    it('should handle both string and number time formats', () => {
      const rawSegments = [
        { start: '0', end: '5.5', text: 'First' },
        { start: 5.5, end: 10, text: 'Second' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized[0].startSeconds).toBe(0);
      expect(normalized[0].endSeconds).toBe(5.5);
      expect(normalized[1].startSeconds).toBe(5.5);
      expect(normalized[1].endSeconds).toBe(10);
    });

    it('should default to 0 for missing or invalid time values', () => {
      const rawSegments = [
        { start: undefined, end: undefined, text: 'Test' },
        { start: 'invalid', end: 'also-invalid', text: 'Test 2' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized[0].startSeconds).toBe(0);
      expect(normalized[0].endSeconds).toBe(0);
      expect(normalized[1].startSeconds).toBe(0);
      expect(normalized[1].endSeconds).toBe(0);
    });

    it('should handle mixed text and content fields', () => {
      const rawSegments = [
        { start: 0, end: 5, text: 'From text field' },
        { start: 5, end: 10, content: 'From content field' },
        { start: 10, end: 15, text: '', content: 'Content as fallback' },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized[0].text).toBe('From text field');
      expect(normalized[1].text).toBe('From content field');
      expect(normalized[2].text).toBe('Content as fallback');
    });

    it('should trim whitespace from text', () => {
      const rawSegments = [
        {
          start: 0,
          end: 5,
          text: '   \n  Multiple   spaces  \t  and newlines  \n  ',
        },
      ];

      const normalized = TranscriptPipeline.normalizeSegments(rawSegments);
      expect(normalized[0].text).toBe('Multiple   spaces  \t  and newlines');
    });
  });
});
