/**
 * sparkCapture 编排与纯展示函数单测（切片 37 阶段 2，AGENTS.md §7.49 D4/D6）：
 * - captureAttachment 编排链：复制落盘 → 25MB 上限守卫 → addAttachment →
 *   即时上传（uploadSparkFile 传 copied uri 的文件名）→ markAttachmentUploaded；
 * - 上限拒绝删副本不建行；addAttachment 失败删副本原样抛错；上传失败
 *   uploaded=false 仅披露（本地可用，详情页可重传）；
 * - reuploadAttachment：uploadSparkFile → markAttachmentUploaded 直通；
 * - 纯函数：fileNameFromUri / imageExtensionFromUri / sparkDisplayTitle /
 *   sparkDisplayPreview / formatRelativeTime / formatRecordingDuration /
 *   attachmentBackupLabel / attachmentKindLabel。
 * 零 RN 依赖（sparkCapture.ts 本体不 import react-native）。
 */
import { consoleWarnSpy } from './helpers/consoleSpy';
import {
  attachmentBackupLabel,
  attachmentKindLabel,
  captureAttachment,
  fileNameFromUri,
  formatRecordingDuration,
  formatRelativeTime,
  imageExtensionFromUri,
  reuploadAttachment,
  sparkDisplayPreview,
  sparkDisplayTitle,
} from '../sparkCapture';
import type {
  SparkAttachmentIo,
  SparkRepository,
  SparkUploadResult,
} from '../../data/SparkRepository';
import { SPARK_ATTACHMENT_MAX_BYTES } from '../../domain/spark';
import type { Spark, SparkAttachment } from '../../domain/spark';

function makeStubIo(overrides: Partial<SparkAttachmentIo> = {}): SparkAttachmentIo & {
  copyIntoSparksDir: jest.Mock;
  fileExists: jest.Mock;
  deleteFile: jest.Mock;
  downloadToSparksDir: jest.Mock;
  deleteRemoteFile: jest.Mock;
  uploadSparkFile: jest.Mock;
} {
  return {
    copyIntoSparksDir: jest.fn().mockResolvedValue({ uri: '/sparks/copied.m4a', fileSize: 100 }),
    fileExists: jest.fn().mockResolvedValue(true),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    downloadToSparksDir: jest.fn().mockResolvedValue('/sparks/dl.m4a'),
    deleteRemoteFile: jest.fn().mockResolvedValue(undefined),
    uploadSparkFile: jest.fn().mockResolvedValue({
      remotePath: 'stub0123456789ab-rec.m4a',
      sha256: 'stub0123456789abcdef0123456789abcdef0123',
    } satisfies SparkUploadResult),
    ...overrides,
  } as SparkAttachmentIo & {
    copyIntoSparksDir: jest.Mock;
    fileExists: jest.Mock;
    deleteFile: jest.Mock;
    downloadToSparksDir: jest.Mock;
    deleteRemoteFile: jest.Mock;
    uploadSparkFile: jest.Mock;
  };
}

function makeStubRepo(overrides: Partial<SparkRepository> = {}): SparkRepository & {
  addAttachment: jest.Mock;
  markAttachmentUploaded: jest.Mock;
} {
  return {
    createSpark: jest.fn(),
    updateSpark: jest.fn(),
    deleteSpark: jest.fn(),
    listSparks: jest.fn(),
    getSparkById: jest.fn(),
    listAttachments: jest.fn(),
    addAttachment: jest.fn(),
    deleteAttachment: jest.fn(),
    markAttachmentUploaded: jest.fn(),
    getAttachmentById: jest.fn(),
    linkSparkToItem: jest.fn(),
    unlinkSparkFromItem: jest.fn(),
    listItemsForSpark: jest.fn(),
    ...overrides,
  } as SparkRepository & {
    addAttachment: jest.Mock;
    markAttachmentUploaded: jest.Mock;
  };
}

function makeAttachment(overrides: Partial<SparkAttachment> = {}): SparkAttachment {
  return {
    id: 'att-1',
    sparkId: 'spark-1',
    kind: 'audio',
    uri: '/sparks/a.m4a',
    remotePath: 'stub0123456789ab-a.m4a',
    sha256: 'stub0123456789abcdef0123456789abcdef0123',
    fileSize: 1024,
    durationMs: 1500,
    width: null,
    height: null,
    createdAt: 1700000000000,
    ...overrides,
  };
}

