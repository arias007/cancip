import * as ort from "onnxruntime-web/wasm";
import { primeTtsTextToIds } from "./primeTtsFrontend";

const PRIME_TTS_FADE_IN_MS = 4;
const PRIME_TTS_FADE_OUT_MS = 8;
const PRIME_TTS_TAIL_SILENCE_MS = 2;

const workerSelf = self as unknown as {
  onmessage: ((event: MessageEvent<PrimeTtsWorkerMessage>) => void) | null;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
};

type OrtTensorLike = {
  dims: readonly number[];
  data: Float32Array | BigInt64Array | boolean[] | number[] | bigint[];
};

type PrimeTtsMeta = {
  sample_rate: number;
  abs_frame_bins: number;
  max_frames: number;
};

type PrimeTtsRuntime = {
  encoder: ort.InferenceSession;
  decoder: ort.InferenceSession;
  vocoder: ort.InferenceSession;
  meta: PrimeTtsMeta;
};

type PrimeTtsWorkerMessage = {
  id: number;
  type: "init" | "synthesize";
  encoder?: ArrayBuffer;
  decoder?: ArrayBuffer;
  vocoder?: ArrayBuffer;
  wasm?: ArrayBuffer;
  meta?: PrimeTtsMeta;
  text?: string;
  phoneIds?: number[];
  toneIds?: number[];
  langIds?: number[];
  rate?: number;
};

let runtime: PrimeTtsRuntime | null = null;

workerSelf.onmessage = (event: MessageEvent<PrimeTtsWorkerMessage>) => {
  void handleMessage(event.data);
};

async function handleMessage(message: PrimeTtsWorkerMessage): Promise<void> {
  try {
    if (message.type === "init") {
      if (!message.encoder || !message.decoder || !message.vocoder || !message.wasm || !message.meta) {
        throw new Error("PrimeTTS worker init payload is incomplete");
      }
      const wasm = ort.env.wasm;
      wasm.numThreads = 1;
      wasm.proxy = false;
      wasm.wasmPaths = undefined;
      wasm.wasmBinary = message.wasm;
      const options: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"] };
      const [encoder, decoder, vocoder] = await Promise.all([
        ort.InferenceSession.create(message.encoder, options),
        ort.InferenceSession.create(message.decoder, options),
        ort.InferenceSession.create(message.vocoder, options)
      ]);
      runtime = { encoder, decoder, vocoder, meta: message.meta };
      workerSelf.postMessage({ id: message.id, type: "result", buffer: new ArrayBuffer(0) });
      return;
    }
    if (message.type === "synthesize") {
      if (!runtime) throw new Error("PrimeTTS worker is not initialized");
      const ids = typeof message.text === "string"
        ? primeTtsTextToIds(message.text)
        : { phoneIds: message.phoneIds ?? [], toneIds: message.toneIds ?? [], langIds: message.langIds ?? [] };
      if (!ids.phoneIds.length) throw new Error("PrimeTTS frontend produced no phones");
      const buffer = await synthesize(ids.phoneIds, ids.toneIds, ids.langIds, Number(message.rate) || 1);
      workerSelf.postMessage({ id: message.id, type: "result", buffer }, [buffer]);
      return;
    }
  } catch (error) {
    workerSelf.postMessage({ id: message.id, type: "error", error: error instanceof Error ? error.message : String(error) });
  }
}

function int64Tensor(values: number[], dims: readonly number[]): ort.Tensor {
  return new ort.Tensor("int64", BigInt64Array.from(values.map((value) => BigInt(value))), dims);
}

function requireTensor(value: ort.Tensor | undefined, name: string): OrtTensorLike {
  if (!value || !Array.isArray(value.dims) || !("data" in value)) {
    throw new Error(`PrimeTTS missing ONNX tensor: ${name}`);
  }
  return value as unknown as OrtTensorLike;
}

