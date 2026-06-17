const { Readable } = require('stream');
const ReadAheadStream = require('../../../lib/ReadAheadStream');

// Helper: build a Readable that emits the given Buffer in fixed-size chunks
function makeReadable(buf, emitChunkSize = buf.length) {
  let offset = 0;
  return new Readable({
    read() {
      if (offset >= buf.length) { this.push(null); return; }
      const end = Math.min(offset + emitChunkSize, buf.length);
      this.push(buf.slice(offset, end));
      offset = end;
    }
  });
}

/**
 * Full-drain helper that mirrors the uploadLargeFileInChunks loop:
 * readBytes returns -1 when the current internal buffer is exhausted AND
 * lastChunkLoaded is true, even if the queue still has more chunks.
 * The caller is responsible for draining those remaining queue items.
 */
async function drainAllBytes(ras) {
  const chunks = [];
  const tmp = Buffer.allocUnsafe(ras.chunkSize);
  while (true) {
    let n = await ras.readBytes(tmp, 0, ras.chunkSize);
    // -1 with data still in queue = "premature EOF" — drain the queue
    if (n === -1 && !ras.isChunkQueueEmpty()) {
      const queued = await ras.getLastChunkFromQueue();
      if (queued && queued.length > 0) { chunks.push(Buffer.from(queued)); }
      continue;
    }
    if (n <= 0) break;
    chunks.push(Buffer.from(tmp.slice(0, n)));
  }
  return Buffer.concat(chunks);
}

