/* Extract only review-relevant EXIF fields before the upload image is re-encoded. */
(() => {
  'use strict';

  // GPS and capture fields are small; avoid buffering oversized ancillary metadata chunks.
  const MAX_EXIF_PAYLOAD_BYTES = 256 * 1024;
  // Malformed images must not make metadata scanning walk an unbounded chunk list.
  const MAX_CONTAINER_CHUNKS = 4096;

  async function read(file) {
    try {
      const exif = await findExifPayload(file);
      return exif ? extractReviewMetadata(exif) : { version: 1 };
    } catch (_) {
      // Malformed or unsupported metadata should not prevent a valid photo upload.
      return { version: 1 };
    }
  }

  async function findExifPayload(file) {
    if (!file || typeof file.slice !== 'function' || file.size < 12) return null;
    const header = await readBytes(file, 0, 12);

    if (header[0] === 0xff && header[1] === 0xd8) return findJpegExif(file);
    if (startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return findPngExif(file);
    if (ascii(header, 0, 4) === 'RIFF' && ascii(header, 8, 4) === 'WEBP') return findWebpExif(file);
    return null;
  }

  async function findJpegExif(file) {
    let offset = 2;
    for (let segmentCount = 0; segmentCount < MAX_CONTAINER_CHUNKS && offset + 4 <= file.size; segmentCount += 1) {
      const prefix = await readBytes(file, offset, offset + 1);
      if (prefix[0] !== 0xff) return null;
      let markerOffset = offset + 1;
      let marker = (await readBytes(file, markerOffset, markerOffset + 1))[0];
      while (marker === 0xff && markerOffset < file.size) {
        markerOffset += 1;
        marker = (await readBytes(file, markerOffset, markerOffset + 1))[0];
      }
      offset = markerOffset + 1;
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;

      const lengthBytes = await readBytes(file, offset, offset + 2);
      const segmentLength = readU16BE(lengthBytes, 0);
      if (segmentLength < 2 || offset + segmentLength > file.size) return null;
      const payloadStart = offset + 2;
      const payloadLength = segmentLength - 2;
      if (marker === 0xe1 && payloadLength >= 6 && payloadLength <= MAX_EXIF_PAYLOAD_BYTES) {
        const payload = await readBytes(file, payloadStart, payloadStart + payloadLength);
        if (ascii(payload, 0, 6) === 'Exif\0\0') return payload.subarray(6);
      }
      offset += segmentLength;
    }
    return null;
  }

  async function findPngExif(file) {
    let offset = 8;
    for (let chunkCount = 0; chunkCount < MAX_CONTAINER_CHUNKS && offset + 12 <= file.size; chunkCount += 1) {
      const chunkHeader = await readBytes(file, offset, offset + 8);
      const length = readU32BE(chunkHeader, 0);
      const chunkType = ascii(chunkHeader, 4, 4);
      const dataStart = offset + 8;
      const nextOffset = dataStart + length + 4;
      if (nextOffset > file.size) return null;
      if (chunkType === 'eXIf') {
        if (length === 0 || length > MAX_EXIF_PAYLOAD_BYTES) return null;
        return readBytes(file, dataStart, dataStart + length);
      }
      if (chunkType === 'IEND') return null;
      offset = nextOffset;
    }
    return null;
  }

  async function findWebpExif(file) {
    const header = await readBytes(file, 0, 12);
    const declaredEnd = Math.min(file.size, 8 + readU32LE(header, 4));
    let offset = 12;
    for (let chunkCount = 0; chunkCount < MAX_CONTAINER_CHUNKS && offset + 8 <= declaredEnd; chunkCount += 1) {
      const chunkHeader = await readBytes(file, offset, offset + 8);
      const chunkType = ascii(chunkHeader, 0, 4);
      const length = readU32LE(chunkHeader, 4);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd > declaredEnd) return null;
      if (chunkType === 'EXIF') {
        if (length === 0 || length > MAX_EXIF_PAYLOAD_BYTES) return null;
        const payload = await readBytes(file, dataStart, dataEnd);
        return ascii(payload, 0, 6) === 'Exif\0\0' ? payload.subarray(6) : payload;
      }
      offset = dataEnd + (length % 2);
    }
    return null;
  }

  function extractReviewMetadata(tiff) {
    const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
    if (tiff.length < 8) return { version: 1 };
    const byteOrder = ascii(tiff, 0, 2);
    if (byteOrder !== 'II' && byteOrder !== 'MM') return { version: 1 };
    const littleEndian = byteOrder === 'II';
    const u16 = offset => offset >= 0 && offset + 2 <= view.byteLength ? view.getUint16(offset, littleEndian) : null;
    const u32 = offset => offset >= 0 && offset + 4 <= view.byteLength ? view.getUint32(offset, littleEndian) : null;
    if (u16(2) !== 42) return { version: 1 };

    const readIfd = offset => {
      if (!Number.isInteger(offset) || offset < 8 || offset + 2 > view.byteLength) return null;
      const count = u16(offset);
      if (count === null || count > 512 || offset + 2 + count * 12 > view.byteLength) return null;
      const entries = new Map();
      for (let index = 0; index < count; index += 1) {
        const entryOffset = offset + 2 + index * 12;
        const tag = u16(entryOffset);
        const type = u16(entryOffset + 2);
        const valueCount = u32(entryOffset + 4);
        if (tag === null || type === null || valueCount === null) continue;
        entries.set(tag, { entryOffset, type, count: valueCount });
      }
      return entries;
    };

    const typeSizes = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const valueOffset = entry => {
      const typeSize = typeSizes[entry?.type];
      if (!typeSize || !Number.isInteger(entry.count) || entry.count < 1) return null;
      const byteLength = typeSize * entry.count;
      const fieldOffset = entry.entryOffset + 8;
      const offset = byteLength <= 4 ? fieldOffset : u32(fieldOffset);
      return offset !== null && offset >= 0 && offset + byteLength <= view.byteLength ? offset : null;
    };
    const readScalar = entry => {
      const offset = valueOffset(entry);
      if (offset === null) return null;
      if (entry.type === 1 || entry.type === 7) return view.getUint8(offset);
      if (entry.type === 3) return view.getUint16(offset, littleEndian);
      if (entry.type === 4) return view.getUint32(offset, littleEndian);
      return null;
    };
    const readAscii = entry => {
      const offset = valueOffset(entry);
      if (offset === null || (entry.type !== 2 && entry.type !== 7)) return '';
      const bytes = tiff.subarray(offset, offset + entry.count);
      let result = '';
      for (const byte of bytes) {
        if (byte === 0) break;
        result += String.fromCharCode(byte);
      }
      return result.trim();
    };
    const readRationals = entry => {
      const offset = valueOffset(entry);
      if (offset === null || (entry.type !== 5 && entry.type !== 10) || entry.count > 3) return [];
      const values = [];
      for (let index = 0; index < entry.count; index += 1) {
        const numeratorOffset = offset + index * 8;
        const numerator = entry.type === 10
          ? view.getInt32(numeratorOffset, littleEndian)
          : view.getUint32(numeratorOffset, littleEndian);
        const denominator = entry.type === 10
          ? view.getInt32(numeratorOffset + 4, littleEndian)
          : view.getUint32(numeratorOffset + 4, littleEndian);
        if (denominator === 0) return [];
        values.push(numerator / denominator);
      }
      return values;
    };
    const firstIfd = readIfd(u32(4));
    if (!firstIfd) return { version: 1 };
    const exifPointer = readScalar(firstIfd.get(0x8769));
    const gpsPointer = readScalar(firstIfd.get(0x8825));
    const exifIfd = exifPointer === null ? null : readIfd(exifPointer);
    const gpsIfd = gpsPointer === null ? null : readIfd(gpsPointer);
    const metadata = { version: 1 };

    const capturedAt = readAscii(exifIfd?.get(0x9003)) ||
      readAscii(exifIfd?.get(0x9004)) || readAscii(firstIfd.get(0x0132));
    const captureOffset = readAscii(exifIfd?.get(0x9011));
    const normalizedCaptureTime = normalizeExifDateTime(capturedAt, captureOffset);
    if (normalizedCaptureTime) metadata.capturedAt = normalizedCaptureTime;

    const latitude = gpsCoordinate(gpsIfd, 0x0002, 0x0001, 90, readRationals, readAscii);
    const longitude = gpsCoordinate(gpsIfd, 0x0004, 0x0003, 180, readRationals, readAscii);
    if (latitude !== null && longitude !== null) {
      const gps = { latitude, longitude };
      const altitude = readRationals(gpsIfd.get(0x0006))[0];
      const altitudeRef = readScalar(gpsIfd.get(0x0005));
      if (Number.isFinite(altitude) && (altitudeRef === 0 || altitudeRef === 1)) {
        gps.altitudeMeters = altitudeRef === 1 ? -altitude : altitude;
      }
      metadata.gps = gps;
    }
    return metadata;
  }

  function gpsCoordinate(ifd, valueTag, refTag, maxDegrees, readRationals, readAscii) {
    if (!ifd) return null;
    const parts = readRationals(ifd.get(valueTag));
    const reference = readAscii(ifd.get(refTag)).toUpperCase();
    if (parts.length !== 3 || !['N', 'S', 'E', 'W'].includes(reference)) return null;
    const [degrees, minutes, seconds] = parts;
    if (![degrees, minutes, seconds].every(Number.isFinite) || degrees < 0 || minutes < 0 || minutes >= 60 || seconds < 0 || seconds >= 60) return null;
    if (degrees > maxDegrees || (degrees === maxDegrees && (minutes > 0 || seconds > 0))) return null;
    const sign = reference === 'S' || reference === 'W' ? -1 : 1;
    return sign * (degrees + minutes / 60 + seconds / 3600);
  }

  function normalizeExifDateTime(value, offset) {
    const match = String(value || '').match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/);
    if (!match) return '';
    const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
    const year = Number(yearText), month = Number(monthText), day = Number(dayText);
    const hour = Number(hourText), minute = Number(minuteText), second = Number(secondText);
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] || 0;
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 60) return '';
    const zone = String(offset || '').match(/^([+-])(\d{2}):(\d{2})$/);
    const normalizedZone = zone && Number(zone[2]) <= 14 && Number(zone[3]) <= 59 &&
      (Number(zone[2]) < 14 || Number(zone[3]) === 0) ? `${zone[1]}${zone[2]}:${zone[3]}` : '';
    return `${yearText}-${monthText}-${dayText}T${hourText}:${minuteText}:${secondText}${normalizedZone}`;
  }

  async function readBytes(file, start, end) {
    return new Uint8Array(await file.slice(start, end).arrayBuffer());
  }

  function startsWith(bytes, signature) {
    return signature.every((byte, index) => bytes[index] === byte);
  }

  function ascii(bytes, offset, length) {
    let result = '';
    for (let index = 0; index < length && offset + index < bytes.length; index += 1) {
      result += String.fromCharCode(bytes[offset + index]);
    }
    return result;
  }

  function readU16BE(bytes, offset) {
    return (bytes[offset] << 8) | bytes[offset + 1];
  }

  function readU32BE(bytes, offset) {
    return ((bytes[offset] * 0x1000000) + (bytes[offset + 1] << 16) +
      (bytes[offset + 2] << 8) + bytes[offset + 3]) >>> 0;
  }

  function readU32LE(bytes, offset) {
    return (bytes[offset] | (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
  }

  window.DiveAtlasPhotoMetadata = Object.freeze({ read });
})();
