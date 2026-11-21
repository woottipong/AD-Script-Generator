/// <reference lib="webworker" />
import { createFile } from 'mp4box';
import * as ort from 'onnxruntime-web/wasm';
import { VADConfig, VADOutput } from '../types/ad';
import {
  analyzeAudioSignalAndRecommendVad,
  computeVadOutputFromProbabilities,
} from '../utils/vadPostProcess';
import { WaveformPeakAccumulator } from '../utils/waveform';
import type { ProcessingProgress } from '../utils/processingFeedback';
import { openByteSource, type ByteSourceInput } from '../utils/byteSource';

const workerOrigin = typeof location !== 'undefined' && location.origin ? location.origin : '';
// Production uses the hashed WASM asset emitted alongside this worker.
if (import.meta.env.DEV) ort.env.wasm.wasmPaths = `${workerOrigin}/ort/`;
ort.env.wasm.numThreads = 1;
ort.env.wasm.simd = true;

const TARGET_SAMPLE_RATE = 16000;
const VAD_FRAME_SAMPLES = 512; // 32 ms @ 16kHz
const VAD_CONTEXT_SAMPLES = 64; // Silero v5+ context window @ 16kHz

let cachedSession: ort.InferenceSession | null = null;

async function getVadSession(): Promise<ort.InferenceSession> {
  if (cachedSession) {
    return cachedSession;
  }

  const modelUrl = workerOrigin ? `${workerOrigin}/models/silero_vad.onnx` : '/models/silero_vad.onnx';
  const modelRes = await fetch(modelUrl);
  if (!modelRes.ok) {
    throw new Error(`ไม่สามารถโหลดไฟล์โมเดล Silero VAD ได้ (HTTP ${modelRes.status})`);
  }
  const modelBuffer = await modelRes.arrayBuffer();

  cachedSession = await ort.InferenceSession.create(modelBuffer, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  return cachedSession;
}

/**
 * Extracts raw AudioSpecificConfig bytes (Tag 0x05 inside DecoderConfigDescriptor Tag 0x04)
 * from an mp4box audio sample entry's esds box.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractAacAudioSpecificConfig(mp4boxfile: any, audioTrackId: number): Uint8Array | undefined {
  try {
    const trak = mp4boxfile.getTrackById(audioTrackId);
    const entry = trak?.mdia?.minf?.stbl?.stsd?.entries?.[0];
    const esd = entry?.esds?.esd;
    if (!esd || !Array.isArray(esd.descs)) {
      return undefined;
    }
    for (const desc of esd.descs) {
      if (desc.tag === 0x04 && Array.isArray(desc.descs)) {
        for (const subDesc of desc.descs) {
          if (subDesc.tag === 0x05 && subDesc.data) {
            return subDesc.data instanceof Uint8Array
              ? subDesc.data
              : new Uint8Array(subDesc.data);
          }
        }
      }
    }
  } catch {
    // Fallback to undefined if descriptor structure differs
  }
  return undefined;
}

/**
 * Downmixes decoded WebCodecs AudioData to a single Mono Float32Array.
 */
function downmixAudioDataToMono(audioData: AudioData): Float32Array {
  const numFrames = audioData.numberOfFrames;
  const numChannels = audioData.numberOfChannels;
  const format = audioData.format || 'f32-planar';

  // Fast path: Try copying f32 directly
  try {
    if (format.endsWith('-planar')) {
      const mono = new Float32Array(numFrames);
      const channelBuffer = new Float32Array(numFrames);

      for (let ch = 0; ch < numChannels; ch++) {
        audioData.copyTo(channelBuffer, {
          planeIndex: ch,
          format: 'f32-planar',
        });
        for (let i = 0; i < numFrames; i++) {
          mono[i] += channelBuffer[i];
        }
      }

      if (numChannels > 1) {
        const inv = 1 / numChannels;
        for (let i = 0; i < numFrames; i++) {
          mono[i] *= inv;
        }
      }
      return mono;
    } else {
      const interleaved = new Float32Array(numFrames * numChannels);
      audioData.copyTo(interleaved, { planeIndex: 0, format: 'f32' });
      const mono = new Float32Array(numFrames);
      const inv = 1 / numChannels;
      for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        const offset = i * numChannels;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += interleaved[offset + ch];
        }
        mono[i] = sum * inv;
      }
      return mono;
    }
  } catch {
    // Fallback: Copy in original format if f32 copy was rejected by browser
    if (format === 's16-planar') {
      const mono = new Float32Array(numFrames);
      const channelBuffer = new Int16Array(numFrames);
      const scale = 1 / (32768 * numChannels);
      for (let ch = 0; ch < numChannels; ch++) {
        audioData.copyTo(channelBuffer, { planeIndex: ch, format: 's16-planar' });
        for (let i = 0; i < numFrames; i++) {
          mono[i] += channelBuffer[i] * scale;
        }
      }
      return mono;
    } else if (format === 's16') {
      const interleaved = new Int16Array(numFrames * numChannels);
      audioData.copyTo(interleaved, { planeIndex: 0, format: 's16' });
      const mono = new Float32Array(numFrames);
      const scale = 1 / (32768 * numChannels);
      for (let i = 0; i < numFrames; i++) {
        let sum = 0;
        const offset = i * numChannels;
        for (let ch = 0; ch < numChannels; ch++) {
          sum += interleaved[offset + ch];
        }
        mono[i] = sum * scale;
      }
      return mono;
    }
    throw new Error(`ไม่รองรับรูปแบบเสียงจาก AudioDecoder (${format})`);
  }
}

