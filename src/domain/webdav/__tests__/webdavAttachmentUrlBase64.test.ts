/**
 * webdav url/base64 纯函数单测（切片 37 附件面，AGENTS.md §7.49 D4）：
 * 附件 URL 分段组装（buildWebdavUrl 整段 encodeURIComponent 不适用于带子目录
 * 的附件路径——独立 builder 先决）+ 远端名守卫（防路径穿越）+ 字节级 base64
 * 编解码 roundtrip（下载写文件/上传读文件的互逆前提）。
 */

import {
  encodeBytesToBase64,
  decodeBase64ToBytes,
} from '../base64';
import {
  WEBDAV_ATTACHMENTS_DIR,
  isWebdavAttachmentRemoteName,
  buildWebdavAttachmentDirUrl,
  buildWebdavAttachmentUrl,
} from '../url';
import type { WebdavConfig } from '../config';

const CONFIG: WebdavConfig = {
  baseUrl: 'https://dav.example.com',
  basePath: '/life-backup/',
  username: 'user',
  password: 'pass',
};

describe('buildWebdavAttachmentDirUrl / buildWebdavAttachmentUrl', () => {
  it('目录 URL = basePath 段 + life-attachments + 尾随斜杠', () => {
    expect(buildWebdavAttachmentDirUrl(CONFIG)).toBe(
      'https://dav.example.com/life-backup/life-attachments/',
    );
    expect(WEBDAV_ATTACHMENTS_DIR).toBe('life-attachments');
  });

  it('资源 URL = basePath 段 + life-attachments + remoteName（各自分段编码）', () => {
    expect(buildWebdavAttachmentUrl(CONFIG, 'abcdef0123456789-rec.m4a')).toBe(
      'https://dav.example.com/life-backup/life-attachments/abcdef0123456789-rec.m4a',
    );
    // remoteName 内的合法字符（空格/中文文件名）逐段编码，不产生 %2F。
    expect(buildWebdavAttachmentUrl(CONFIG, 'abc 專輯 封面.png')).toBe(
      `https://dav.example.com/life-backup/life-attachments/${encodeURIComponent('abc 專輯 封面.png')}`,
    );
  });

  it("basePath 多段与根路径（''）均正确拼接", () => {
    const multi: WebdavConfig = { ...CONFIG, basePath: '/a/b/' };
    expect(buildWebdavAttachmentUrl(multi, 'x.jpg')).toBe(
      'https://dav.example.com/a/b/life-attachments/x.jpg',
    );
    const root: WebdavConfig = { ...CONFIG, basePath: '' };
    expect(buildWebdavAttachmentDirUrl(root)).toBe(
      'https://dav.example.com/life-attachments/',
    );
  });

  it('baseUrl 为空 / 非法 remoteName 抛错', () => {
    expect(() => buildWebdavAttachmentDirUrl({ ...CONFIG, baseUrl: '   ' })).toThrow(
      'baseUrl 不能为空',
    );
    expect(() => buildWebdavAttachmentUrl(CONFIG, '../escape')).toThrow('非法附件文件名');
    expect(() => buildWebdavAttachmentUrl(CONFIG, 'a/b.jpg')).toThrow('非法附件文件名');
  });
});

describe('isWebdavAttachmentRemoteName（防路径穿越守卫）', () => {
  it.each([
    ['abcdef0123456789-a.jpg', true],
    ['a', true],
    ['', false],
    ['.', false],
    ['..', false],
    ['a/b.jpg', false],
    ['a\\b.jpg', false],
  ])('%j → %j', (input, expected) => {
    expect(isWebdavAttachmentRemoteName(input)).toBe(expected);
  });
});

describe('encodeBytesToBase64 / decodeBase64ToBytes（字节级互逆）', () => {
  it('roundtrip 对空串与任意长度字节串互逆（含 1/2/3 余数组）', () => {
    const samples = [
      new Uint8Array(0),
      new Uint8Array([0]),
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2, 3]),
      new Uint8Array([255, 254, 253, 128, 127, 0, 7]),
    ];
    for (const sample of samples) {
      expect(decodeBase64ToBytes(encodeBytesToBase64(sample))).toEqual(sample);
    }
  });

  it('标准 base64 形状（RFC 4648 向量）与填充规则', () => {
    expect(encodeBytesToBase64(new Uint8Array([104, 101, 108, 108, 111]))).toBe('aGVsbG8=');
    expect(Array.from(decodeBase64ToBytes('aGVsbG8='))).toEqual([104, 101, 108, 108, 111]);
    expect(encodeBytesToBase64(new Uint8Array([104, 105]))).toBe('aGk=');
    expect(encodeBytesToBase64(new Uint8Array([104]))).toBe('aA==');
  });

  it('非法输入抛错；空白符与多余填充容忍', () => {
    expect(() => decodeBase64ToBytes('A')).toThrow('非法 base64 长度');
    expect(() => decodeBase64ToBytes('AA')).not.toThrow(); // 无填充 2 字符组可解码。
    expect(Array.from(decodeBase64ToBytes('AA'))).toEqual([0]);
    expect(() => decodeBase64ToBytes('A-_~')).toThrow('非法 base64 字符');
    expect(() => decodeBase64ToBytes('a=b')).toThrow('非法 base64 字符');
    expect(Array.from(decodeBase64ToBytes('aGVs\nbG8='))).toEqual([104, 101, 108, 108, 111]);
  });
});
