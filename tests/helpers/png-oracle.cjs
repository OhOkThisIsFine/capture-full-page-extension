"use strict";
const zlib = require("node:zlib"),
  Q = require("../../scripts/qa-contract.cjs");
function crc(bytes) {
  let n = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    n ^= bytes[i];
    for (let bit = 0; bit < 8; bit++)
      n = n & 1 ? (n >>> 1) ^ 0xedb88320 : n >>> 1;
  }
  return (n ^ 0xffffffff) >>> 0;
}
function decodePng(bytes) {
  Q.requireThat(
    Buffer.isBuffer(bytes) &&
      bytes.length >= 45 &&
      bytes.length <= 128 * 1024 * 1024 &&
      bytes.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    "Invalid bounded PNG signature",
  );
  let offset = 8,
    width,
    height,
    ended = false,
    header = false,
    idatEnded = false;
  const chunks = [];
  while (offset < bytes.length) {
    Q.requireThat(offset + 12 <= bytes.length, "Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset),
      type = bytes.toString("ascii", offset + 4, offset + 8),
      finish = offset + 12 + length;
    Q.requireThat(
      finish <= bytes.length &&
        crc(bytes.subarray(offset + 4, finish - 4)) ===
          bytes.readUInt32BE(finish - 4),
      "PNG CRC/boundary mismatch",
    );
    const p = bytes.subarray(offset + 8, finish - 4);
    if (type === "IHDR") {
      Q.requireThat(
        !header && offset === 8 && length === 13,
        "Duplicate/misplaced IHDR",
      );
      width = p.readUInt32BE(0);
      height = p.readUInt32BE(4);
      Q.requireThat(
        width > 0 &&
          height > 0 &&
          width <= 32767 &&
          height <= 32767 &&
          width * height <= 64 * 1024 * 1024 &&
          p[8] === 8 &&
          p[9] === 6 &&
          p[10] === 0 &&
          p[11] === 0 &&
          p[12] === 0,
        "Unsupported PNG geometry/RGBA",
      );
      header = true;
    } else if (type === "IDAT") {
      Q.requireThat(
        header && !ended && !idatEnded && length <= 1048576,
        "Noncontiguous/oversized IDAT",
      );
      chunks.push(p);
    } else if (type === "IEND") {
      Q.requireThat(
        header && chunks.length > 0 && length === 0 && finish === bytes.length,
        "Invalid final IEND",
      );
      ended = true;
      idatEnded = true;
    } else Q.requireThat(false, "Unexpected PNG chunk");
    offset = finish;
  }
  Q.requireThat(ended, "Missing IEND");
  const compressed = Buffer.concat(chunks),
    expected = height * (width * 4 + 1),
    result = zlib.inflateSync(compressed, {
      info: true,
      maxOutputLength: expected + 1,
    });
  Q.requireThat(
    result.buffer.length === expected &&
      result.engine.bytesWritten === compressed.length,
    "PNG trailing zlib stream/bytes or scanline mismatch",
  );
  const scanlines = result.buffer;
  for (let y = 0; y < height; y++)
    Q.requireThat(
      scanlines[y * (width * 4 + 1)] === 0,
      "Unexpected production PNG filter",
    );
  return {
    width,
    height,
    pixel(x, y) {
      Q.requireThat(
        Number.isInteger(x) &&
          Number.isInteger(y) &&
          x >= 0 &&
          y >= 0 &&
          x < width &&
          y < height,
        "Pixel outside image",
      );
      const start = y * (width * 4 + 1) + 1 + x * 4;
      return [...scanlines.subarray(start, start + 4)];
    },
  };
}
module.exports = { crc, decodePng };