describe('ReadAheadStream', () => {
  describe('constructor', () => {
    it('throws when source is null', () => {
      expect(() => new ReadAheadStream(null, 100)).toThrow('InputStream cannot be null');
    });

    it('throws when source is undefined', () => {
      expect(() => new ReadAheadStream(undefined, 100)).toThrow('InputStream cannot be null');
    });

    it('accepts a Buffer as source', () => {
      const ras = new ReadAheadStream(Buffer.from('hello'), 5);
      expect(ras).toBeDefined();
    });

    it('accepts a Readable stream as source', () => {
      const stream = makeReadable(Buffer.from('hello'));
      const ras = new ReadAheadStream(stream, 5);
      expect(ras).toBeDefined();
    });

    it('sets default chunkSize to 20 MB when not provided', () => {
      const ras = new ReadAheadStream(Buffer.alloc(1), 1);
      expect(ras.chunkSize).toBe(20 * 1024 * 1024);
    });

    it('respects a custom chunkSize', () => {
      const ras = new ReadAheadStream(Buffer.alloc(1), 1, 512);
      expect(ras.chunkSize).toBe(512);
    });
  });

  describe('Buffer source — happy path', () => {
    it('reads a single-chunk Buffer completely via readBytes', async () => {
      const content = Buffer.from('Hello!'); // 6 bytes — fits in one chunk of size 8
      const ras = new ReadAheadStream(content, content.length, 8);
      await ras.startReading();

      const tmp = Buffer.allocUnsafe(8);
      const n = await ras.readBytes(tmp, 0, 8);
      await ras.close();

      expect(n).toBe(6);
      expect(tmp.slice(0, n).toString()).toBe('Hello!');
    });

    it('reads a multi-chunk Buffer and reassembles it with drainAllBytes', async () => {
      // Design note: readBytes returns -1 when currentBuffer is exhausted AND
      // lastChunkLoaded is true, even if the queue still has data. The caller
      // drains remaining queue items (matching the uploadLargeFileInChunks pattern).
      const content = Buffer.from('ABCDEFGHIJ'); // 10 bytes, 3 chunks of 4/4/2
      const ras = new ReadAheadStream(content, content.length, 4);
      await ras.startReading();

      const result = await drainAllBytes(ras);
      await ras.close();

      expect(result.toString()).toBe('ABCDEFGHIJ');
    });

    it('returns -1 after currentBuffer is exhausted (lastChunkLoaded=true)', async () => {
      const content = Buffer.from('AB'); // single chunk
      const ras = new ReadAheadStream(content, content.length, 8);
      await ras.startReading();

      const tmp = Buffer.allocUnsafe(8);
      await ras.readBytes(tmp, 0, 8); // reads 'AB'
      const eof = await ras.readBytes(tmp, 0, 8);
      await ras.close();

      expect(eof).toBe(-1);
    });

    it('leaves remaining chunks in queue when returning premature -1', async () => {
      // 2 chunks: [ABCD] and [EF]; startReading primes currentBuffer with chunk1
      const content = Buffer.from('ABCDEF');
      const ras = new ReadAheadStream(content, content.length, 4);
      await ras.startReading();

      const tmp = Buffer.allocUnsafe(4);
      const n1 = await ras.readBytes(tmp, 0, 4); // reads chunk1 = ABCD
      const n2 = await ras.readBytes(tmp, 0, 4); // currentBuffer exhausted, lastChunkLoaded → -1

      expect(n1).toBe(4);
      expect(n2).toBe(-1);
      // chunk2 is still available in the queue
      expect(ras.isChunkQueueEmpty()).toBe(false);
      await ras.close();
    });

    it('queues at most maxQueueSize chunks at a time', async () => {
      const CHUNK = 2;
      const content = Buffer.alloc(20); // 10 chunks of 2 bytes
      const ras = new ReadAheadStream(content, content.length, CHUNK);
      await ras.startReading();
      expect(ras.chunkQueue.length).toBeLessThanOrEqual(ras.maxQueueSize);
      await ras.close();
    });
  });

  describe('Readable stream source — happy path', () => {
    it('reads all bytes from a Readable stream via drainAllBytes', async () => {
      const content = Buffer.from('StreamData');
      const stream = makeReadable(content, 3); // emit 3 bytes at a time
      const ras = new ReadAheadStream(stream, content.length, 5);
      await ras.startReading();

      const result = await drainAllBytes(ras);
      await ras.close();

      expect(result.toString()).toBe('StreamData');
    });
  });

  describe('isEOFReached / isChunkQueueEmpty', () => {
    it('isChunkQueueEmpty returns true when queue is drained', async () => {
      const content = Buffer.from('xy');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();
      ras.chunkQueue = []; // drain manually
      expect(ras.isChunkQueueEmpty()).toBe(true);
      await ras.close();
    });

    it('isEOFReached returns true after all data is consumed', async () => {
      const content = Buffer.from('done');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();

      const tmp = Buffer.allocUnsafe(10);
      await ras.readBytes(tmp, 0, 10);
      await ras.close();

      expect(ras.isEOFReached()).toBe(true);
    });
  });

  describe('_shouldRetryReadError', () => {
    it('returns true for EOFException messages', () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      expect(ras._shouldRetryReadError(new Error('EOFException occurred'))).toBe(true);
    });

    it('returns true for InsufficientDataException messages', () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      expect(ras._shouldRetryReadError(new Error('InsufficientDataException: Read returned 0 bytes'))).toBe(true);
    });

    it('returns false for generic errors', () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      expect(ras._shouldRetryReadError(new Error('network timeout'))).toBe(false);
    });

    it('returns false for null', () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      expect(ras._shouldRetryReadError(null)).toBe(false);
    });
  });

  describe('getLastChunkFromQueue', () => {
    it('returns a queued chunk if one exists', async () => {
      const content = Buffer.from('ABCD');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();

      const known = Buffer.from('XY');
      ras.chunkQueue.push(known);

      const result = await ras.getLastChunkFromQueue();
      expect(result.length).toBeGreaterThan(0);
      await ras.close();
    });

    it('returns empty buffer when queue is empty and times out', async () => {
      const ras = new ReadAheadStream(Buffer.from('A'), 1, 10);
      await ras.startReading();
      ras.chunkQueue = [];
      ras.lastChunkLoaded = true;

      const result = await ras.getLastChunkFromQueue();
      expect(result.length).toBe(0);
      await ras.close();
    });
  });

  describe('readBytes — error propagation', () => {
    it('throws when readError is set', async () => {
      const ras = new ReadAheadStream(Buffer.from('data'), 4, 10);
      await ras.startReading();

      ras.readError = new Error('injected read error');
      const tmp = Buffer.allocUnsafe(10);
      await expect(ras.readBytes(tmp, 0, 10)).rejects.toThrow('injected read error');
      await ras.close();
    });
  });

  describe('_readFromStream', () => {
    it('rejects immediately when stream is destroyed', async () => {
      const stream = makeReadable(Buffer.from('data'));
      stream.destroy();
      const ras = new ReadAheadStream(stream, 4, 4);

      const buf = Buffer.allocUnsafe(4);
      await expect(ras._readFromStream(stream, buf, 0, 4)).rejects.toThrow('Stream is closed or aborted');
    });

    it('resolves -1 when stream has readableEnded=true and destroyed=false', async () => {
      // Use autoDestroy: false so the stream is not destroyed after 'end'
      const stream = new Readable({ read() {}, autoDestroy: false });
      stream.push(Buffer.from('hi'));
      stream.push(null);
      await new Promise(resolve => stream.resume().once('end', resolve));

      expect(stream.readableEnded).toBe(true);
      expect(stream.destroyed).toBe(false);

      const ras = new ReadAheadStream(stream, 2, 10);
      const buf = Buffer.allocUnsafe(10);
      const result = await ras._readFromStream(stream, buf, 0, 10);
      expect(result).toBe(-1);
    });

    it('rejects on stream close event (client disconnect)', done => {
      const stream = new Readable({ read() {} });
      const ras = new ReadAheadStream(stream, 100, 10);
      const buf = Buffer.allocUnsafe(10);

      ras._readFromStream(stream, buf, 0, 10).catch(err => {
        expect(err.message).toBe('Stream closed by client disconnect');
        done();
      });

      setImmediate(() => stream.emit('close'));
    });

    it('rejects on stream aborted event', done => {
      const stream = new Readable({ read() {} });
      const ras = new ReadAheadStream(stream, 100, 10);
      const buf = Buffer.allocUnsafe(10);

      ras._readFromStream(stream, buf, 0, 10).catch(err => {
        expect(err.message).toBe('Request aborted by client');
        done();
      });

      setImmediate(() => stream.emit('aborted'));
    });

    it('rejects on stream error event', done => {
      const stream = new Readable({ read() {} });
      const ras = new ReadAheadStream(stream, 100, 10);
      const buf = Buffer.allocUnsafe(10);

      ras._readFromStream(stream, buf, 0, 10).catch(err => {
        expect(err.message).toBe('upstream error');
        done();
      });

      setImmediate(() => stream.emit('error', new Error('upstream error')));
    });

    it('resolves -1 on stream end event', done => {
      const stream = new Readable({ read() {} });
      const ras = new ReadAheadStream(stream, 100, 10);
      const buf = Buffer.allocUnsafe(10);

      ras._readFromStream(stream, buf, 0, 10).then(result => {
        expect(result).toBe(-1);
        done();
      });

      setImmediate(() => stream.emit('end'));
    });

    it('resolves with bytes written when chunk is immediately available', async () => {
      const stream = makeReadable(Buffer.from('hello'), 5);
      const ras = new ReadAheadStream(stream, 5, 10);
      const buf = Buffer.allocUnsafe(10);

      const result = await ras._readFromStream(stream, buf, 0, 5);
      expect(result).toBe(5);
      expect(buf.slice(0, 5).toString()).toBe('hello');
    });
  });

  describe('startReading — idempotence', () => {
    it('calling startReading twice does not double-preload', async () => {
      const content = Buffer.from('once');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();
      await ras.startReading(); // second call is a no-op
      expect(ras.isReading).toBe(true);
      await ras.close();
    });
  });

  describe('close', () => {
    it('clears the chunk queue on close', async () => {
      const content = Buffer.from('close-me');
      const ras = new ReadAheadStream(content, content.length, 2);
      await ras.startReading();
      await ras.close();
      expect(ras.chunkQueue).toHaveLength(0);
    });

    it('destroys a Readable source on close', async () => {
      const stream = makeReadable(Buffer.from('destroy-me'), 2);
      const ras = new ReadAheadStream(stream, 10, 2);
      await ras.startReading();
      await ras.close();
      expect(stream.destroyed).toBe(true);
    });

    it('does not throw when called on an unopened stream', async () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      await expect(ras.close()).resolves.toBeUndefined();
    });
  });

  describe('getRemainingBytes', () => {
    it('returns 0 when totalBytesRead equals totalSize', async () => {
      const content = Buffer.from('ABCDE');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();
      expect(ras.getRemainingBytes()).toBe(0);
      await ras.close();
    });

    it('returns positive value before reading begins', () => {
      const ras = new ReadAheadStream(Buffer.alloc(100), 100, 10);
      expect(ras.getRemainingBytes()).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Coverage gap tests — stream path partial chunk, error branches, aliases
  // ---------------------------------------------------------------------------

  describe('Readable stream source — partial last chunk (lines 97-98)', () => {
    it('copies only bytesRead bytes into finalBuffer when last chunk is smaller than chunkSize', async () => {
      // 7 bytes with chunkSize=5: second chunk is 2 bytes → triggers partial copy (lines 97-98)
      const content = Buffer.from('ABCDEFG');
      // autoDestroy:false so stream isn't destroyed before readBytes' guard runs
      const stream = new Readable({
        read() { this.push(content); this.push(null); },
        autoDestroy: false,
      });
      const ras = new ReadAheadStream(stream, content.length, 5);
      await ras.startReading();

      const result = await drainAllBytes(ras);
      await ras.close();

      expect(result.toString()).toBe('ABCDEFG');
    });
  });

  describe('_preloadChunks — zero bytes / error branches (lines 109-116)', () => {
    it('stops the loop when _readChunk returns 0 bytes (EOF warn branch, line 109)', async () => {
      const stream = makeReadable(Buffer.from('hi'), 2);
      const ras = new ReadAheadStream(stream, 10, 5);
      // Override _readChunk to return 0 → triggers the warn+break branch in _preloadChunks
      ras._readChunk = async () => 0;
      ras._preloadChunks();
      await new Promise(r => setTimeout(r, 30));
      expect(ras.readError).toBeNull();
      await ras.close();
    });

    it('sets readError and emits error when _preloadChunks throws unexpectedly (lines 113-116)', done => {
      const stream = makeReadable(Buffer.from('hi'), 2);
      const ras = new ReadAheadStream(stream, 10, 5);
      ras.isReading = true;

      ras.once('error', err => {
        expect(err.message).toBe('unexpected boom');
        expect(ras.readError).toBeDefined();
        // do not call ras.close() — stream already cleaned up
        done();
      });

      ras._readChunk = async () => { throw new Error('unexpected boom'); };
      ras._preloadChunks();
    });
  });

  describe('_readChunk — retry and max-retry logic (lines 141-156)', () => {
    it('retries on InsufficientDataException and succeeds on second call', async () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1, 10);
      ras._sleep = async () => {}; // skip retry delay

      let calls = 0;
      ras._readFromStream = async (stream, buffer, offset) => {
        calls++;
        if (calls === 1) throw new Error('InsufficientDataException: Read returned 0 bytes');
        Buffer.from('hello').copy(buffer, offset);
        return 5;
      };

      const buf = Buffer.allocUnsafe(10);
      const bytes = await ras._readChunk({}, buf, 0);
      expect(bytes).toBe(10); // loop continues; second call fills 5, third call also returns 5 → chunkSize reached
      expect(calls).toBeGreaterThanOrEqual(2);
    });

    it('throws after maxRetries are exhausted (line 150)', async () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1, 10);
      ras._sleep = async () => {}; // skip retry delay

      ras._readFromStream = async () => { throw new Error('EOFException: always fails'); };

      const buf = Buffer.allocUnsafe(10);
      await expect(ras._readChunk({}, buf, 0))
        .rejects.toThrow(`Failed to read chunk after ${ras.maxRetries} retries`);
    });

    it('re-throws non-retryable errors immediately (line 156)', async () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1, 10);
      ras._readFromStream = async () => { throw new Error('network failure'); };

      const buf = Buffer.allocUnsafe(10);
      await expect(ras._readChunk({}, buf, 0)).rejects.toThrow('network failure');
    });
  });

  describe('_readFromStream — onReadable returns null (line 193)', () => {
    it('resolves 0 when readable event fires but read() still returns null', done => {
      const stream = new Readable({ read() {} });
      const ras = new ReadAheadStream(stream, 100, 10);
      const buf = Buffer.allocUnsafe(10);

      ras._readFromStream(stream, buf, 0, 10).then(result => {
        expect(result).toBe(0);
        done();
      });

      stream.read = () => null;
      setImmediate(() => stream.emit('readable'));
    });
  });

  describe('readNextChunk (lines 240-246)', () => {
    it('returns a chunk once the queue is populated', async () => {
      const content = Buffer.from('ABCD');
      const ras = new ReadAheadStream(content, content.length, 4);
      await ras.startReading();

      ras.chunkQueue.push(Buffer.from('XY'));
      const chunk = await ras.readNextChunk();
      expect(chunk).toBeDefined();
      expect(chunk.length).toBeGreaterThan(0);
      await ras.close();
    });

    it('waits for queue to populate before returning chunk (lines 241-242 poll loop)', async () => {
      const ras = new ReadAheadStream(Buffer.from('A'), 1, 10);
      ras.lastChunkLoaded = false;
      ras.chunkQueue = [];

      // Push a chunk after a short delay so the poll loop at line 241 runs at least once
      setTimeout(() => {
        ras.chunkQueue.push(Buffer.from('Z'));
        ras.lastChunkLoaded = true;
      }, 30);

      const chunk = await ras.readNextChunk();
      expect(chunk).toBeDefined();
    });

    it('returns null when lastChunkLoaded is true and queue is empty', async () => {
      const ras = new ReadAheadStream(Buffer.from('A'), 1, 10);
      await ras.startReading();
      ras.chunkQueue = [];
      ras.lastChunkLoaded = true;

      const result = await ras.readNextChunk();
      expect(result).toBeNull();
      await ras.close();
    });

    it('throws when readError is set (line 244)', async () => {
      const ras = new ReadAheadStream(Buffer.from('A'), 1, 10);
      await ras.startReading();
      ras.readError = new Error('read failed');
      ras.chunkQueue = [];

      await expect(ras.readNextChunk()).rejects.toThrow('read failed');
      await ras.close();
    });
  });

  describe('isEOF and isQueueEmpty aliases (lines 259, 267)', () => {
    it('isEOF() delegates to isEOFReached()', async () => {
      const content = Buffer.from('hi');
      const ras = new ReadAheadStream(content, content.length, 10);
      await ras.startReading();
      const tmp = Buffer.allocUnsafe(10);
      await ras.readBytes(tmp, 0, 10);
      await ras.close();
      expect(ras.isEOF()).toBe(ras.isEOFReached());
    });

    it('isQueueEmpty() delegates to isChunkQueueEmpty()', () => {
      const ras = new ReadAheadStream(Buffer.from('x'), 1);
      expect(ras.isQueueEmpty()).toBe(true);
      ras.chunkQueue.push(Buffer.from('x'));
      expect(ras.isQueueEmpty()).toBe(false);
    });
  });

  describe('_loadNextChunk — destroyed stream throws (lines 276-277)', () => {
    it('throws when source stream is destroyed and queue is empty', async () => {
      const stream = new Readable({ read() {}, autoDestroy: false });
      const ras = new ReadAheadStream(stream, 4, 4);
      // Set state: empty queue, not loaded, destroyed source
      ras.lastChunkLoaded = false;
      ras.chunkQueue = [];
      stream.destroy();

      await expect(ras._loadNextChunk()).rejects.toThrow('Stream closed by client disconnect');
    });
  });

  describe('readBytes — _loadNextChunk path and destroyed-stream guard (lines 297, 301-302)', () => {
    it('calls _loadNextChunk when position >= currentBufferSize and not lastChunkLoaded (line 297)', async () => {
      const content = Buffer.from('ABCDEF');
      const ras = new ReadAheadStream(content, content.length, 3);
      await ras.startReading();

      const tmp = Buffer.allocUnsafe(3);
      await ras.readBytes(tmp, 0, 3); // consumes first chunk

      // Force position to end of buffer and push a new chunk so _loadNextChunk doesn't hang
      ras.position = ras.currentBufferSize;
      ras.lastChunkLoaded = false;
      ras.chunkQueue.unshift(Buffer.from('XY'));

      const n = await ras.readBytes(tmp, 0, 3);
      expect(n).toBeGreaterThan(0);
      ras.lastChunkLoaded = true;
      await ras.close();
    });

    it('throws in readBytes when source stream is destroyed (lines 301-302)', async () => {
      // Use a Readable (not Buffer) source so the guard on line 300 activates
      const stream = new Readable({
        read() { this.push(Buffer.from('hello')); this.push(null); },
        autoDestroy: false,
      });
      const ras = new ReadAheadStream(stream, 5, 10);
      await ras.startReading();

      // currentBuffer is loaded; destroy stream and clear lastChunkLoaded so guard fires
      stream.destroy();
      ras.lastChunkLoaded = false;
      // position < currentBufferSize so _loadNextChunk is NOT called, then guard at 300-302 fires
      ras.position = 0;

      const tmp = Buffer.allocUnsafe(10);
      await expect(ras.readBytes(tmp, 0, 10)).rejects.toThrow('Stream closed by client disconnect');
      await ras.close().catch(() => {});
    });
  });
});
