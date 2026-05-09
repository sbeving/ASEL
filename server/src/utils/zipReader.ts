import { inflateRawSync } from 'node:zlib';

export interface ZipReadEntry {
  name: string;
  data: Buffer;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  const signature = 0x06054b50;
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  throw new Error('Invalid zip: end of central directory not found');
}

export function readZipEntries(buffer: Buffer): ZipReadEntry[] {
  const eocd = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocd + 10);
  let cursor = buffer.readUInt32LE(eocd + 16);
  const entries: ZipReadEntry[] = [];

  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid zip: central directory entry ${index} is corrupt`);
    }

    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString('utf8');

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`Invalid zip: local header for ${name} is corrupt`);
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    const data = method === 8 ? inflateRawSync(compressed) : method === 0 ? Buffer.from(compressed) : null;
    if (!data) throw new Error(`Unsupported zip compression method ${method} for ${name}`);
    if (data.length !== uncompressedSize) {
      throw new Error(`Invalid zip: size mismatch for ${name}`);
    }

    entries.push({ name, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}
