import './polyfills';

import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';

import ItemModel from './models/ItemModel';
import { schema } from './schema';
import migrations from './migrations';

const adapter = new SQLiteAdapter({
  dbName: 'life',
  schema,
  migrations,
  jsi: true,
  onSetUpError: (error) => {
    console.error('WatermelonDB setup failed:', error);
  },
});

export const database = new Database({
  adapter,
  modelClasses: [ItemModel],
});
