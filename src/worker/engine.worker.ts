/// <reference lib="webworker" />
// Runs the pure engine off the main thread. One message in, one message out.

import { evaluate } from '../engine/evaluate';
import type { EngineInput, EngineOutput } from '../engine/types';

export interface WorkerRequest {
  id: number;
  input: EngineInput;
}
export interface WorkerResponse {
  id: number;
  out: EngineOutput;
  ms: number;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const t0 = performance.now();
  const out = evaluate(e.data.input);
  const res: WorkerResponse = { id: e.data.id, out, ms: performance.now() - t0 };
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(res);
};
