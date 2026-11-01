import { Database, Q } from '@nozbe/watermelondb';

import type { CreateItemInput, Item } from '../domain/item';
import ItemModel from '../db/models/ItemModel';
import type { ItemRepository } from './ItemRepository';

const ITEMS_TABLE = 'items';

function toDomainItem(model: ItemModel): Item {
  return {
    id: model.id,
    type: model.type,
    title: model.title,
    content: model.content,
    status: model.status,
    createdAt: model.createdAt.getTime(),
    updatedAt: model.updatedAt.getTime(),
  };
}

/**
 * ItemRepository 的 WatermelonDB 实现。UI 与业务层不得直接使用本类之外的 WatermelonDB API。
 */
export class WatermelonItemRepository implements ItemRepository {
  private readonly db: Database;

  constructor(db: Database) {
    this.db = db;
  }

  async createItem(input: CreateItemInput): Promise<Item> {
    const title = input.title.trim();
    if (title.length === 0) {
      throw new Error('createItem: title is required');
    }

    const created = await this.db.write(async () => {
      const item = await this.db.get<ItemModel>(ITEMS_TABLE).create((record) => {
        record.type = input.type;
        record.title = title;
        record.content = input.content ?? '';
        record.status = 'active';
      });
      return item;
    });

    return toDomainItem(created);
  }

  async listItems(): Promise<Item[]> {
    const models = await this.db.get<ItemModel>(ITEMS_TABLE).query().fetch();
    return models.map(toDomainItem);
  }

  observeItems(onNext: (items: Item[]) => void): () => void {
    const subscription = this.db
      .get<ItemModel>(ITEMS_TABLE)
      .query(Q.sortBy('created_at', 'desc'))
      .observe()
      .subscribe((models) => {
        onNext(models.map(toDomainItem));
      });

    return (): void => {
      subscription.unsubscribe();
    };
  }
}
