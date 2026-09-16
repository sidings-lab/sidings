import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// The store resolves its root from the environment at import time, so the
// override must be in place before the module is loaded.
const storeRoot = await mkdtemp(join(tmpdir(), 'sidings-jobs-'))
process.env.SIDINGS_V2_DIR = storeRoot

const {
  createJobQueue,
  eventsAfter,
  generateJobId,
  isTerminalJobStatus,
  isValidJobId,
  toJobSummary,
  JobQueueError
} = await import('../server/utils/job-queue')
type JobExecutor = import('../server/utils/job-queue').JobExecutor
type JobRecord = import('../server/utils/job-queue').JobRecord

const jobsDir = join(storeRoot, 'jobs')

afterAll(async () => {
  await rm(storeRoot, { recursive: true, force: true })
})

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Fake executor: submit resolves immediately; each waitForCompletion call
 * blocks on a per-job gate the test controls.
 */
function createFakeExecutor() {
  const gates = new Map<string, Deferred<import('../server/utils/job-queue').JobResult | undefined>>()
  const submitted: string[] = []
  const cancelled: string[] = []

  const gate = (jobId: string) => {
    let entry = gates.get(jobId)
    if (!entry) {
      entry = deferred()
      gates.set(jobId, entry)
    }
    return entry
  }

  const executor: JobExecutor = {
    async submit(job) {
      submitted.push(job.id)
    },
    async waitForCompletion(job) {
      return gate(job.id).promise
    },
    cancel(job) {
      cancelled.push(job.id)
    }
  }

  return {
    executor,
    submitted,
    cancelled,
    finish: (jobId: string, result?: import('../server/utils/job-queue').JobResult) => gate(jobId).resolve(result),
    fail: (jobId: string, error: Error) => gate(jobId).reject(error)
  }
}

function eventTypes(job: JobRecord) {
  return job.events.map((event) => event.type)
}

async function until(predicate: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

describe('job lifecycle', () => {
  test('queued → running → done with monotonic event sequence', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-lifecycle-1', provider: 'claude', prompt: 'hello' })
    expect(job.status).toBe('queued')
    expect(eventTypes(job)).toEqual(['queued'])

    await until(() => job.status === 'running')
    expect(job.startedAt).toBeString()
    await until(() => fake.submitted.includes(job.id))

    fake.finish(job.id, { lastAssistantMessage: 'done!' })
    const finished = await queue.waitForJob(job.id)

    expect(finished.status).toBe('done')
    expect(finished.finishedAt).toBeString()
    expect(finished.result).toEqual({ lastAssistantMessage: 'done!' })
    expect(eventTypes(finished)).toEqual(['queued', 'running', 'submitted', 'done'])
    const seqs = finished.events.map((event) => event.seq)
    expect(seqs).toEqual([1, 2, 3, 4])
  })

  test('a submit failure marks the job failed with the error message', async () => {
    const fake = createFakeExecutor()
    fake.executor.submit = async () => {
      throw new Error('tmux session "x" is not running')
    }
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-fail-1', provider: 'codex', prompt: 'boom' })
    const finished = await queue.waitForJob(job.id)

    expect(finished.status).toBe('failed')
    expect(finished.error).toContain('tmux session "x" is not running')
    expect(eventTypes(finished)).toEqual(['queued', 'running', 'failed'])
  })

  test('a job that never completes fails on the hard timeout', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir, timeoutMs: 40 })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-timeout-1', provider: 'claude', prompt: 'hang' })
    const finished = await queue.waitForJob(job.id)

    expect(finished.status).toBe('failed')
    expect(finished.error).toContain('timed out')
  })
})