async function synthesize(phoneIds: number[], toneIds: number[], langIds: number[], _rate: number): Promise<ArrayBuffer> {
  if (!runtime) throw new Error("PrimeTTS worker is not initialized");
  const { encoder, decoder, vocoder, meta } = runtime;
  const phone = int64Tensor(phoneIds, [1, phoneIds.length]);
  const tone = int64Tensor(toneIds, [1, toneIds.length]);
  const lang = int64Tensor(langIds, [1, langIds.length]);
  const speaker = int64Tensor([0], [1]);
  const encoded = await encoder.run({ phone, tone, lang, speaker });
  const conditioned = requireTensor(encoded.conditioned, "conditioned");
  const durations = requireTensor(encoded.durations, "durations");
  const pitch = requireTensor(encoded.pitch, "pitch");
  const regulated = primeTtsHostRegulate(conditioned, durations, pitch, meta.abs_frame_bins, meta.max_frames);
  const mel = await decoder.run({
    frames: new ort.Tensor("float32", regulated.frames, [1, regulated.frameCount, regulated.hiddenSize]),
    frame_meta: new ort.Tensor("float32", regulated.frameMeta, [1, regulated.frameCount, 8]),
    local_ctx_raw: new ort.Tensor("float32", regulated.localCtxRaw, [1, regulated.frameCount, regulated.hiddenSize * 3]),
    abs_pos: new ort.Tensor("int64", regulated.absPos, [1, regulated.frameCount]),
    pitch_frame: new ort.Tensor("float32", regulated.pitchFrame, [1, regulated.frameCount, regulated.pitchSize]),
    frame_mask: new ort.Tensor("bool", regulated.frameMask, [1, regulated.frameCount])
  });
  const wavResult = await vocoder.run({ mel: requireTensor(mel.mel, "mel") as unknown as ort.Tensor });
  const wavTensor = requireTensor(wavResult.wav, "wav");
  if (!(wavTensor.data instanceof Float32Array)) throw new Error("PrimeTTS vocoder returned non-float audio");
  return encodePcm16Wav(finalizePrimeTtsSamples(wavTensor.data, meta.sample_rate), meta.sample_rate);
}

function primeTtsHostRegulate(
  conditioned: OrtTensorLike,
  durations: OrtTensorLike,
  pitch: OrtTensorLike,
  absBins: number,
  maxFrames: number
): {
  frameCount: number;
  hiddenSize: number;
  pitchSize: number;
  frames: Float32Array;
  frameMeta: Float32Array;
  localCtxRaw: Float32Array;
  absPos: BigInt64Array;
  pitchFrame: Float32Array;
  frameMask: boolean[];
} {
  if (!(conditioned.data instanceof Float32Array)) throw new Error("PrimeTTS conditioned tensor is not float32");
  if (!(pitch.data instanceof Float32Array)) throw new Error("PrimeTTS pitch tensor is not float32");
  const condDims = conditioned.dims;
  const pitchDims = pitch.dims;
  if (condDims.length !== 3 || pitchDims.length !== 3) throw new Error("PrimeTTS encoder returned unexpected tensor rank");
  const tokenCount = condDims[1];
  const hiddenSize = condDims[2];
  const pitchSize = pitchDims[2];
  const durationValues = ortTensorDataToNumbers(durations.data).map((value) => Math.max(0, value));
  const boundedDurations = durationValues.slice(0, tokenCount);
  let frameCount = boundedDurations.reduce((sum, value) => sum + value, 0);
  if (frameCount <= 0) throw new Error("PrimeTTS encoder produced no audio frames");
  if (frameCount > maxFrames) {
    let used = 0;
    for (let index = 0; index < boundedDurations.length; index += 1) {
      const remaining = Math.max(0, maxFrames - used);
      boundedDurations[index] = Math.min(boundedDurations[index], remaining);
      used += boundedDurations[index];
    }
    frameCount = Math.max(1, used);
  }
  const cond = conditioned.data;
  const pitchData = pitch.data;
  const frames = new Float32Array(frameCount * hiddenSize);
  const frameMeta = new Float32Array(frameCount * 8);
  const localCtxRaw = new Float32Array(frameCount * hiddenSize * 3);
  const absPos = new BigInt64Array(frameCount);
  const pitchFrame = new Float32Array(frameCount * pitchSize);
  const frameMask = Array.from({ length: frameCount }, () => true);
  const voicedTokenCount = Math.max(1, boundedDurations.filter((value) => value > 0).length);
  let frameIndex = 0;
  for (let tokenIndex = 0; tokenIndex < tokenCount; tokenIndex += 1) {
    const duration = boundedDurations[tokenIndex] ?? 0;
    for (let within = 0; within < duration; within += 1) {
      const condOffset = tokenIndex * hiddenSize;
      const frameOffset = frameIndex * hiddenSize;
      frames.set(cond.subarray(condOffset, condOffset + hiddenSize), frameOffset);
      const rel = within / Math.max(duration - 1, 1);
      const tokenPos = tokenIndex / Math.max(voicedTokenCount - 1, 1);
      const logDuration = Math.log1p(duration) / 6;
      const center = 1 - Math.abs(rel * 2 - 1);
      frameMeta.set([rel, 1 - rel, center, Math.sin(rel * Math.PI), Math.cos(rel * Math.PI), tokenPos, logDuration, duration / 40], frameIndex * 8);
      const prevIndex = Math.max(0, tokenIndex - 1);
      const nextIndex = Math.min(tokenCount - 1, tokenIndex + 1);
      const localOffset = frameIndex * hiddenSize * 3;
      localCtxRaw.set(cond.subarray(prevIndex * hiddenSize, prevIndex * hiddenSize + hiddenSize), localOffset);
      localCtxRaw.set(cond.subarray(condOffset, condOffset + hiddenSize), localOffset + hiddenSize);
      localCtxRaw.set(cond.subarray(nextIndex * hiddenSize, nextIndex * hiddenSize + hiddenSize), localOffset + hiddenSize * 2);
      absPos[frameIndex] = BigInt(Math.min(Math.floor(frameIndex * absBins / Math.max(1, maxFrames)), absBins - 1));
      pitchFrame.set(pitchData.subarray(tokenIndex * pitchSize, tokenIndex * pitchSize + pitchSize), frameIndex * pitchSize);
      frameIndex += 1;
      if (frameIndex >= frameCount) break;
    }
    if (frameIndex >= frameCount) break;
  }
  return { frameCount, hiddenSize, pitchSize, frames, frameMeta, localCtxRaw, absPos, pitchFrame, frameMask };
}

