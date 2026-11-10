import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { itemRepository } from '../data';
import type { TagDisplayMode } from '../domain/settings';

/**
 * 读取全局标签展示模式（app_settings.tagDisplayMode，§7.22）的 hook。
 *
 * useFocusEffect：每次页面获得焦点时重读——设置页切换样式后返回列表页即生效
 * （repository.md v0.14 未提供 observeSettings，getSettings 是一次性读；
 * 单行小读成本可忽略，不为此新增观察接口）。读取失败保持 'text'
 * （getSettings 自带无记录兜底，此分支仅防御仓库异常）。
 */
export function useTagDisplayMode(): TagDisplayMode {
  const [mode, setMode] = useState<TagDisplayMode>('text');

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      itemRepository
        .getSettings()
        .then((settings) => {
          if (!cancelled) {
            setMode(settings.tagDisplayMode);
          }
        })
        .catch((error: unknown) => {
          console.warn('[slice-14] 读取标签展示模式失败，保持 text', error);
        });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  return mode;
}