function makeSpark(overrides: Partial<Spark> = {}): Spark {
  return {
    id: 'spark-1',
    title: null,
    content: null,
    createdAt: 1700000000000,
    updatedAt: 1700000000000,
    ...overrides,
  };
}

beforeEach(() => {
  consoleWarnSpy.mockClear();
});

describe('captureAttachment 编排链（§7.49 D4）', () => {
  it('复制→建行→上传→回填：uploaded=true 且上传文件名取自落盘 uri', async () => {
    const io = makeStubIo();
    const attachment = makeAttachment({ remotePath: null });
    const marked = makeAttachment();
    const repo = makeStubRepo({
      addAttachment: jest.fn().mockResolvedValue(attachment),
      markAttachmentUploaded: jest.fn().mockResolvedValue(marked),
    });
    const outcome = await captureAttachment(io, repo, 'spark-1', {
      kind: 'audio',
      sourceUri: 'file:///cache/tmp.m4a',
      extension: 'm4a',
      durationMs: 1500,
    });
    expect(io.copyIntoSparksDir).toHaveBeenCalledWith('file:///cache/tmp.m4a', 'm4a');
    expect(repo.addAttachment).toHaveBeenCalledWith('spark-1', {
      kind: 'audio',
      uri: '/sparks/copied.m4a',
      fileSize: 100,
      durationMs: 1500,
    });
    expect(io.uploadSparkFile).toHaveBeenCalledWith('/sparks/copied.m4a', 'copied.m4a');
    expect(repo.markAttachmentUploaded).toHaveBeenCalledWith('att-1', {
      remotePath: 'stub0123456789ab-rec.m4a',
      sha256: 'stub0123456789abcdef0123456789abcdef0123',
    });
    expect(outcome).toEqual({ attachment: marked, uploaded: true });
  });

  it('超 25MB 上限：抛错并删除副本，不建附件行', async () => {
    const io = makeStubIo({
      copyIntoSparksDir: jest.fn().mockResolvedValue({
        uri: '/sparks/big.jpg',
        fileSize: SPARK_ATTACHMENT_MAX_BYTES + 1,
      }),
    });
    const repo = makeStubRepo();
    await expect(
      captureAttachment(io, repo, 'spark-1', { kind: 'image', sourceUri: 'file:///x/big.jpg', extension: 'jpg' }),
    ).rejects.toThrow('附件超出 25MB 上限，未保存');
    expect(io.deleteFile).toHaveBeenCalledWith('/sparks/big.jpg');
    expect(repo.addAttachment).not.toHaveBeenCalled();
  });

  it('addAttachment 失败（如上限 20）：删副本后原样抛错', async () => {
    const io = makeStubIo();
    const repo = makeStubRepo({
      addAttachment: jest.fn().mockRejectedValue(new Error('addAttachment: 附件数量已达上限')),
    });
    await expect(
      captureAttachment(io, repo, 'spark-1', { kind: 'audio', sourceUri: 'file:///x/a.m4a', extension: 'm4a' }),
    ).rejects.toThrow('addAttachment: 附件数量已达上限');
    expect(io.deleteFile).toHaveBeenCalledWith('/sparks/copied.m4a');
  });

  it('上传失败：console.warn 披露 + uploaded=false + 不回填（详情页可重传）', async () => {
    const io = makeStubIo({
      uploadSparkFile: jest.fn().mockRejectedValue(new Error('timeout')),
    });
    const attachment = makeAttachment({ remotePath: null });
    const repo = makeStubRepo({ addAttachment: jest.fn().mockResolvedValue(attachment) });
    const outcome = await captureAttachment(io, repo, 'spark-1', {
      kind: 'audio',
      sourceUri: 'file:///x/a.m4a',
      extension: 'm4a',
    });
    expect(outcome.uploaded).toBe(false);
    expect(outcome.attachment).toBe(attachment);
    expect(repo.markAttachmentUploaded).not.toHaveBeenCalled();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[slice-37] 附件上传失败（未备份，可在详情页重传）',
      expect.any(Error),
    );
  });
});

