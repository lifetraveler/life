import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { useFocusEffect } from 'expo-router';

import {
  isIgnoringBatteryOptimizations,
  openBatteryOptimizationSettings,
  requestIgnoreBatteryOptimizations,
  type BatteryOptimizationRequestResult,
} from '../../system/batteryOptimization';

/**
 * 后台运行保障设置页（切片 20 阶段 2，AGENTS.md §7.31 第三条）：
 * 展示当前电池优化白名单状态，未开启时提供「去开启」（唤起系统授权弹窗）与
 * 「打开电池优化系统设置页」（一键跳转，AGENTS §7.31）。
 *
 * 状态刷新的三个来源（系统弹窗关闭不产生任何 JS 可观察的生命周期事件，
 * 弹窗型 activity 只触发 onPause/onResume，AppState 与路由 focus 均不感知）：
 * 1. useFocusEffect——进入页面、路由返回时复查；
 * 2. AppState active——从全屏系统设置页返回时复查（settings-fallback 路径）；
 * 3. 弹窗结果返回后短轮询（1s × 至多 30s，翻「已开启」即停）——覆盖用户在
 *    授权弹窗停留任意时长后允许/拒绝的两种结局；超时未变可手动「重新检测」。
 */

/** 弹窗等待轮询：间隔与总时长（用户在系统弹窗内从容阅读文案的量级） */
const DIALOG_POLL_INTERVAL_MS = 1000;
const DIALOG_POLL_MAX_MS = 30000;

/** 申请结果 → 页内说明文案（与 BatteryOptimizationRequestResult 一一对应） */
const RESULT_NOTICES: Record<BatteryOptimizationRequestResult, string> = {
  dialog: '已唤起系统授权弹窗：选择「允许」加入白名单；允许后本页状态会自动刷新。',
  'settings-fallback':
    '系统未提供授权弹窗，已跳转电池优化设置页：请在列表中找到本应用并选择「不优化 / 忽略电池优化」。',
  unavailable:
    '无法唤起授权弹窗或设置页。请手动前往：系统设置 → 应用 → 本应用 → 电池 → 选择「不优化」。',
};

