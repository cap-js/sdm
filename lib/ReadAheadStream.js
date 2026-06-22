const { EventEmitter } = require('events');

/**
 * ReadAheadStream wraps a source stream and reads chunks into a bounded queue
 * ahead of consumption, enabling parallel I/O: next chunk loads while current
 * chunk is being uploaded.
 *
 * Memory bound: maxQueueSize(4) × chunkSize(20MB) = 80 MB max in queue at once.
 */
class ReadAheadStream extends EventEmitter {
  constructor(sourceStream, totalSize, chunkSize = 50 * 1024 * 1024) {
    super();

    if (sourceStream === null || sourceStream === undefined) {
      throw new Error('InputStream cannot be null');
    }

    this.sourceStream = sourceStream;
    this.totalSize = totalSize;
    this.chunkSize = chunkSize;
    this.chunkQueue = [];
    this.maxQueueSize = 4;
    this.isReading = false;
    this.totalBytesRead = 0;
    this.lastChunkLoaded = false;
    this.currentBuffer = null;
    this.currentBufferSize = 0;
    this.position = 0;
    this.readError = null;
    this.readPromise = null;
    this.maxRetries = 5;

    console.log('[ReadAheadStream] Initializing read-ahead stream for large file upload');
  }

  /**
   * Start background chunk pre-loading, wait only for first chunk then return.
   * Subsequent chunks load in parallel while the caller uploads.
   */
  async startReading() {
    if (this.isReading) return;
    this.isReading = true;
    this._preloadChunks();
    // Wait until at least the first chunk is in the queue before returning,
    // so the caller can immediately start reading without polling.
    while (this.chunkQueue.length === 0 && !this.lastChunkLoaded && !this.readError) {
      await this._sleep(10);
    }
    if (this.readError) throw this.readError;
    // Prime currentBuffer so readBytes() works on the first call
    await this._loadNextChunk();
  }

  /**
   * Background producer: continuously reads chunks from the source stream into
   * the bounded queue. Applies backpressure when queue is full.
   * When source is a Buffer, uses zero-copy slice references instead of
   * allocating new buffers for each chunk — critical for large files.
   */
  _preloadChunks() {
    this.readPromise = (async () => {
      try {
        // Fast path: Buffer input — slice references instead of allocating copies
        if (Buffer.isBuffer(this.sourceStream)) {
          const src = this.sourceStream;
          let offset = 0;
          while (offset < this.totalSize) {
            while (this.chunkQueue.length >= this.maxQueueSize) {
              await this._sleep(10);
            }
            const end = Math.min(offset + this.chunkSize, this.totalSize);
            // slice() is a zero-copy view into the original Buffer
            this.chunkQueue.push(src.slice(offset, end));
            this.totalBytesRead += (end - offset);
            offset = end;
          }
          this.lastChunkLoaded = true;
          console.log('[ReadAheadStream] Last chunk successfully queued and marked (Buffer path).');
          return;
        }

        // Stream path: read from Readable in fixed chunk size increments
        const stream = this.sourceStream;
        while (this.totalBytesRead < this.totalSize) {
          while (this.chunkQueue.length >= this.maxQueueSize) {
            await this._sleep(10);
          }

          const bufferRef = Buffer.allocUnsafe(this.chunkSize);
          let bytesReadAtomic = await this._readChunk(stream, bufferRef, 0);

          if (bytesReadAtomic > 0) {
            this.totalBytesRead += bytesReadAtomic;

            let finalBuffer = bufferRef;
            if (bytesReadAtomic < this.chunkSize) {
              finalBuffer = Buffer.allocUnsafe(bytesReadAtomic);
              bufferRef.copy(finalBuffer, 0, 0, bytesReadAtomic);
            }

            this.chunkQueue.push(finalBuffer);

            if (this.totalBytesRead >= this.totalSize) {
              this.lastChunkLoaded = true;
              console.log('[ReadAheadStream] Last chunk successfully queued and marked.');
              break;
            }
          } else {
            console.warn('[ReadAheadStream] No bytes read from stream. Possible EOF.');
            break;
          }
        }
      } catch (error) {
        console.error('[ReadAheadStream] Unexpected exception during background loading', error);
        this.readError = error;
        // Do NOT emit('error') — if there are no listeners Node.js throws an
        // uncaught exception and crashes the process. Callers poll readError
        // via readNextChunk() / readBytes() and handle it there.
      }
    })();
  }

