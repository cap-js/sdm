const { Readable } = require('stream');
const { EventEmitter } = require('events');

/**
 * ReadAheadStream - A stream wrapper that reads chunks ahead of time into a queue
 * enabling parallel reading and processing for improved performance.
 * 
 * This implementation:
 * 1. Starts a background async task that continuously reads chunks from the source stream
 * 2. Pushes chunks into a bounded queue with configurable size
 * 3. Main thread can read from the queue while the background task continues reading
 * 4. Enables parallel I/O: reading next chunk while uploading current chunk
 */
class ReadAheadStream extends EventEmitter {
  constructor(sourceStream, totalSize, chunkSize = 20 * 1024 * 1024) {
    super();
    
    if (sourceStream === null || sourceStream === undefined) {
      throw new Error('InputStream cannot be null');
    }
    
    this.sourceStream = sourceStream;
    this.totalSize = totalSize;
    this.chunkSize = chunkSize;
    this.chunkQueue = [];
    this.maxQueueSize = 4; // Max 4 chunks in queue (80MB) - balances read-ahead performance with memory constraints
    this.isReading = false;
    this.totalBytesRead = 0;
    this.lastChunkLoaded = false;
    this.currentBuffer = null;
    this.currentBufferSize = 0;
    this.position = 0; // Position within current buffer
    this.readError = null;
    this.readPromise = null;
    this.maxRetries = 5; // Maximum retry attempts for transient read errors
    
    console.log('[ReadAheadStream] Initializing read-ahead stream for large file upload');
  }

  /**
   * Start the background reading task
   * This runs in parallel with chunk consumption for improved throughput
   * 
   * Note: This method only waits for the first chunk to be ready, then returns.
   * The background task continues running in parallel, reading ahead into the queue
   * while the main thread consumes chunks for uploading.
   */
  async startReading() {
    if (this.isReading) {
      return;
    }
    this.isReading = true;
    
    // Start background reading task (non-blocking - runs in parallel)
    this._preloadChunks();
    // Wait only for first chunk to be ready, then return
    await this._loadNextChunk();
  }