describe('per-session serialization', () => {
  test('runs one job at a time per session, in order', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const first = queue.enqueue({ sessionId: 'sess-serial-1', provider: 'claude', prompt: 'one' })
    const second = queue.enqueue({ sessionId: 'sess-serial-1', provider: 'claude', prompt: 'two' })

    await until(() => first.status === 'running')
    // The second job must wait for the first to finish.
    expect(second.status).toBe('queued')
    expect(fake.submitted).toEqual([first.id])

    fake.finish(first.id)
    await until(() => second.status === 'running')
    expect(fake.submitted).toEqual([first.id, second.id])

    fake.finish(second.id)
    await queue.waitForJob(second.id)
    expect(first.status).toBe('done')
    expect(second.status).toBe('done')
  })

  test('jobs on different sessions run concurrently', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const a = queue.enqueue({ sessionId: 'sess-conc-a', provider: 'claude', prompt: 'a' })
    const b = queue.enqueue({ sessionId: 'sess-conc-b', provider: 'codex', prompt: 'b' })

    await until(() => a.status === 'running' && b.status === 'running')

    fake.finish(a.id)
    fake.finish(b.id)
    await Promise.all([queue.waitForJob(a.id), queue.waitForJob(b.id)])
  })
})

describe('cursor-based replay', () => {
  test('eventsAfter returns only events with seq greater than the cursor', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-cursor-1', provider: 'claude', prompt: 'events' })
    await until(() => job.events.length >= 3)
    fake.finish(job.id)
    const finished = await queue.waitForJob(job.id)

    expect(eventsAfter(finished, 0).map((e) => e.seq)).toEqual([1, 2, 3, 4])
    expect(eventsAfter(finished, 2).map((e) => e.seq)).toEqual([3, 4])
    expect(eventsAfter(finished, 4)).toEqual([])
    expect(eventsAfter(finished, 99)).toEqual([])
    // Non-positive and non-finite cursors replay everything.
    expect(eventsAfter(finished, Number.NaN).length).toBe(4)
  })

  test('toJobSummary strips the event buffer and reports the count', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-summary-1', provider: 'claude', prompt: 'sum' })
    fake.finish(job.id)
    const finished = await queue.waitForJob(job.id)

    const summary = toJobSummary(finished)
    expect(summary.eventCount).toBe(finished.events.length)
    expect('events' in summary).toBe(false)
    expect(summary.id).toBe(finished.id)
  })
})

describe('cancellation', () => {
  test('cancelling a queued job prevents it from ever running', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const first = queue.enqueue({ sessionId: 'sess-cancel-1', provider: 'claude', prompt: 'one' })
    const second = queue.enqueue({ sessionId: 'sess-cancel-1', provider: 'claude', prompt: 'two' })
    await until(() => first.status === 'running')

    const cancelled = await queue.cancel(second.id)
    expect(cancelled.status).toBe('cancelled')
    // Escape is only sent for running jobs.
    expect(fake.cancelled).toEqual([])

    fake.finish(first.id)
    await queue.waitForJob(first.id)
    // Give the chain a chance to (incorrectly) start the cancelled job.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(fake.submitted).toEqual([first.id])
    expect(second.status).toBe('cancelled')
    expect(eventTypes(second)).toEqual(['queued', 'cancelled'])
  })

  test('cancelling a running job interrupts it and a late completion is ignored', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-cancel-2', provider: 'codex', prompt: 'stop me' })
    // Wait past the submit so the 'submitted' event is in the buffer.
    await until(() => job.events.some((event) => event.type === 'submitted'))

    const cancelled = await queue.cancel(job.id)
    expect(cancelled.status).toBe('cancelled')
    expect(fake.cancelled).toEqual([job.id])
    expect(eventTypes(job)).toEqual(['queued', 'running', 'submitted', 'cancelled'])

    // The executor resolving afterwards must not flip the status to done.
    fake.finish(job.id, { lastAssistantMessage: 'too late' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(job.status).toBe('cancelled')
    expect(job.result).toBeUndefined()
  })

  test('cancelling a finished job throws not_cancellable', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-cancel-3', provider: 'claude', prompt: 'done' })
    fake.finish(job.id)
    await queue.waitForJob(job.id)

    expect(queue.cancel(job.id)).rejects.toThrow(JobQueueError)
  })
})

