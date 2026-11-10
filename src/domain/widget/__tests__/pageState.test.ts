/**
 * 页状态收窄单测（切片 14 阶段 7b）：键名、守卫、收窄兜底。
 */

import {
  isWidgetPageName,
  narrowWidgetPageState,
  WIDGET_PAGE_STATE_DEFAULT,
  WIDGET_PAGE_STATE_PREFS_KEY,
} from '../pageState';

describe('WIDGET_PAGE_STATE_PREFS_KEY', () => {
  it('阶段 7b 键名 widget_page_state_v1', () => {
    expect(WIDGET_PAGE_STATE_PREFS_KEY).toBe('widget_page_state_v1');
  });

  it('默认页恒 today', () => {
    expect(WIDGET_PAGE_STATE_DEFAULT).toBe('today');
  });
});

describe('isWidgetPageName', () => {
  it('仅认 today / week（大小写敏感）', () => {
    expect(isWidgetPageName('today')).toBe(true);
    expect(isWidgetPageName('week')).toBe(true);
    expect(isWidgetPageName('TODAY')).toBe(false);
    expect(isWidgetPageName('month')).toBe(false);
    expect(isWidgetPageName(undefined)).toBe(false);
    expect(isWidgetPageName(null)).toBe(false);
    expect(isWidgetPageName(1)).toBe(false);
  });
});

describe('narrowWidgetPageState', () => {
  it('合法 { page } 往返', () => {
    expect(narrowWidgetPageState({ page: 'week' })).toBe('week');
    expect(narrowWidgetPageState({ page: 'today' })).toBe('today');
  });

  it('缺失/损坏回退 today（裸字符串、多余字段、非法值、非对象）', () => {
    expect(narrowWidgetPageState(null)).toBe('today');
    expect(narrowWidgetPageState(undefined)).toBe('today');
    expect(narrowWidgetPageState('week')).toBe('today');
    expect(narrowWidgetPageState({})).toBe('today');
    expect(narrowWidgetPageState({ page: 'nope' })).toBe('today');
    expect(narrowWidgetPageState({ page: 42 })).toBe('today');
    expect(narrowWidgetPageState({ other: 'week' })).toBe('today');
  });
});