function finalizePrimeTtsSamples(samples: Float32Array, sampleRate: number): Float32Array {
  if (!samples.length || !Number.isFinite(sampleRate) || sampleRate <= 0) return samples;
  let sum = 0;
  for (const sample of samples) sum += sample;
  const dc = sum / samples.length;
  const normalized = new Float32Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    normalized[index] = Math.max(-1, Math.min(1, samples[index] - dc));
  }
  const voiced = trimPrimeTtsEdgeSilence(normalized, sampleRate);
  const tailSamples = Math.max(0, Math.round(sampleRate * PRIME_TTS_TAIL_SILENCE_MS / 1000));
  const output = new Float32Array(voiced.length + tailSamples);
  output.set(voiced);
  applyPrimeTtsEdgeEnvelope(output, sampleRate, voiced.length);
  return output;
}

function trimPrimeTtsEdgeSilence(samples: Float32Array, sampleRate: number): Float32Array {
  if (samples.length < 8 || !Number.isFinite(sampleRate) || sampleRate <= 0) return samples;
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak <= 0.0001) return samples;
  const threshold = Math.max(0.0025, peak * 0.018);
  let start = 0;
  while (start < samples.length && Math.abs(samples[start]) < threshold) start += 1;
  let end = samples.length - 1;
  while (end > start && Math.abs(samples[end]) < threshold) end -= 1;
  if (start <= 0 && end >= samples.length - 1) return samples;
  const startPad = Math.round(sampleRate * 0.003);
  const endPad = Math.round(sampleRate * 0.005);
  const from = Math.max(0, start - startPad);
  const to = Math.min(samples.length, end + endPad + 1);
  if (to - from < Math.min(samples.length, Math.round(sampleRate * 0.025))) return samples;
  return samples.slice(from, to);
}

function applyPrimeTtsEdgeEnvelope(samples: Float32Array, sampleRate: number, voicedLength: number): void {
  const fadeInSamples = Math.min(voicedLength, Math.max(1, Math.round(sampleRate * PRIME_TTS_FADE_IN_MS / 1000)));
  const fadeOutSamples = Math.min(voicedLength, Math.max(1, Math.round(sampleRate * PRIME_TTS_FADE_OUT_MS / 1000)));
  for (let index = 0; index < fadeInSamples; index += 1) {
    samples[index] *= (index + 1) / fadeInSamples;
  }
  const fadeStart = Math.max(0, voicedLength - fadeOutSamples);
  for (let index = fadeStart; index < voicedLength; index += 1) {
    samples[index] *= Math.max(0, (voicedLength - index - 1) / fadeOutSamples);
  }
}

function ortTensorDataToNumbers(data: OrtTensorLike["data"]): number[] {
  if (data instanceof Float32Array) return Array.from(data);
  if (data instanceof BigInt64Array) return Array.from(data, (value) => Number(value));
  return data.map((value) => Number(value));
}

function encodePcm16Wav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const dataBytes = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}