  /**
   * Accumulate up to chunkSize bytes from the stream.
   * result === 0 means "no data buffered yet" — loop immediately without backoff.
   * Exponential backoff is reserved for genuine read errors (EOFException etc.).
   */
  async _readChunk(stream, buffer, bytesReadSoFar) {
    let retryCount = 0;
    let bytesReadAtomic = bytesReadSoFar;

    while (bytesReadAtomic < this.chunkSize) {
      try {
        const result = await this._readFromStream(
          stream,
          buffer,
          bytesReadAtomic,
          this.chunkSize - bytesReadAtomic
        );

        if (result > 0) {
          bytesReadAtomic += result;
          retryCount = 0;
        } else if (result === -1) {
          break; // EOF — chunk may be smaller than chunkSize, that's fine
        }
        // result === 0: stream not yet readable, _readFromStream already awaited
        // the next 'readable' event — just loop back immediately.
      } catch (error) {
        if (this._shouldRetryReadError(error)) {
          retryCount++;
          if (retryCount >= this.maxRetries) {
            throw new Error(`Failed to read chunk after ${this.maxRetries} retries: ${error.message}`);
          }
          const delayMs = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s, 16s, 32s
          console.log(`[ReadAheadStream] Retry ${retryCount} in ${delayMs / 1000}s: ${error.message}`);
          await this._sleep(delayMs);
        } else {
          throw error;
        }
      }
    }

    return bytesReadAtomic;
  }

  /**
   * Single read attempt from the Node.js Readable stream.
   * Returns bytes read (>0), 0 (nothing buffered yet — caller should loop), or -1 (EOF).
   * Throws on stream destruction / client disconnect / abort.
   *
   * We intentionally do NOT pass `length` to stream.read() because Node.js
   * read(n) returns null when fewer than n bytes are internally buffered (its
   * highWaterMark is typically 16–64 KB, far below our 20 MB chunkSize).
   * Instead we read() all currently available bytes and let _readChunk accumulate
   * multiple small reads until a full chunk is assembled.
   */
  async _readFromStream(stream, buffer, offset, length) {
    return new Promise((resolve, reject) => {
      if (stream.destroyed) {
        return reject(new Error('Stream is closed or aborted'));
      }
      if (stream.readableEnded) {
        return resolve(-1);
      }

      // Read all currently buffered bytes (no size argument = whatever is ready).
      // If more than `length` bytes come back, copy only what we need and push
      // the remainder back so it isn't lost.
      const chunk = stream.read();

      if (chunk === null) {
        // Nothing buffered yet — wait for the next 'readable' event then retry.
        const cleanup = () => {
          stream.removeListener('readable', onReadable);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          stream.removeListener('close', onClose);
          stream.removeListener('aborted', onAborted);
        };

        const onReadable = () => {
          cleanup();
          const newChunk = stream.read();
          if (newChunk === null) {
            resolve(0);
          } else {
            const toCopy = Math.min(newChunk.length, length);
            newChunk.copy(buffer, offset, 0, toCopy);
            if (newChunk.length > toCopy) {
              stream.unshift(newChunk.slice(toCopy));
            }
            resolve(toCopy);
          }
        };
        const onEnd = () => { cleanup(); resolve(-1); };
        const onError = (err) => { cleanup(); reject(err); };
        const onClose = () => { cleanup(); reject(new Error('Stream closed by client disconnect')); };
        const onAborted = () => { cleanup(); reject(new Error('Request aborted by client')); };

        stream.once('readable', onReadable);
        stream.once('end', onEnd);
        stream.once('error', onError);
        stream.once('close', onClose);
        stream.once('aborted', onAborted);
      } else {
        const toCopy = Math.min(chunk.length, length);
        chunk.copy(buffer, offset, 0, toCopy);
        if (chunk.length > toCopy) {
          stream.unshift(chunk.slice(toCopy));
        }
        resolve(toCopy);
      }
    });
  }

