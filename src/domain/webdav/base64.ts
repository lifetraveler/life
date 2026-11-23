/**
 * 切片 28 阶段 1（AGENTS.md §7.42 D3）：Basic Auth 用 base64 编码（UTF-8 安全）。
 *
 * 零新依赖：React Native/Hermes 无 btoa 保证、Node Buffer 不可用于 RN 运行时，
 * 故实现纯 TS 编码器。切片 37（§7.49 Q5 附件上云）追加字节级编解码：
 * encodeBytesToBase64（下载的附件字节 → expo-file-system 写文件需 base64）、
 * decodeBase64ToBytes（本地附件文件 base64 → WebDAV PUT 二进制体）。
 */

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/**
 * UTF-8 字符串 → base64：
 * 1) for..of 码点迭代（代理对合成为完整码点）→ UTF-8 字节序列（1–4 字节）；
 * 2) 3 字节一组映射 base64 字母表，不足补 '='。
 */
export function encodeBase64Utf8(input: string): string {
  const bytes: number[] = [];
  for (const char of input) {
    const codePoint = char.codePointAt(0);
    if (codePoint === undefined) continue;
    if (codePoint <= 0x7f) {
      bytes.push(codePoint);
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint <= 0xffff) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 === null ? 0 : b1 >> 4)];
    out += b1 === null ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === null ? 0 : b2 >> 6)];
    out += b2 === null ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}

/** 6bit 值 → 字节（字母表外字符由 decodeBase64ToBytes 统一抛错）。 */
const BASE64_LOOKUP: Record<string, number> = (() => {
  const lookup: Record<string, number> = {};
  for (let i = 0; i < BASE64_ALPHABET.length; i += 1) {
    lookup[BASE64_ALPHABET[i]] = i;
  }
  return lookup;
})();

/**
 * base64 → 字节（切片 37，§7.49 附件上传）：容忍空白符与缺失/多余的 '=' 填充；
 * 非法字符（含 URL-safe 的 '-'/'_'）抛 Error。4 字符组 → 1–3 字节，'=' 截断。
 */
export function decodeBase64ToBytes(input: string): Uint8Array<ArrayBuffer> {
  const cleaned = input.replace(/\s+/g, '');
  // 剥离结尾填充 '='（中间出现的 '=' 落入 lookup 查不到 → 统一抛非法字符）。
  const core = cleaned.replace(/=+$/, '');
  if (core.length % 4 === 1) {
    throw new Error('decodeBase64ToBytes: 非法 base64 长度');
  }
  const out = new Uint8Array(Math.floor((core.length * 3) / 4));
  let outIndex = 0;
  let buffer = 0;
  let bits = 0;
  for (const char of core) {
    const value = BASE64_LOOKUP[char];
    if (value === undefined) {
      throw new Error(`decodeBase64ToBytes: 非法 base64 字符：${char}`);
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[outIndex] = (buffer >> bits) & 0xff;
      outIndex += 1;
    }
  }
  return out;
}

/**
 * 字节 → base64（切片 37，§7.49 附件下载）：3 字节一组映射字母表，不足补 '='。
 * 与 decodeBase64ToBytes 互逆（roundtrip 单测锁定）。
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : null;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : null;
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 === null ? 0 : b1 >> 4)];
    out += b1 === null ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 === null ? 0 : b2 >> 6)];
    out += b2 === null ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}