/**
 * Stateful streaming resampler from arbitrary sourceSampleRate (e.g., 44100 / 48000 Hz)
 * to 16000 Hz Mono Float32 PCM.
 */
class StreamingResampler16k {
  private sourceRate: number;
  private targetRate: number;
  private ratio: number;
  private sourcePos = 0;
  private prevSample = 0;
  private hasPrevSample = false;

  constructor(sourceRate: number, targetRate = TARGET_SAMPLE_RATE) {
    this.sourceRate = sourceRate;
    this.targetRate = targetRate;
    this.ratio = sourceRate / targetRate;
  }

  process(input: Float32Array): Float32Array {
    if (input.length === 0) {
      return new Float32Array(0);
    }
    if (this.sourceRate === this.targetRate) {
      return input;
    }

    const estimatedLength = Math.ceil((input.length + 2) / this.ratio);
    const out = new Float32Array(estimatedLength);
    let outIdx = 0;

    while (this.sourcePos < input.length) {
      const idx = Math.floor(this.sourcePos);
      const frac = this.sourcePos - idx;

      let s0: number;
      let s1: number;

      if (idx < 0) {
        s0 = this.hasPrevSample ? this.prevSample : input[0];
        s1 = input[0];
      } else {
        s0 = input[idx];
        s1 = idx + 1 < input.length ? input[idx + 1] : input[idx];
      }

      if (outIdx < out.length) {
        out[outIdx++] = s0 + frac * (s1 - s0);
      }
      this.sourcePos += this.ratio;
    }

    this.sourcePos -= input.length;
    this.prevSample = input[input.length - 1];
    this.hasPrevSample = true;

    return out.subarray(0, outIdx);
  }
}

interface WorkerStartMessage {
  type: 'PROCESS_FILE';
  source: ByteSourceInput;
  vadConfig: VADConfig;
  autoTuneOptimal?: boolean;
}

