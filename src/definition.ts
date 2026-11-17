/** A0 assembly: WorldDefinition + self-description consumed by describe:extension. */
import { describeTools, type WorldDefinition } from 'cortico/world.ts';
import { QQD_DEFAULTS, type QqDigestConfigSection } from './config.ts';
import { TOOL_DECLS } from './tools.ts';
import { QqDigestWorld } from './world.ts';

const SUMMARIES: Record<string, { zh: string; en: string }> = {
  qqd_add: { zh: '核验来源后写入一条分类记录。', en: 'Verify the source, then add one classified record.' },
  qqd_update: { zh: '按 id 修改一条记录。', en: 'Update one record by id.' },
  qqd_list: { zh: '按会话与类别列出记录。', en: 'List records by conversation and category.' },
  qqd_remove: { zh: '按 id 删除本包记录。', en: 'Remove one package-owned record by id.' },
};

export const QQ_DIGEST: WorldDefinition<QqDigestConfigSection> = {
  id: 'qq-digest',
  label: 'QQ 群消息摘要',
  defaults: () => ({ ...QQD_DEFAULTS }),
  create: (ctx) => new QqDigestWorld(ctx),
  describe: {
    tools: describeTools(TOOL_DECLS, SUMMARIES),
    events: [
      {
        type: 'qq-digest.reminder',
        description: { zh: '积压提醒，只报计数不含群聊原文。', en: 'Backlog reminder with counts only.' },
      },
      {
        type: 'qq-digest.audit',
        description: { zh: '拒绝写入的审计记录，不含群聊原文。', en: 'Rejected-write audit entry without group text.' },
      },
    ],
  },
};
