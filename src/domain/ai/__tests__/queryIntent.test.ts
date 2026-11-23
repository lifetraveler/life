/**
 * matchesScheduleQueryIntent 纯函数单测（切片 36 阶段 1，AGENTS.md §7.48 提案 D1）：
 * 保守预路由——先排除后疑问；漏判走录入（用户重述兜底）、误判代价高。
 * 矩阵覆盖：疑问表命中 / 排除表优先 / 短语级正则（「安排了/预约了」后无
 * 事由名词才命中）/ 空输入与纯录入句不判查询。
 */

import {
  SCHEDULE_QUERY_EXCLUDE_WORDS,
  SCHEDULE_QUERY_HINT_WORDS,
  matchesScheduleQueryIntent,
} from '../queryIntent';

describe('matchesScheduleQueryIntent（查询预路由，切片 36）', () => {
  it('词表常量完整性：排除表 8 词、疑问表 12 词（冻结集合，扩充须过提案）', () => {
    expect(SCHEDULE_QUERY_EXCLUDE_WORDS).toEqual([
      '帮我记',
      '帮我安排',
      '提醒我',
      '改成',
      '改到',
      '加一个',
      '新增',
      '推迟',
    ]);
    expect(SCHEDULE_QUERY_HINT_WORDS).toEqual([
      '什么',
      '哪些',
      '有没有',
      '忙不忙',
      '空吗',
      '有空吗',
      '几号',
      '周几',
      '星期几',
      '查一下',
      '看看我',
      '提醒过我',
    ]);
  });

  it('空输入 / 纯空白 → false（调用方 trim 已拦空，此处兜底防误路由）', () => {
    expect(matchesScheduleQueryIntent('')).toBe(false);
    expect(matchesScheduleQueryIntent('   ')).toBe(false);
  });

  it('疑问表命中 → true（代表性疑问句矩阵）', () => {
    expect(matchesScheduleQueryIntent('明天有什么安排')).toBe(true);
    expect(matchesScheduleQueryIntent('这周哪些天有空')).toBe(true);
    expect(matchesScheduleQueryIntent('周六有没有约')).toBe(true);
    expect(matchesScheduleQueryIntent('下周忙不忙')).toBe(true);
    expect(matchesScheduleQueryIntent('周五下午空吗')).toBe(true);
    expect(matchesScheduleQueryIntent('这个月几号有空')).toBe(true);
    expect(matchesScheduleQueryIntent('下周三是周几')).toBe(true);
    expect(matchesScheduleQueryIntent('帮我查一下周五的日程')).toBe(true);
    expect(matchesScheduleQueryIntent('看看我下个月的安排')).toBe(true);
    expect(matchesScheduleQueryIntent('牙医提醒过我吗')).toBe(true);
  });

  it('排除表优先于疑问表：含录入/编辑动词 → false（即便句中含疑问词）', () => {
    expect(matchesScheduleQueryIntent('帮我记一下明天开会')).toBe(false);
    expect(matchesScheduleQueryIntent('帮我安排周五下午的复盘')).toBe(false);
    expect(matchesScheduleQueryIntent('提醒我明天8点吃药')).toBe(false);
    expect(matchesScheduleQueryIntent('改成明天下午3点')).toBe(false);
    expect(matchesScheduleQueryIntent('改到周二的话还有什么')).toBe(false);
    expect(matchesScheduleQueryIntent('加一个周六晨跑')).toBe(false);
    expect(matchesScheduleQueryIntent('新增一个下周三的会')).toBe(false);
    expect(matchesScheduleQueryIntent('推迟到下周再说')).toBe(false);
  });

  it('短语级正则：「安排了/预约了」后无事由名词（句尾/语气助词）→ true', () => {
    expect(matchesScheduleQueryIntent('周六安排了吗')).toBe(true);
    expect(matchesScheduleQueryIntent('这个月安排了')).toBe(true);
    expect(matchesScheduleQueryIntent('体检预约了没')).toBe(true);
    expect(matchesScheduleQueryIntent('下午的会预约了')).toBe(true);
  });

  it('短语级负向环视：「安排了/预约了」后带事由名词 → false（照常走解析录入）', () => {
    expect(matchesScheduleQueryIntent('周六安排了体检')).toBe(false);
    expect(matchesScheduleQueryIntent('下午安排了会议')).toBe(false);
    expect(matchesScheduleQueryIntent('明天预约了牙医')).toBe(false);
    expect(matchesScheduleQueryIntent('周五安排了gym')).toBe(false);
  });

  it('两表都不含的普通录入句 → false（不判查询）', () => {
    expect(matchesScheduleQueryIntent('明天下午3点开会')).toBe(false);
    expect(matchesScheduleQueryIntent('买牛奶')).toBe(false);
    expect(matchesScheduleQueryIntent('下午2点')).toBe(false); // 澄清待补轮不含疑问词
  });
});
