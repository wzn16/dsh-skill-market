import { inflateRawSync } from "node:zlib";

/**
 * 零依赖 zip 解包（替代 fflate）。
 * 只需支持 GitHub codeload 产物：无 zip64、无加密、单一根目录。
 * 通过 Central Directory 定位条目（local header 的 size 字段可能为 0，
 * 以 central directory 记录的大小为准）。
 */

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

function findEOCD(bytes: Uint8Array): number {
  const min = Math.max(0, bytes.length - 65535 - 22);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (
      bytes[i] === 0x50 &&
      bytes[i + 1] === 0x4b &&
      bytes[i + 2] === 0x05 &&
      bytes[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error("无效的 zip：找不到 Central Directory 结尾记录");
}

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      bytes[offset + 3] * 0x1000000) >>> 0
  );
}

function decodeFileName(bytes: Uint8Array, start: number, length: number): string {
  // 优先 UTF-8，退回 latin1
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(start, start + length));
  } catch {
    return Buffer.from(bytes.subarray(start, start + length)).toString("latin1");
  }
}

/** 解包 zip，返回 { 文件名: 内容 }；目录条目不产出 */
export function unzip(bytes: Uint8Array): Record<string, Uint8Array> {
  const eocd = findEOCD(bytes);
  const count = u16(bytes, eocd + 10);
  let offset = u32(bytes, eocd + 16);
  const result: Record<string, Uint8Array> = Object.create(null);
  for (let i = 0; i < count; i++) {
    if (u32(bytes, offset) !== CEN_SIG) {
      throw new Error(`无效的 zip：第 ${i + 1} 个 Central Directory 条目签名错误`);
    }
    const method = u16(bytes, offset + 10);
    const compressedSize = u32(bytes, offset + 20);
    const fileNameLen = u16(bytes, offset + 28);
    const extraLen = u16(bytes, offset + 30);
    const commentLen = u16(bytes, offset + 32);
    const localOffset = u32(bytes, offset + 42);
    const fileName = decodeFileName(bytes, offset + 46, fileNameLen);
    const entryEnd = offset + 46 + fileNameLen + extraLen + commentLen;
    if (u32(bytes, entryEnd) !== 0 && u32(bytes, entryEnd) !== CEN_SIG) {
      // 继续由循环头的签名检查兜底
    }
    offset = entryEnd;
    if (fileName.endsWith("/")) continue; // 目录条目
    if (u32(bytes, localOffset) !== LOC_SIG) {
      throw new Error(`无效的 zip：条目 ${fileName} 的 local header 签名错误`);
    }
    const locFileNameLen = u16(bytes, localOffset + 26);
    const locExtraLen = u16(bytes, localOffset + 28);
    const dataStart = localOffset + 30 + locFileNameLen + locExtraLen;
    const compressed = bytes.subarray(dataStart, dataStart + compressedSize);
    let data: Uint8Array;
    if (method === 0) {
      data = compressed;
    } else if (method === 8) {
      data = inflateRawSync(compressed);
    } else {
      throw new Error(`暂不支持的压缩方法 ${method}（条目 ${fileName}）`);
    }
    result[fileName] = data;
  }
  return result;
}
