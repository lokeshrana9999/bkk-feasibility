// Main-thread side of the engine worker. At most one request is in flight; while it runs,
// newer inputs replace each other and only the latest is sent next. So a vertex drag at 60 Hz
// never queues stale work, and results arrive in input order.

import type { EngineInput, EngineOutput } from '../engine/types';
import type { WorkerRequest, WorkerResponse } from './engine.worker';

export type ResultHandler = (out: EngineOutput, ms: number, input: EngineInput) => void;

export class EngineClient {
  private worker: Worker;
  private busy = false;
  private pending: EngineInput | null = null;
  private seq = 0;
  private inFlight: { id: number; input: EngineInput } | null = null;

  constructor(private onResult: ResultHandler, private onError: (msg: string) => void) {
    this.worker = this.spawn();
  }

  private spawn(): Worker {
    const w = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const req = this.inFlight;
      this.busy = false;
      this.inFlight = null;
      if (req && e.data.id === req.id) this.onResult(e.data.out, e.data.ms, req.input);
      this.flush();
    };
    w.onerror = (e) => {
      e.preventDefault();
      this.busy = false;
      this.inFlight = null;
      this.onError(`engine worker crashed: ${e.message || 'unknown error'}; restarted`);
      this.worker.terminate();
      this.worker = this.spawn();
      this.flush();
    };
    return w;
  }

  run(input: EngineInput) {
    this.pending = input;
    this.flush();
  }

  private flush() {
    if (this.busy || !this.pending) return;
    const input = this.pending;
    this.pending = null;
    this.busy = true;
    const req: WorkerRequest = { id: ++this.seq, input };
    this.inFlight = { id: req.id, input };
    this.worker.postMessage(req);
  }

  dispose() {
    this.worker.terminate();
  }
}
