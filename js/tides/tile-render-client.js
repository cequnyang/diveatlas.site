export function createTideTileRenderer() {
  if (typeof Worker !== 'function') throw new Error('Tide rendering requires Web Worker support.');

  let worker = null;
  let activeJob = null;
  let nextJobId = 0;
  let failed = false;
  const queue = [];
  const jobsByCanvas = new WeakMap();

  function finish(job, error, result) {
    if (job.finished) return;
    job.finished = true;
    if (jobsByCanvas.get(job.canvas) === job) jobsByCanvas.delete(job.canvas);
    job.done(error, result);
  }

  function failWorker(error) {
    failed = true;
    worker?.terminate();
    worker = null;
    const stranded = [activeJob, ...queue].filter(Boolean);
    activeJob = null;
    queue.length = 0;
    for (const job of stranded) finish(job, error);
  }

  function ensureWorker() {
    if (failed) throw new Error('Tide rendering worker is unavailable.');
    if (worker) return worker;
    worker = new Worker(new URL('./tile-render-worker.js?v=1', import.meta.url), { type: 'module', name: 'diveatlas-tide-render' });
    worker.addEventListener('message', event => {
      const job = activeJob;
      if (!job || event.data.id !== job.id) return;
      activeJob = null;
      if (!job.cancelled) finish(job, event.data.error ? new Error(event.data.error) : null, event.data);
      dispatch();
    });
    worker.addEventListener('error', event => failWorker(event.error || new Error(event.message || 'Tide rendering worker failed.')));
    worker.addEventListener('messageerror', () => failWorker(new Error('Tide rendering worker returned unreadable data.')));
    return worker;
  }

  function dispatch() {
    if (activeJob || !queue.length || failed) return;
    try {
      const instance = ensureWorker();
      activeJob = queue.shift();
      instance.postMessage({ id: activeJob.id, ...activeJob.payload });
    } catch (error) {
      failWorker(error);
    }
  }

  function render(canvas, payload, done) {
    const job = { id: ++nextJobId, canvas, payload, done, cancelled: false, finished: false };
    jobsByCanvas.set(canvas, job);
    queue.push(job);
    dispatch();
  }

  function cancel(canvas) {
    const job = jobsByCanvas.get(canvas);
    if (!job || job.finished) return;
    job.cancelled = true;
    const queuedIndex = queue.indexOf(job);
    if (queuedIndex >= 0) queue.splice(queuedIndex, 1);
    // Ignore an obsolete in-flight tile but let its worker finish: terminating
    // here would discard warmed model chunks and repeatedly restart heavy work
    // during a drag. The map thread never waits for this result.
    finish(job, null, null);
    dispatch();
  }

  return { render, cancel };
}