describe('reuploadAttachment（详情页重传入口）', () => {
  it('上传成功后回填 remotePath/sha256', async () => {
    const io = makeStubIo();
    const marked = makeAttachment();
    const repo = makeStubRepo({ markAttachmentUploaded: jest.fn().mockResolvedValue(marked) });
    const result = await reuploadAttachment(io, repo, makeAttachment({ remotePath: null }));
    expect(io.uploadSparkFile).toHaveBeenCalledWith('/sparks/a.m4a', 'a.m4a');
    expect(result).toBe(marked);
  });

  it('上传失败原样抛错（调用方 Alert 披露）', async () => {
    const io = makeStubIo({ uploadSparkFile: jest.fn().mockRejectedValue(new Error('network')) });
    const repo = makeStubRepo();
    await expect(reuploadAttachment(io, repo, makeAttachment())).rejects.toThrow('network');
  });
});

describe('纯展示函数（提案 D6）', () => {
  it('fileNameFromUri：去 query/fragment，空段回退 file', () => {
    expect(fileNameFromUri('file:///sparks/abc.m4a?x=1')).toBe('abc.m4a');
    expect(fileNameFromUri('file:///a/b.jpg#frag')).toBe('b.jpg');
    expect(fileNameFromUri('file:///a/')).toBe('file');
  });

  it('imageExtensionFromUri：提取合法扩展名，缺省回退 jpg', () => {
    expect(imageExtensionFromUri('file:///x/y.png')).toBe('png');
    expect(imageExtensionFromUri('file:///x/y.heic')).toBe('heic');
    expect(imageExtensionFromUri('file:///x/noext')).toBe('jpg');
    expect(imageExtensionFromUri('file:///x/y.PNG')).toBe('png');
    expect(imageExtensionFromUri('file:///x/y.EXE')).toBe('exe');
  });

  it('sparkDisplayTitle：title 优先 → content 首行 → 纯录音占位', () => {
    expect(sparkDisplayTitle({ title: '  标题  ', content: '内容' })).toBe('标题');
    expect(sparkDisplayTitle({ title: null, content: '第一行\n第二行' })).toBe('第一行');
    expect(sparkDisplayTitle({ title: null, content: null })).toBe('（纯录音灵感）');
    expect(sparkDisplayTitle({ title: '   ', content: '第一行' })).toBe('第一行');
  });

  it('sparkDisplayPreview：仅 title 有效且 content 非空时返回 content 首行', () => {
    expect(sparkDisplayPreview({ title: 't', content: 'c1\nc2' })).toBe('c1');
    expect(sparkDisplayPreview({ title: null, content: 'c' })).toBeNull();
    expect(sparkDisplayPreview({ title: 't', content: null })).toBeNull();
    expect(sparkDisplayPreview({ title: 't', content: '  ' })).toBeNull();
  });

  it('formatRelativeTime：刚刚/分钟/小时/天/超 30 天日期/未来日期', () => {
    const now = 1700000000000;
    expect(formatRelativeTime(now - 30_000, now)).toBe('刚刚');
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5分钟前');
    expect(formatRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3小时前');
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2天前');
    expect(formatRelativeTime(now - 40 * 24 * 60 * 60_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatRelativeTime(now + 60_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('formatRecordingDuration：m:ss 与 H:MM:SS，非法输入归 0:00', () => {
    expect(formatRecordingDuration(0)).toBe('0:00');
    expect(formatRecordingDuration(59_000)).toBe('0:59');
    expect(formatRecordingDuration(61_000)).toBe('1:01');
    expect(formatRecordingDuration(3_661_000)).toBe('1:01:01');
    expect(formatRecordingDuration(-5)).toBe('0:00');
    expect(formatRecordingDuration(Number.NaN)).toBe('0:00');
  });

  it('attachmentBackupLabel / attachmentKindLabel 徽标文案', () => {
    expect(attachmentBackupLabel(makeAttachment({ remotePath: 'x.m4a' }))).toBe('已备份');
    expect(attachmentBackupLabel(makeAttachment({ remotePath: null }))).toBe('未备份');
    expect(attachmentKindLabel('audio')).toBe('录音');
    expect(attachmentKindLabel('image')).toBe('图片');
  });
});
