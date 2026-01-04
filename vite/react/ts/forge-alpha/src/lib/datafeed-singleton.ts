import { DataFeed } from './datafeed';

let instance: DataFeed | null = null;

export function getSharedDataFeed(): DataFeed {
  if (!instance) {
    instance = new DataFeed();
  }
  return instance;
}

export function cleanupDataFeed() {
  if (instance) {
    instance.unsubscribe();
    instance = null;
  }
}