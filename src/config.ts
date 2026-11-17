/** C8: static config keys under worlds.qq-digest.*; defaults().enabled must be false. */
import type { ConfigGroup } from 'cortico/core/types.ts';
import { MAX_ACTIVE_RECORDS } from './types.ts';

export interface QqDigestConfigSection {
  enabled: boolean;
  /** GUESS starting value, not a platform constant. */
  maxActiveRecords: number;
  reminderIntervalMin: number;
}

export const QQD_DEFAULTS: QqDigestConfigSection = {
  enabled: false,
  maxActiveRecords: MAX_ACTIVE_RECORDS,
  reminderIntervalMin: 60,
};

/** dry-mount requires every schema path to start with worlds.qq-digest. and exist in defaults(). */
export const QQD_CONFIG_GROUP: ConfigGroup = {
  id: 'world:qq-digest',
  owner: 'world:qq-digest',
  schema: {
    type: 'object',
    title: 'QQ 群消息摘要',
    properties: {
      'worlds.qq-digest.maxActiveRecords': {
        type: 'integer', minimum: 1, maximum: 100000,
        title: '每群活动记录上限',
        description: '起点值 2000 是猜测值，非平台既定数；超出后按时间归档。',
      },
      'worlds.qq-digest.reminderIntervalMin': {
        type: 'integer', minimum: 1, maximum: 1440,
        title: '积压提醒间隔（分钟）',
      },
    },
  },
};