describe('persistence and restart reconciliation', () => {
  test('finished jobs are persisted to disk and readable by a fresh queue', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-persist-1', provider: 'claude', prompt: 'save me' })
    fake.finish(job.id, { lastAssistantMessage: 'saved' })
    await queue.waitForJob(job.id)

    // Persist writes are chained asynchronously; poll until the final state
    // reaches the disk file.
    let persisted: JobRecord | undefined
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && persisted?.status !== 'done') {
      try {
        const raw = await readFile(join(jobsDir, `${job.id}.json`), 'utf8')
        persisted = JSON.parse(raw) as JobRecord
      } catch {
        persisted = undefined
      }
      if (persisted?.status !== 'done') await new Promise((resolve) => setTimeout(resolve, 10))
    }
    expect(persisted?.status).toBe('done')
    expect(persisted?.result).toEqual({ lastAssistantMessage: 'saved' })
    expect(persisted?.events.length).toBe(job.events.length)

    // A fresh queue (new process simulation) can read it from disk.
    const fresh = createJobQueue({ executor: createFakeExecutor().executor, jobsDir })
    await fresh.ready
    const loaded = await fresh.getJob(job.id)
    expect(loaded?.status).toBe('done')
    expect(loaded?.prompt).toBe('save me')
  })

  test('queued/running jobs found on disk are failed as interrupted by restart', async () => {
    const staleDir = join(storeRoot, 'jobs-restart')
    await mkdir(staleDir, { recursive: true })
    const staleId = generateJobId()
    const stale: JobRecord = {
      id: staleId,
      sessionId: 'sess-restart-1',
      provider: 'claude',
      prompt: 'orphaned',
      status: 'running',
      events: [
        { seq: 1, type: 'queued', at: new Date().toISOString() },
        { seq: 2, type: 'running', at: new Date().toISOString() }
      ],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString()
    }
    await writeFile(join(staleDir, `${staleId}.json`), JSON.stringify(stale))

    const queue = createJobQueue({ executor: createFakeExecutor().executor, jobsDir: staleDir })
    await queue.ready

    const reconciled = await queue.getJob(staleId)
    expect(reconciled?.status).toBe('failed')
    expect(reconciled?.error).toBe('interrupted by restart')
    expect(reconciled?.finishedAt).toBeString()
    expect(reconciled?.events.at(-1)?.type).toBe('failed')
    expect(reconciled?.events.at(-1)?.seq).toBe(3)
    expect(isTerminalJobStatus(reconciled!.status)).toBe(true)
  })

  test('listJobs returns newest first without exceeding the limit', async () => {
    const listDir = join(storeRoot, 'jobs-list')
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir: listDir })
    await queue.ready

    const jobs: JobRecord[] = []
    for (let i = 0; i < 3; i++) {
      const job = queue.enqueue({ sessionId: `sess-list-${i}`, provider: 'claude', prompt: `p${i}` })
      job.createdAt = new Date(Date.now() + i * 1000).toISOString()
      jobs.push(job)
      fake.finish(job.id)
    }
    await Promise.all(jobs.map((job) => queue.waitForJob(job.id)))

    const all = await queue.listJobs(100)
    expect(all.map((job) => job.id)).toEqual([jobs[2]!.id, jobs[1]!.id, jobs[0]!.id])

    const limited = await queue.listJobs(2)
    expect(limited.length).toBe(2)
    expect(limited[0]!.id).toBe(jobs[2]!.id)
  })
})

describe('event subscription', () => {
  test('onJobEvent streams events live and unsubscribes cleanly', async () => {
    const fake = createFakeExecutor()
    const queue = createJobQueue({ executor: fake.executor, jobsDir })
    await queue.ready

    const job = queue.enqueue({ sessionId: 'sess-subscribe-1', provider: 'claude', prompt: 'live' })
    const seen: string[] = []
    const unsubscribe = queue.onJobEvent(job.id, (_job, event) => {
      seen.push(`${event.seq}:${event.type}`)
    })

    fake.finish(job.id)
    await queue.waitForJob(job.id)
    expect(seen).toEqual(['2:running', '3:submitted', '4:done'])

    unsubscribe()
    // No further callbacks after unsubscribe (nothing should throw either).
    expect(seen.length).toBe(3)
  })
})

describe('job id validation', () => {
  test('generated ids validate and path-hostile ids are rejected', () => {
    expect(isValidJobId(generateJobId())).toBe(true)
    expect(isValidJobId('../etc/passwd')).toBe(false)
    expect(isValidJobId('job with spaces')).toBe(false)
    expect(isValidJobId('')).toBe(false)
    expect(isValidJobId(42)).toBe(false)
  })
})
