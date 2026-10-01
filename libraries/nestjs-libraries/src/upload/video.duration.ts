import { Readable } from 'stream';

const MAX_MOVIE_HEADER_BYTES = 32 * 1024 * 1024;
const MAX_SCAN_BYTES = 1024 * 1024 * 1024;

class StreamReader {
  private iterator: AsyncIterator<Buffer>;
  private buffered = Buffer.alloc(0);
  private remaining = MAX_SCAN_BYTES;

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]();
  }

  async read(length: number) {
    if (length > this.remaining) return null;
    if (this.buffered.length >= length) {
      const value = this.buffered.subarray(0, length);
      this.buffered = this.buffered.subarray(length);
      this.remaining -= length;
      return value;
    }

    const chunks: Buffer[] = [];
    let total = 0;
    if (this.buffered.length) {
      chunks.push(this.buffered);
      total = this.buffered.length;
      this.buffered = Buffer.alloc(0);
    }

    while (total < length) {
      const next = await this.iterator.next();
      if (next.done) {
        return null;
      }
      const chunk = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value);
      const needed = length - total;
      if (chunk.length > needed) {
        chunks.push(chunk.subarray(0, needed));
        this.buffered = chunk.subarray(needed);
        total = length;
      } else {
        chunks.push(chunk);
        total += chunk.length;
      }
    }

    this.remaining -= length;
    return chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
  }

  async skip(length: number) {
    if (length > this.remaining) return false;
    let remaining = length;
    if (this.buffered.length) {
      const skipped = Math.min(remaining, this.buffered.length);
      this.buffered = this.buffered.subarray(skipped);
      remaining -= skipped;
    }

    while (remaining > 0) {
      const next = await this.iterator.next();
      if (next.done) {
        return false;
      }
      const chunk = Buffer.isBuffer(next.value)
        ? next.value
        : Buffer.from(next.value);
      if (chunk.length > remaining) {
        this.buffered = chunk.subarray(remaining);
        remaining = 0;
      } else {
        remaining -= chunk.length;
      }
    }
    this.remaining -= length;
    return true;
  }
}

function durationFromMovieHeader(movie: Buffer) {
  let offset = 0;
  while (offset + 8 <= movie.length) {
    let size = movie.readUInt32BE(offset);
    const type = movie.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > movie.length) return null;
      const largeSize = movie.readBigUInt64BE(offset + 8);
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
      size = Number(largeSize);
      headerSize = 16;
    }
    if (size < headerSize || offset + size > movie.length) return null;

    if (type === 'mvhd') {
      const payload = offset + headerSize;
      const version = movie[payload];
      const timeScaleOffset = payload + (version === 1 ? 20 : 12);
      const durationOffset = payload + (version === 1 ? 24 : 16);
      const required = version === 1 ? 8 : 4;
      if (
        (version !== 0 && version !== 1) ||
        durationOffset + required > offset + size
      ) {
        return null;
      }

      const timeScale = movie.readUInt32BE(timeScaleOffset);
      const duration =
        version === 1
          ? Number(movie.readBigUInt64BE(durationOffset))
          : movie.readUInt32BE(durationOffset);
      if (!timeScale || !Number.isFinite(duration) || duration <= 0) {
        return null;
      }
      const seconds = duration / timeScale;
      return Number.isFinite(seconds) ? Math.ceil(seconds) : null;
    }
    offset += size;
  }
  return null;
}

/**
 * Reads the MP4 movie header from a stream. Only the `moov` metadata box is
 * buffered; media data boxes are skipped in stream-sized chunks.
 */
export async function getVideoDuration(stream: Readable) {
  const reader = new StreamReader(stream);
  try {
    while (true) {
      const header = await reader.read(8);
      if (!header) return null;

      let size = header.readUInt32BE(0);
      const type = header.toString('ascii', 4, 8);
      let headerSize = 8;
      if (size === 1) {
        const extendedSize = await reader.read(8);
        if (!extendedSize) return null;
        const largeSize = extendedSize.readBigUInt64BE(0);
        if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
        size = Number(largeSize);
        headerSize = 16;
      }

      if (size === 0) return null;
      if (size < headerSize) return null;
      const payloadSize = size - headerSize;

      if (type === 'moov') {
        if (payloadSize > MAX_MOVIE_HEADER_BYTES) return null;
        const movie = await reader.read(payloadSize);
        return movie ? durationFromMovieHeader(movie) : null;
      }

      if (!(await reader.skip(payloadSize))) return null;
    }
  } finally {
    stream.destroy();
  }
}
