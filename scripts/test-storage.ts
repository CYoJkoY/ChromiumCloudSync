import assert from 'node:assert/strict';
import { enqueueMutation, resetMutationQueueForTests } from '../storage.ts';

let active = 0;
let maxActive = 0;
resetMutationQueueForTests();

const tasks = Array.from({ length: 20 }, (_, index) => enqueueMutation(async () => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  await new Promise((resolve) => setTimeout(resolve, index % 3));
  active -= 1;
  return index;
}));

const results = await Promise.all(tasks);
assert.deepEqual(results, Array.from({ length: 20 }, (_, index) => index));
assert.equal(maxActive, 1, 'storage mutations must execute serially');
console.log('storage queue tests: OK');