  _shouldRetryReadError(error) {
    if (!error) return false;
    const msg = error.message || '';
    return msg.includes('EOFException') || msg.includes('InsufficientDataException');
  }

  async getLastChunkFromQueue() {
    if (this.chunkQueue.length > 0) {
      const last = await this._pollQueue(2000);
      if (last !== null) return last;
    }
    console.error('[ReadAheadStream] No last chunk found in queue. Returning empty.');
    return Buffer.allocUnsafe(0);
  }

  async _pollQueue(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (this.chunkQueue.length > 0) return this.chunkQueue.shift();
      await this._sleep(10);
    }
    return null;
  }

  async readNextChunk() {
    while (this.chunkQueue.length === 0 && !this.lastChunkLoaded && !this.readError) {
      await this._sleep(10);
    }
    if (this.readError) throw this.readError;
    if (this.chunkQueue.length > 0) return this.chunkQueue.shift();
    return null;
  }

  getRemainingBytes() {
    const remaining = this.totalSize - this.totalBytesRead;
    return remaining > 0 ? remaining : 0;
  }

  isEOFReached() {
    return this.lastChunkLoaded && this.isChunkQueueEmpty() && this.position >= this.currentBufferSize;
  }

  isEOF() {
    return this.isEOFReached();
  }

  isChunkQueueEmpty() {
    return this.chunkQueue.length === 0;
  }

  isQueueEmpty() {
    return this.isChunkQueueEmpty();
  }

  async _loadNextChunk() {
    if (this.readError) throw this.readError;
    if (this.isChunkQueueEmpty() && this.lastChunkLoaded) return;

    if (this.isChunkQueueEmpty() && !this.lastChunkLoaded &&
        this.sourceStream && !Buffer.isBuffer(this.sourceStream)) {
      if (this.sourceStream.destroyed) {
        throw new Error('Stream closed by client disconnect');
      }
    }

    while (this.isChunkQueueEmpty() && !this.lastChunkLoaded) {
      await this._sleep(10);
    }

    if (this.chunkQueue.length > 0) {
      this.currentBuffer = this.chunkQueue.shift();
      this.currentBufferSize = this.currentBuffer.length;
      this.position = 0;
    }
  }

  async readBytes(b, off, len) {
    if (this.readError) throw this.readError;

    if (this.position >= this.currentBufferSize) {
      if (this.lastChunkLoaded) return -1;
      await this._loadNextChunk();
    }

    if (!this.lastChunkLoaded && this.sourceStream && !Buffer.isBuffer(this.sourceStream)) {
      if (this.sourceStream.destroyed) {
        throw new Error('Stream closed by client disconnect');
      }
    }

    const bytesToRead = Math.min(len, this.currentBufferSize - this.position);
    this.currentBuffer.copy(b, off, this.position, this.position + bytesToRead);
    this.position += bytesToRead;
    return bytesToRead;
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async close() {
    if (this.readPromise) {
      const TIMEOUT = Symbol('timeout');
      const result = await Promise.race([
        this.readPromise,
        new Promise(resolve => setTimeout(() => resolve(TIMEOUT), 5000))
      ]);
      if (result === TIMEOUT) {
        console.error('[ReadAheadStream] Forcing stream shutdown after timeout');
        this.lastChunkLoaded = true;
      }
    }
    if (this.sourceStream && typeof this.sourceStream.destroy === 'function') {
      this.sourceStream.destroy();
    }
    this.chunkQueue = [];
  }
}

module.exports = ReadAheadStream;