export default function BackgroundReliabilitySettingsPage() {
  const [checking, setChecking] = useState(true);
  /** null = 状态读取失败（读取错误见 error） */
  const [ignoring, setIgnoring] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [lastResult, setLastResult] =
    useState<BatteryOptimizationRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopPolling = useCallback((): void => {
    if (pollTimerRef.current !== null) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /** 复查白名单状态；读取失败时记录 error 并返回 null。 */
  const refreshStatus = useCallback(async (): Promise<boolean | null> => {
    try {
      const value = await isIgnoringBatteryOptimizations();
      setIgnoring(value);
      setError(null);
      return value;
    } catch (err) {
      console.warn('[slice-20] 白名单状态读取失败', err);
      setError(
        `状态读取失败：${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setChecking(true);
      void refreshStatus().finally(() => {
        if (active) {
          setChecking(false);
        }
      });
      return () => {
        active = false;
        stopPolling();
      };
    }, [refreshStatus, stopPolling]),
  );

  // 从全屏系统设置页返回（activity onStop→onStart）时复查。
  useEffect(() => {
    const handler = (status: AppStateStatus): void => {
      if (status === 'active') {
        void refreshStatus();
      }
    };
    const subscription = AppState.addEventListener('change', handler);
    return () => {
      subscription.remove();
    };
  }, [refreshStatus]);

  /** 弹窗已唤起后的短轮询：每 1s 复查，翻「已开启」即停；至多 30s。 */
  const startDialogPolling = useCallback((): void => {
    stopPolling();
    const startedAt = Date.now();
    const tick = (): void => {
      pollTimerRef.current = setTimeout(() => {
        void refreshStatus().then((value) => {
          if (value === true) {
            stopPolling();
            return;
          }
          if (Date.now() - startedAt < DIALOG_POLL_MAX_MS) {
            tick();
          }
        });
      }, DIALOG_POLL_INTERVAL_MS);
    };
    tick();
  }, [refreshStatus, stopPolling]);

  const handleRequest = async (): Promise<void> => {
    if (requesting) {
      return;
    }
    setRequesting(true);
    try {
      const result = await requestIgnoreBatteryOptimizations();
      setLastResult(result);
      if (result === 'dialog') {
        startDialogPolling();
      } else {
        // settings-fallback / unavailable：立即复查一次（用户可能此前已手动处理）。
        void refreshStatus();
      }
    } catch (err) {
      console.warn('[slice-20] 白名单申请失败', err);
      setError(
        `申请失败：${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setRequesting(false);
    }
  };

  const handleOpenSettings = async (): Promise<void> => {
    const opened = await openBatteryOptimizationSettings();
    setLastResult(opened ? 'settings-fallback' : 'unavailable');
    void refreshStatus();
  };

  if (checking) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.hint}>
        网络渠道提醒（Webhook / Apprise）由 App 进程内的定时器发送；进程被系统
        省电策略冻结后，到点提醒将丢失。加入电池优化白名单可以降低被系统冻结的概率。
      </Text>
      <Text style={styles.hint}>
        注意：白名单不保证 100% 送达——厂商省电策略、用户主动强杀或系统强制停止仍可能
        中断投递；被中断的提醒会在 App 下次启动时补发。
      </Text>

      <View style={styles.statusCard}>
        <Text style={styles.statusLabel}>电池优化白名单</Text>
        {ignoring === true ? (
          <Text style={styles.statusOn}>已开启</Text>
        ) : (
          <Text style={styles.statusOff}>
            {ignoring === false ? '未开启' : '状态不可用'}
          </Text>
        )}
        <Pressable onPress={() => void refreshStatus()}>
          <Text style={styles.recheckText}>重新检测</Text>
        </Pressable>
      </View>

      {ignoring === false ? (
        <>
          <Pressable
            style={[styles.primaryButton, requesting && styles.disabled]}
            disabled={requesting}
            onPress={() => void handleRequest()}
          >
            <Text style={styles.primaryText}>
              {requesting ? '正在唤起…' : '去开启'}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.secondaryButton, requesting && styles.disabled]}
            disabled={requesting}
            onPress={() => void handleOpenSettings()}
          >
            <Text style={styles.secondaryText}>打开电池优化系统设置页</Text>
          </Pressable>
        </>
      ) : null}

      {ignoring === true ? (
        <Text style={styles.hint}>
          如需摘除白名单：系统设置 → 应用 → 特殊应用权限 → 电池优化 → 本应用 →
          选择「优化」。
        </Text>
      ) : null}

      {lastResult !== null ? (
        <Text style={styles.noticeText}>{RESULT_NOTICES[lastResult]}</Text>
      ) : null}
      {error !== null ? <Text style={styles.errorText}>{error}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  container: {
    padding: 16,
    paddingBottom: 32,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#888',
    lineHeight: 18,
    marginBottom: 8,
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 14,
    marginTop: 8,
    marginBottom: 16,
  },
  statusLabel: {
    fontSize: 14,
    color: '#333',
    marginBottom: 6,
  },
  statusOn: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1e6f5c',
    marginBottom: 6,
  },
  statusOff: {
    fontSize: 20,
    fontWeight: '700',
    color: '#b00020',
    marginBottom: 6,
  },
  recheckText: {
    fontSize: 12,
    color: '#1976d2',
  },
  primaryButton: {
    backgroundColor: '#1e6f5c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  primaryText: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  secondaryButton: {
    borderWidth: 1,
    borderColor: '#1e6f5c',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    marginBottom: 10,
  },
  secondaryText: {
    fontSize: 14,
    color: '#1e6f5c',
    fontWeight: '600',
  },
  noticeText: {
    fontSize: 12,
    color: '#555',
    lineHeight: 18,
    marginTop: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#c62828',
    marginTop: 8,
  },
  disabled: {
    opacity: 0.5,
  },
});