  /**
   * Background reading task - continuously reads chunks into queue asynchronously
   * Implements producer pattern for efficient parallel I/O operations
   */
  _preloadChunks() {
    // Run asynchronously in background
    this.readPromise = (async () => {
      try {
        // Convert buffer to readable stream if needed
        let stream = this.sourceStream;
        if (Buffer.isBuffer(this.sourceStream)) {
          stream = Readable.from(this.sourceStream);
        }

        // Read chunks continuously in fixed chunk size increments
        while (this.totalBytesRead < this.totalSize) {
          // Wait if queue is full (back-pressure mechanism)
          while (this.chunkQueue.length >= this.maxQueueSize) {
            await this._sleep(10); // Wait 10ms before checking again
          }

          const bufferRef = Buffer.allocUnsafe(this.chunkSize);
          let bytesReadAtomic = 0;

          // Read chunk from stream with retry logic
          bytesReadAtomic = await this._readChunk(stream, bufferRef, bytesReadAtomic);

          if (bytesReadAtomic > 0) {
            this.totalBytesRead += bytesReadAtomic;

            // Trim buffer if last chunk is smaller
            let finalBuffer = bufferRef;
            if (bytesReadAtomic < this.chunkSize) {
              finalBuffer = Buffer.allocUnsafe(bytesReadAtomic);
              bufferRef.copy(finalBuffer, 0, 0, bytesReadAtomic);
            }

            // Ensure last chunk is enqueued
            this.chunkQueue.push(finalBuffer);

            // Only mark as last chunk after enqueuing the last chunk
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
        if (error.message && error.message.includes('interrupted')) {
          console.error('[ReadAheadStream] Thread interrupted during background loading', error);
        } else {
          console.error('[ReadAheadStream] Unexpected exception during background loading', error);
        }
        this.readError = error;
        this.emit('error', error);
      }
    })();
  }

  /**
   * Read chunk with retry logic for transient errors
   * Implements exponential backoff for failed read attempts
   * @param {Readable} stream - Source stream
   * @param {Buffer} buffer - Buffer to read into
   * @param {number} bytesReadSoFar - Bytes already read into buffer
   * @returns {Promise<number>} Total bytes read into buffer
   */
  async _readChunk(stream, buffer, bytesReadSoFar) {
    let retryCount = 0;
    let bytesReadAtomic = bytesReadSoFar;

    while (bytesReadAtomic < this.chunkSize) {
      try {
        // Read from stream into buffer at offset bytesReadAtomic
        const result = await this._readFromStream(
          stream,
          buffer,
          bytesReadAtomic,
          this.chunkSize - bytesReadAtomic
        );

        if (result > 0) {
          bytesReadAtomic += result;
          retryCount = 0; // Reset retry count on successful read
        } else if (result === -1) {
          console.log('[ReadAheadStream] EOF reached while reading the stream.');
          break;
        } else if (result === 0) {
          // Treat 0 bytes read as insufficient data error
          throw new Error('InsufficientDataException: Read returned 0 bytes');
        }
      } catch (error) {
        // Check if error is retryable (transient read errors)
        if (this._shouldRetryReadError(error)) {
          retryCount++;
          if (retryCount >= this.maxRetries) {
            console.error(
              `[ReadAheadStream] Failed to read chunk after ${this.maxRetries} retries: ${error.message}`,
              error
            );
            throw new Error(`Failed to read chunk after retries: ${error.message}`);
          }
          const delaySeconds = Math.pow(2, retryCount); // Exponential backoff: 2, 4, 8, 16, 32 seconds
          console.log(
            `[ReadAheadStream] Retry attempt ${retryCount} failed. Retrying in ${delaySeconds} seconds. Error: ${error.message}`
          );
          await this._sleep(delaySeconds * 1000); // Convert to milliseconds
        } else {
          // Non-retryable errors should fail immediately
          console.error(`[ReadAheadStream] Non-retryable IOException: ${error.message}`, error);
          throw error;
        }
      }
    }

    return bytesReadAtomic;
  }

  /**
   * Read from stream into buffer at specified offset
   * @param {Readable} stream - Source stream
   * @param {Buffer} buffer - Buffer to read into
   * @param {number} offset - Offset in buffer to start writing
   * @param {number} length - Maximum bytes to read
   * @returns {Promise<number>} Bytes read, or -1 for EOF, or 0 for no data available
   */
  async _readFromStream(stream, buffer, offset, length) {
    return new Promise((resolve, reject) => {
      // Check if stream is already destroyed/aborted before attempting read
      if (stream.destroyed) {
        return reject(new Error('Stream is closed or aborted'));
      }
      
      // If stream already ended naturally (EOF), return EOF indicator
      if (stream.readableEnded) {
        return resolve(-1); // EOF
      }
      
      const chunk = stream.read(length);
      
      if (chunk === null) {
        // No data available, wait for 'readable' event
        const onReadable = () => {
          cleanup();
          const newChunk = stream.read(length);
          if (newChunk === null) {
            resolve(0); // No data available
          } else {
            newChunk.copy(buffer, offset);
            resolve(newChunk.length);
          }
        };
        
        const onEnd = () => {
          cleanup();
          resolve(-1); // EOF
        };
        
        const onError = (error) => {
          cleanup();
          reject(error);
        };
        
        const onClose = () => {
          cleanup();
          reject(new Error('Stream closed by client disconnect'));
        };
        
        const onAborted = () => {
          cleanup();
          reject(new Error('Request aborted by client'));
        };
        
        const cleanup = () => {
          stream.removeListener('readable', onReadable);
          stream.removeListener('end', onEnd);
          stream.removeListener('error', onError);
          stream.removeListener('close', onClose);
          stream.removeListener('aborted', onAborted);
        };
        
        stream.once('readable', onReadable);
        stream.once('end', onEnd);
        stream.once('error', onError);
        stream.once('close', onClose);
        stream.once('aborted', onAborted);
      } else {
        chunk.copy(buffer, offset);
        resolve(chunk.length);
      }
    });
  }

  /**
   * Determine if read error should be retried
   * Only transient errors (EOF, insufficient data) are retried
   * @param {Error} error - The error to check
   * @returns {boolean} True if error is retryable
   */
  _shouldRetryReadError(error) {
    if (!error) return false;
    
    const message = error.message || '';
    
    // Only retry on transient read errors
    return message.includes('EOFException') || message.includes('InsufficientDataException');
  }

  /**
   * Retrieve last chunk from queue with timeout (for handling premature EOF scenarios)
   * @returns {Promise<Buffer>} Last chunk from queue or empty buffer
   */
  async getLastChunkFromQueue() {
    try {
      if (this.chunkQueue.length > 0) {
        // Poll with timeout (Java uses 2 seconds)
        const lastChunk = await this._pollQueue(2000);
        if (lastChunk !== null) {
          console.log(`[ReadAheadStream] Fetching last chunk from queue: ${lastChunk.length} bytes`);
          return lastChunk;
        }
      }
    } catch (error) {
      console.error('[ReadAheadStream] Interrupted while fetching last chunk from queue');
      throw new Error('Interrupted while fetching last chunk');
    }

    console.error('[ReadAheadStream] No last chunk found in queue. Returning empty.');
    return Buffer.allocUnsafe(0); // Return empty array if queue is unexpectedly empty
  }

  /**
   * Poll queue with timeout - waits up to specified time for data
   * @param {number} timeoutMs - Maximum time to wait in milliseconds
   * @returns {Promise<Buffer|null>} Chunk from queue or null if timeout
   */
  async _pollQueue(timeoutMs) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      if (this.chunkQueue.length > 0) {
        return this.chunkQueue.shift();
      }
      await this._sleep(10);
    }
    return null;
  }