self.onmessage = async (event: MessageEvent<WorkerStartMessage>) => {
  const msg = event.data;

  if (msg.type === 'PROCESS_FILE') {
    const { source: sourceInput, vadConfig, autoTuneOptimal } = msg;
    let decoder = null as AudioDecoder | null;
    const getDecoder = (): AudioDecoder | null => decoder;

    try {
      self.postMessage({
        type: 'PROGRESS',
        stage: 'กำลังโหลดโมเดล Silero VAD (ONNX Runtime Web)...',
        percent: 4,
      });

      const session = await getVadSession();

      // Initialize Silero VAD model state (reset for every new file as required by Rule 2)
      const usesCombinedState = session.inputNames.includes('state');
      let vadState: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 1 * 128), [2, 1, 128]);
      let vadH: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
      let vadC: ort.Tensor = new ort.Tensor('float32', new Float32Array(2 * 1 * 64), [2, 1, 64]);
      const srTensor: ort.Tensor = new ort.Tensor('int64', BigInt64Array.from([BigInt(TARGET_SAMPLE_RATE)]), []);

      let contextBuffer = new Float32Array(VAD_CONTEXT_SAMPLES);
      const frameInputBuffer = new Float32Array(VAD_CONTEXT_SAMPLES + VAD_FRAME_SAMPLES); // 576 samples

      // Ring / accumulator for 16kHz PCM samples waiting to form 512-sample frames
      let pendingPcm = new Float32Array(0);
      const frameProbabilities: number[] = [];
      const frameRmsValues: number[] = [];

      let totalDurationMs = 0;
      let lastProgressReportAt = 0;
      const reportVadProgress = () => {
        const now = performance.now();
        if (now - lastProgressReportAt < 200) return;
        lastProgressReportAt = now;
        const processedMs = Math.round(frameProbabilities.length * VAD_FRAME_SAMPLES / TARGET_SAMPLE_RATE * 1000);
        const ratio = totalDurationMs > 0 ? Math.min(1, processedMs / totalDurationMs) : 0;
        self.postMessage({
          type: 'PROGRESS',
          stage: 'กำลังตรวจช่วงเสียงพูดในวิดีโอ...',
          percent: Math.min(94, Math.round(12 + ratio * 82)),
          processedMs,
          totalMs: totalDurationMs,
        });
      };

      const waveformAccumulator = new WaveformPeakAccumulator(TARGET_SAMPLE_RATE);

      const appendPcm16k = (chunk16k: Float32Array, recordWaveform = true) => {
        if (chunk16k.length === 0) return;
        if (recordWaveform) {
          waveformAccumulator.push(chunk16k);
        }
        const combined = new Float32Array(pendingPcm.length + chunk16k.length);
        combined.set(pendingPcm, 0);
        combined.set(chunk16k, pendingPcm.length);
        pendingPcm = combined;
      };

      const runPendingVadFrames = async () => {
        while (pendingPcm.length >= VAD_FRAME_SAMPLES) {
          const frame = pendingPcm.subarray(0, VAD_FRAME_SAMPLES);

          // Compute RMS energy of this 512-sample 16kHz frame for signal calibration
          let sumSq = 0;
          for (let i = 0; i < VAD_FRAME_SAMPLES; i++) {
            const v = frame[i];
            sumSq += v * v;
          }
          frameRmsValues.push(Math.sqrt(sumSq / VAD_FRAME_SAMPLES));

          if (usesCombinedState) {
            frameInputBuffer.set(contextBuffer, 0);
            frameInputBuffer.set(frame, VAD_CONTEXT_SAMPLES);

            const inputTensor = new ort.Tensor(
              'float32',
              new Float32Array(frameInputBuffer),
              [1, VAD_CONTEXT_SAMPLES + VAD_FRAME_SAMPLES]
            );

            const outputs = await session.run({
              input: inputTensor,
              state: vadState,
              sr: srTensor,
            });

            const prob = Number((outputs.output.data as Float32Array)[0] ?? 0);
            frameProbabilities.push(prob);
            if (outputs.stateN) {
              vadState = outputs.stateN as ort.Tensor;
            }
            contextBuffer.set(frame.subarray(VAD_FRAME_SAMPLES - VAD_CONTEXT_SAMPLES));
          } else {
            const inputTensor = new ort.Tensor('float32', new Float32Array(frame), [1, VAD_FRAME_SAMPLES]);
            const outputs = await session.run({
              input: inputTensor,
              sr: srTensor,
              h: vadH,
              c: vadC,
            });
            const prob = Number((outputs.output.data as Float32Array)[0] ?? 0);
            frameProbabilities.push(prob);
            if (outputs.hn) vadH = outputs.hn as ort.Tensor;
            if (outputs.cn) vadC = outputs.cn as ort.Tensor;
          }

          pendingPcm = pendingPcm.slice(VAD_FRAME_SAMPLES);
          // Report inside inference so highly compressed files do not wait for a whole file chunk.
          if (frameProbabilities.length % 32 === 0) reportVadProgress();
        }
      };

      self.postMessage({
        type: 'PROGRESS',
        stage: 'กำลังแยกแทร็กเสียง AAC จากไฟล์ MP4 (mp4box.js)...',
        percent: 10,
      });

      const mp4boxfile = createFile();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let audioTrackInfo: any = null;
      let decodedSamplesCount = 0;
      let decoderError: Error | null = null;
      let resampler: StreamingResampler16k | null = null;
      let initialTimestampAligned = false;

      interface QueuedAacChunk {
        isKey: boolean;
        timestampMicros: number;
        durationMicros: number;
        data: Uint8Array;
      }
      const extractedSampleQueue: QueuedAacChunk[] = [];

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mp4boxfile.onReady = (info: any) => {
        const audioTrack = info.audioTracks?.[0];
        if (!audioTrack) {
          decoderError = new Error('ไม่พบ Audio Track ในไฟล์ MP4');
          return;
        }
        audioTrackInfo = audioTrack;

        const durationSec =
          info.duration && info.timescale
            ? info.duration / info.timescale
            : audioTrack.duration && audioTrack.timescale
            ? audioTrack.duration / audioTrack.timescale
            : 0;
        totalDurationMs = Math.round(durationSec * 1000);

        const sourceSampleRate = audioTrack.audio?.sample_rate || 44100;
        const numberOfChannels = audioTrack.audio?.channel_count || 2;
        resampler = new StreamingResampler16k(sourceSampleRate, TARGET_SAMPLE_RATE);

        const description = extractAacAudioSpecificConfig(mp4boxfile, audioTrack.id);
        const codecString =
          typeof audioTrack.codec === 'string' && audioTrack.codec.startsWith('mp4a')
            ? audioTrack.codec
            : 'mp4a.40.2';

        decoder = new AudioDecoder({
          output: (audioData: AudioData) => {
            try {
              // Preserve timestamp alignment if audio track starts slightly after 0ms
              if (!initialTimestampAligned) {
                initialTimestampAligned = true;
                const startMicros = Math.max(0, audioData.timestamp || 0);
                const leadingZeroSamples = Math.round((startMicros / 1_000_000) * TARGET_SAMPLE_RATE);
                if (leadingZeroSamples > 0 && leadingZeroSamples < TARGET_SAMPLE_RATE * 60) {
                  appendPcm16k(new Float32Array(leadingZeroSamples));
                }
              }

              const monoPcm = downmixAudioDataToMono(audioData);
              if (resampler) {
                const pcm16k = resampler.process(monoPcm);
                appendPcm16k(pcm16k);
              }
            } catch (err) {
              decoderError = err instanceof Error ? err : new Error(String(err));
            } finally {
              audioData.close();
            }
          },
          error: (err: DOMException) => {
            decoderError = new Error(`WebCodecs AudioDecoder Error: ${err.message}`);
          },
        });

        const decoderConfig: AudioDecoderConfig = {
          codec: codecString,
          sampleRate: sourceSampleRate,
          numberOfChannels,
        };
        if (description && description.byteLength > 0) {
          decoderConfig.description = description;
        }

        decoder.configure(decoderConfig);

        mp4boxfile.setExtractionOptions(audioTrack.id, null, {
          nbSamples: 400,
        });
        mp4boxfile.start();
      };

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mp4boxfile.onSamples = (trackId: number, _user: any, samples: any[]) => {
        if (!samples || samples.length === 0) return;
        for (const s of samples) {
          if (!s || !s.data || s.data.byteLength === 0) continue;
          const timescale = s.timescale || 1000;
          const timestampMicros = Math.round(((s.cts || 0) / timescale) * 1_000_000);
          const durationMicros = Math.round(((s.duration || 0) / timescale) * 1_000_000);

          // Clone sample data buffer before mp4box releases it in releaseUsedSamples
          const raw = s.data instanceof Uint8Array ? s.data : new Uint8Array(s.data);
          const dataCopy = new Uint8Array(raw.byteLength);
          dataCopy.set(raw);

          extractedSampleQueue.push({
            isKey: Boolean(s.is_sync),
            timestampMicros,
            durationMicros,
            data: dataCopy,
          });
        }
        const lastSampleNumber = samples[samples.length - 1].number;
        mp4boxfile.releaseUsedSamples(trackId, lastSampleNumber);
      };

      mp4boxfile.onError = (_mod: string, message: string) => {
        decoderError = new Error(`MP4 Demux Error: ${message}`);
      };

      // Stream file in 2 MB chunks to keep memory footprint minimal even for 2 GB videos
      const CHUNK_SIZE = 2 * 1024 * 1024;
      let offset = 0;
      let rewoundToSamples = false;

      const file = await openByteSource(sourceInput);
      while (offset < file.size) {
        if (decoderError) {
          throw decoderError;
        }

        const end = Math.min(offset + CHUNK_SIZE, file.size);
        const chunkBuffer = await file.read(offset, end);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const mp4Buffer = chunkBuffer as any;
        mp4Buffer.fileStart = offset;

        const nextOffset = mp4boxfile.appendBuffer(mp4Buffer);

        // Drain extracted AAC samples through WebCodecs AudioDecoder & Silero VAD
        let activeDecoder = getDecoder();
        while (extractedSampleQueue.length > 0 && activeDecoder) {
          if (decoderError) throw decoderError;

          // Wait if decoder queue is deep to prevent memory pressure
          while (activeDecoder.decodeQueueSize > 64) {
            await new Promise((r) => setTimeout(r, 4));
          }

          const sample = extractedSampleQueue.shift();
          if (!sample || !sample.data) continue;

          const chunk = new EncodedAudioChunk({
            type: sample.isKey ? 'key' : 'delta',
            timestamp: sample.timestampMicros,
            duration: sample.durationMicros,
            data: sample.data,
          });

          activeDecoder.decode(chunk);
          decodedSamplesCount++;

          if (decodedSamplesCount % 120 === 0) {
            await runPendingVadFrames();
          }
          activeDecoder = getDecoder();
        }

        await runPendingVadFrames();

        reportVadProgress();

        // When moov sits after mdat, mp4box only learns where the audio samples are once it reaches the
        // end of the file, then asks to go back to them. Allow that one rewind; any other request moves forward.
        if (typeof nextOffset === 'number' && nextOffset > offset && nextOffset < file.size) {
          offset = nextOffset;
        } else if (typeof nextOffset === 'number' && nextOffset < offset && !rewoundToSamples) {
          rewoundToSamples = true;
          offset = nextOffset;
        } else {
          offset = end;
        }
      }

      mp4boxfile.flush();

      // Drain any remaining samples after mp4box flush
      const finalDecoder = getDecoder();
      while (extractedSampleQueue.length > 0 && finalDecoder) {
        if (decoderError) throw decoderError;
        const sample = extractedSampleQueue.shift();
        if (!sample || !sample.data) continue;

        finalDecoder.decode(
          new EncodedAudioChunk({
            type: sample.isKey ? 'key' : 'delta',
            timestamp: sample.timestampMicros,
            duration: sample.durationMicros,
            data: sample.data,
          })
        );
      }

      if (!audioTrackInfo || !finalDecoder) {
        throw new Error('ไม่สามารถเริ่มต้นตัวถอดรหัสเสียง AAC จากไฟล์ MP4 ได้');
      }

      await finalDecoder.flush();

      if (decoderError) {
        throw decoderError;
      }

      // 1. Process all full 512-sample frames produced by the decoded audio stream
      await runPendingVadFrames();

      // 2. Pad any remaining trailing sub-frame (< 512 samples) with zeros to complete the final frame
      if (pendingPcm.length > 0 && pendingPcm.length < VAD_FRAME_SAMPLES) {
        const padSize = VAD_FRAME_SAMPLES - pendingPcm.length;
        appendPcm16k(new Float32Array(padSize), false);
        await runPendingVadFrames();
      }

      self.postMessage({
        type: 'PROGRESS',
        stage: 'กำลังคำนวณช่วงเสียงพูด (Speech Segments) และสร้าง Candidate AD Spots...',
        phase: 'finalizing-detection',
        percent: 98,
      } satisfies { type: 'PROGRESS' } & ProcessingProgress);

      const computedDurationMs =
        totalDurationMs > 0
          ? totalDurationMs
          : Math.round(((frameProbabilities.length * VAD_FRAME_SAMPLES) / TARGET_SAMPLE_RATE) * 1000);

      const probabilities = Float32Array.from(frameProbabilities);
      const signalAnalysis = analyzeAudioSignalAndRecommendVad(probabilities, frameRmsValues);

      const effectiveConfig: VADConfig = autoTuneOptimal
        ? signalAnalysis.recommendedConfig
        : vadConfig;

      const vadOutput: VADOutput = {
        ...computeVadOutputFromProbabilities(
          probabilities,
          computedDurationMs,
          effectiveConfig,
          VAD_FRAME_SAMPLES,
          TARGET_SAMPLE_RATE,
          signalAnalysis
        ),
        waveform: waveformAccumulator.finalize(),
      };

      self.postMessage({
        type: 'COMPLETE',
        vadOutput,
        appliedConfig: effectiveConfig,
        frameCount: frameProbabilities.length,
      });
    } catch (err) {
      self.postMessage({
        type: 'ERROR',
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      const cleanupDecoder = getDecoder();
      if (cleanupDecoder && cleanupDecoder.state !== 'closed') {
        try {
          cleanupDecoder.close();
        } catch {
          // Ignore close error
        }
      }
    }
  }
};
