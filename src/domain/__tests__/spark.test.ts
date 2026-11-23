/**
 * domain/spark.ts 单测（切片 37 阶段 1，AGENTS.md §7.49 D4）：
 * buildAttachmentRemoteName 附件 hash 命名（sha256 前 16 位 + 原名）、
 * 上限常量、kind 枚举全集。
 */

import {
  buildAttachmentRemoteName,
  SPARK_ATTACHMENT_KINDS,
  SPARK_ATTACHMENT_MAX_BYTES,
  SPARK_ATTACHMENT_MAX_COUNT,
  SPARK_ITEM_LINK_MAX,
} from '../spark';

describe('buildAttachmentRemoteName（附件 hash 命名，提案 D4）', () => {
  it('sha256 前 16 位 + 原始文件名', () => {
    const sha = 'abcdef0123456789abcdef0123456789';
    expect(buildAttachmentRemoteName(sha, 'rec.m4a')).toBe('abcdef0123456789-rec.m4a');
    expect(buildAttachmentRemoteName(sha, 'IMG_0001.jpg')).toBe('abcdef0123456789-IMG_0001.jpg');
  });

  it('sha256 恰好 16 位可用；<16 位抛错；空名抛错', () => {
    const sha16 = '0123456789abcdef';
    expect(buildAttachmentRemoteName(sha16, 'a.png')).toBe('0123456789abcdef-a.png');
    expect(() => buildAttachmentRemoteName('short', 'a.png')).toThrow('必须为至少 16 位的 hex 摘要');
    expect(() => buildAttachmentRemoteName('', 'a.png')).toThrow('必须为至少 16 位的 hex 摘要');
    expect(() => buildAttachmentRemoteName(sha16, '')).toThrow('originalFileName 不能为空');
    expect(() => buildAttachmentRemoteName(sha16, '   ')).toThrow('originalFileName 不能为空');
  });
});

describe('上限常量与 kind 枚举（提案 D4/D7 冻结值）', () => {
  it('每灵感 ≤20 附件、单文件 ≤25MB、关联计划 ≤50', () => {
    expect(SPARK_ATTACHMENT_MAX_COUNT).toBe(20);
    expect(SPARK_ATTACHMENT_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(SPARK_ITEM_LINK_MAX).toBe(50);
  });

  it('附件 kind 枚举全集 audio | image（写路径守卫依据）', () => {
    expect(SPARK_ATTACHMENT_KINDS).toEqual(['audio', 'image']);
  });
});