  /**
   * Read next chunk from queue (consumer pattern)
   * Blocks until chunk is available or stream is finished
   * @returns {Promise<Buffer|null>} Next chunk or null if finished
   */
  async readNextChunk() {
    // Wait for chunk to be available or stream to finish
    while (this.chunkQueue.length === 0 && !this.lastChunkLoaded && !this.readError) {
      await this._sleep(10);
    }

    if (this.readError) {
      throw this.readError;
    }

    if (this.chunkQueue.length > 0) {
      return this.chunkQueue.shift();
    }

    // No more chunks and reading is finished
    return null;
  }

  /**
   * Get remaining bytes to read from source stream
   * @returns {number} Remaining bytes (0 if all data read)
   */
  getRemainingBytes() {
    const remaining = this.totalSize - this.totalBytesRead;
    return remaining > 0 ? remaining : 0;
  }

  /**
   * Check if end of file is reached
   * @returns {boolean} True if all data has been read and processed
   */
  isEOFReached() {
    console.log(
      `[ReadAheadStream] lastChunkLoaded ${this.lastChunkLoaded} chunkQueue.isEmpty():${this.isChunkQueueEmpty()} position:${this.position} currentBufferSize:${this.currentBufferSize}`
    );
    // True if the last chunk has been read and no bytes are left
    return this.lastChunkLoaded && this.isChunkQueueEmpty() && this.position >= this.currentBufferSize;
  }

  /**
   * Alias for isEOFReached for compatibility
   */
  isEOF() {
    return this.isEOFReached();
  }

  /**
   * Check if chunk queue is empty
   * @returns {boolean} True if no chunks in queue
   */
  isChunkQueueEmpty() {
    return this.chunkQueue.length === 0;
  }

  /**
   * Alias for isChunkQueueEmpty for compatibility
   */
  isQueueEmpty() {
    return this.isChunkQueueEmpty();
  }

  /**
   * Load next chunk from queue into current buffer
   * Prepares chunk for byte-level reading operations
   */
  async _loadNextChunk() {
    try {
      // Check for errors from background reading task
      if (this.readError) {
        console.error('[ReadAheadStream] _loadNextChunk detected error from background task:', this.readError.message);
        throw this.readError;
      }
      
      if (this.isChunkQueueEmpty() && this.lastChunkLoaded) {
        return; // No more data, return EOF
      }
      
      // Only check if stream is destroyed if we need more data and queue is empty
      // If we have chunks in queue or lastChunkLoaded=true, stream state doesn't matter
      if (this.isChunkQueueEmpty() && !this.lastChunkLoaded && this.sourceStream && !Buffer.isBuffer(this.sourceStream)) {
        if (this.sourceStream.destroyed) {
          const error = new Error('Stream closed by client disconnect');
          console.error('[ReadAheadStream] _loadNextChunk detected stream is destroyed before all data was read');
          throw error;
        }
      }

      // Wait for chunk to be available
      while (this.isChunkQueueEmpty() && !this.lastChunkLoaded) {
        await this._sleep(10);
      }

      if (this.chunkQueue.length > 0) {
        this.currentBuffer = this.chunkQueue.shift(); // Fetch from preloaded queue
        this.currentBufferSize = this.currentBuffer.length;
        this.position = 0;

        // Ensure the last chunk is processed
        if (this.lastChunkLoaded && this.isChunkQueueEmpty()) {
          console.log('[ReadAheadStream] Last chunk successfully processed and uploaded.');
        }
      }
    } catch (error) {
      throw new Error(`Interrupted while loading next chunk: ${error.message}`);
    }
  }

