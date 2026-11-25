import { test, expect } from 'bun:test';
import { buildTree, exceptionSource } from '../src/lib/categories.js';

const cats = [
  { id: 'jp', parent_id: null, kind: 'expense', name: '日本', sort_order: 0 },
  { id: 'jp-food', parent_id: 'jp', kind: 'expense', name: '吃', sort_order: 0 },
  { id: 'jp-food-x', parent_id: 'jp-food', kind: 'expense', name: '拉麵', sort_order: 0 },
  { id: 'daily', parent_id: null, kind: 'expense', name: '日常', sort_order: 1 },
];
const tree = buildTree(cats);

test('上層設成一律算例外，底下的子分類都算', () => {
  expect(exceptionSource(tree, 'jp-food-x', ['jp'])?.id).toBe('jp');
  expect(exceptionSource(tree, 'jp', ['jp'])?.id).toBe('jp');
  expect(exceptionSource(tree, 'daily', ['jp'])).toBeNull();
  expect(exceptionSource(tree, 'jp-food', [])).toBeNull();
  expect(exceptionSource(tree, null, ['jp'])).toBeNull();
});
