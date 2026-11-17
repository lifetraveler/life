/**
 * 切片 28 阶段 1（AGENTS.md §7.42 D3）：Basic Auth 用 base64 编码（UTF-8 安全）。
 *
 * 零新依赖：React Native/Hermes 无 btoa 保证、Node Buffer 不可用于 RN 运行时，
 * 故实现纯 TS 编码器（仅编码；Basic Auth 无解码需求）。
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