  /**
   * Read single byte from current buffer
   * @returns {Promise<number>} Byte value (0-255) or -1 for EOF
   */
  async read() {
    const stackTrace = new Error().stack;
    console.log(`[ReadAheadStream] ReadAheadInputStream.read() called by ${stackTrace}`);
    
    if (this.position >= this.currentBufferSize) {
      if (this.lastChunkLoaded) return -1; // EOF
      await this._loadNextChunk();
    }
    
    // Read the byte buffer into the integer number taking only least significant byte into account
    return this.currentBuffer[this.position++] & 0xFF;
  }

  /**
   * Read bytes into buffer at specified offset
   * @param {Buffer} b - Buffer to read into
   * @param {number} off - Offset in buffer
   * @param {number} len - Maximum bytes to read
   * @returns {Promise<number>} Bytes read or -1 for EOF
   */
  async readBytes(b, off, len) {
    // Check for errors from background reading task BEFORE consuming from queue
    if (this.readError) {
      console.error('[ReadAheadStream] readBytes detected error from background task:', this.readError.message);
      throw this.readError;
    }
    
    if (this.position >= this.currentBufferSize) {
      if (this.lastChunkLoaded) return -1;
      await this._loadNextChunk();
    }
    
    // Only check if stream is destroyed if we still need to read more data
    // If lastChunkLoaded=true, all data is already in queue, so stream state doesn't matter
    if (!this.lastChunkLoaded && this.sourceStream && !Buffer.isBuffer(this.sourceStream)) {
      if (this.sourceStream.destroyed) {
        const error = new Error('Stream closed by client disconnect');
        console.error('[ReadAheadStream] readBytes detected stream is destroyed before all data was read');
        throw error;
      }
    }

    const bytesToRead = Math.min(len, this.currentBufferSize - this.position);
    // Copy bytes from current buffer to target buffer
    this.currentBuffer.copy(b, off, this.position, this.position + bytesToRead);
    this.position += bytesToRead;

    return bytesToRead;
  }

  /**
   * Helper to sleep (async delay)
   */
  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Close the stream and cleanup resources
   * Waits for background tasks to complete with timeout
   */
  async close() {
    try {
      // Wait for background tasks to complete (with timeout)
      if (this.readPromise) {
        const TIMEOUT_SENTINEL = Symbol('timeout');
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(TIMEOUT_SENTINEL), 5000));
        const result = await Promise.race([this.readPromise, timeoutPromise]);
        
        if (result === TIMEOUT_SENTINEL) {
          // Timeout occurred - force shutdown
          console.error('[ReadAheadStream] Forcing stream shutdown after timeout');
          // Signal background task to stop
          this.lastChunkLoaded = true;
        } else {
          console.log('[ReadAheadStream] Background tasks completed, closing stream cleanly');
        }
      }
    } catch (error) {
      throw new Error(`Error shutting down executor: ${error.message}`);
    }
    
    if (this.sourceStream && typeof this.sourceStream.destroy === 'function') {
      this.sourceStream.destroy();
    }
    this.chunkQueue = [];
  }

  /**
   * Reset stream to initial state
   */
  async resetStream() {
    if (this.sourceStream && typeof this.sourceStream.reset === 'function') {
      this.sourceStream.reset();
    }
    this.totalBytesRead = 0;
    this.lastChunkLoaded = false;
    this.position = 0;
    console.log('[ReadAheadStream] Stream Reset!');
  }
}

module.exports = ReadAheadStream;
