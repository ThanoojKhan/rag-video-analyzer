import { pipeline, env } from '@xenova/transformers';

// Configure transformers cache location globally
if (process.env.TRANSFORMERS_CACHE) {
  env.cacheDir = process.env.TRANSFORMERS_CACHE;
}

export interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export class LocalWhisperTranscriber {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static instance: any;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private static async getPipeline(): Promise<any> {
    if (!this.instance) {
      this.instance = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        quantized: true,
      });
    }
    return this.instance;
  }

  static async transcribeAudioFile(filePath: string): Promise<WhisperSegment[]> {
    const transcriber = await this.getPipeline();

    // We can pass the file path directly to Xenova/transformers if it's an audio file
    const output = await transcriber(filePath, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true,
    });

    if (!output.chunks) {
      return [
        {
          start: 0,
          end: 0,
          text: output.text || '',
        },
      ];
    }

    return output.chunks.map((chunk: { timestamp: (number | null)[]; text: string }) => ({
      start: chunk.timestamp[0] ?? 0,
      end: chunk.timestamp[1] ?? chunk.timestamp[0] ?? 0,
      text: chunk.text,
    }));
  }
}
