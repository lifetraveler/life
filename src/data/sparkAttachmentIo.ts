/**
 * SparkAttachmentIo 默认实现（切片 37，AGENTS.md §7.49 D4 附件存储与上云）。
 *
 * - 本地：documentDirectory/sparks/<uuid>.<ext>（uuid v4 复用 generateDeviceId
 *   生成器，syncDevice.ts 先例——仅承担唯一文件名语义，非安全凭证）；
 * - 远端：life-attachments/<sha256 前16>-<名>（buildAttachmentRemoteName 在本层
 *   uploadSparkFile 内生成——hash 由文件字节经 expo-crypto digest 计算）；
 * - WebDAV：WebdavClient 附件三方法（每请求 60s 超时）+ SecureWebdavConfigStore
 *   （webdav_backup_config_v1，backup.tsx 页面级装配同款键）；
 * - expo-file-system 走 legacy 子路径（SDK 54 主入口为 New API，
 *   slice-08-closeout 教训；profile.tsx 同款导入）。
 *
 * 错误口径：
 * - 缺 WebDAV 配置：上传/下载抛错（调用方转「未备份」披露）；删除远端视为
 *   幂等成功（无远端可删）；
 * - 本地文件不存在：deleteFile 幂等成功；fileExists 只回报存在性；
 * - remoteName 一律先过 isWebdavAttachmentRemoteName 守卫（防路径穿越）。
 */

import * as Crypto from 'expo-crypto';
import * as FileSystem from 'expo-file-system/legacy';

import { buildAttachmentRemoteName } from '../domain/spark';
import { generateDeviceId } from '../domain/syncDevice';
import { decodeBase64ToBytes, encodeBytesToBase64 } from '../domain/webdav/base64';
import type { WebdavConfig } from '../domain/webdav/config';
import { isWebdavAttachmentRemoteName } from '../domain/webdav/url';
import { SecureWebdavConfigStore } from './SecureWebdavConfigStore';
import type { SparkAttachmentIo, SparkCopiedFile, SparkUploadResult } from './SparkRepository';
import { WebdavClient } from './webdav/WebdavClient';

const client = new WebdavClient();
const configStore = new SecureWebdavConfigStore();

/** 字节 → 小写 HEX（SHA-256 摘要展示形态，remoteName 命名输入）。 */
function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}

/** sparks 本地附件目录（documentDirectory/sparks/，提案 D4）。 */
async function ensureSparksDir(): Promise<string> {
  const base = FileSystem.documentDirectory;
  if (base === null || base === undefined) {
    throw new Error('sparkAttachmentIo: documentDirectory 不可用');
  }
  const dir = `${base}sparks/`;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

/** 远端名 → 本地扩展名（白名单 [a-z0-9]{1,8}，否则 bin；空壳名 → bin）。 */
function remoteNameExtension(remoteName: string): string {
  const dotIndex = remoteName.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === remoteName.length - 1) return 'bin';
  const ext = remoteName.slice(dotIndex + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
}

async function loadConfigOrThrow(action: string): Promise<WebdavConfig> {
  const config = await configStore.load();
  if (config === null) {
    throw new Error(`${action}: WebDAV 未配置（设置页配置后可用）`);
  }
  return config;
}

/** 组装默认 IO（src/data/index.ts 装配单例时传入 WatermelonSparkRepository）。 */
export function defaultSparkAttachmentIo(): SparkAttachmentIo {
  return {
    async copyIntoSparksDir(sourceUri: string, extension: string): Promise<SparkCopiedFile> {
      const ext = /^[a-z0-9]{1,8}$/.test(extension) ? extension : 'bin';
      const dir = await ensureSparksDir();
      const target = `${dir}${generateDeviceId()}.${ext}`;
      await FileSystem.copyAsync({ from: sourceUri, to: target });
      const info = await FileSystem.getInfoAsync(target);
      if (!info.exists || typeof info.size !== 'number') {
        throw new Error('copyIntoSparksDir: 复制后文件大小不可知');
      }
      return { uri: target, fileSize: info.size };
    },

    async fileExists(uri: string): Promise<boolean> {
      const info = await FileSystem.getInfoAsync(uri);
      return info.exists;
    },

    async deleteFile(uri: string): Promise<void> {
      const info = await FileSystem.getInfoAsync(uri);
      if (!info.exists) return; // 幂等：文件不存在视为成功。
      await FileSystem.deleteAsync(uri, { idempotent: true });
    },

    async downloadToSparksDir(remoteName: string): Promise<string> {
      if (!isWebdavAttachmentRemoteName(remoteName)) {
        throw new Error(`downloadToSparksDir: 非法附件文件名（${remoteName}）`);
      }
      const config = await loadConfigOrThrow('下载附件');
      const dir = await ensureSparksDir();
      const bytes = await client.downloadAttachment(config, remoteName);
      const target = `${dir}${generateDeviceId()}.${remoteNameExtension(remoteName)}`;
      await FileSystem.writeAsStringAsync(target, encodeBytesToBase64(bytes), {
        encoding: FileSystem.EncodingType.Base64,
      });
      return target;
    },

    async deleteRemoteFile(remoteName: string): Promise<void> {
      if (!isWebdavAttachmentRemoteName(remoteName)) {
        throw new Error(`deleteRemoteFile: 非法附件文件名（${remoteName}）`);
      }
      const config = await configStore.load();
      // 无配置 = 无远端可删（幂等成功；上传链路本就要求配置存在）。
      if (config === null) return;
      // false = 远端 404（已不存在）→ 幂等成功；抛错由调用方披露。
      await client.deleteAttachmentRemote(config, remoteName);
    },

    async uploadSparkFile(localUri: string, originalFileName: string): Promise<SparkUploadResult> {
      // 单次读取：base64 → 字节 → SHA-256 → hash 命名 → PUT（uploadAttachment
      // 内部再过 isWebdavAttachmentRemoteName 守卫，双保险防路径穿越）。
      const config = await loadConfigOrThrow('上传附件');
      const base64 = await FileSystem.readAsStringAsync(localUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const bytes = decodeBase64ToBytes(base64);
      const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes);
      const sha256 = bytesToHex(new Uint8Array(digest));
      const remotePath = buildAttachmentRemoteName(sha256, originalFileName);
      await client.uploadAttachment(config, remotePath, bytes);
      return { remotePath, sha256 };
    },
  };
}
