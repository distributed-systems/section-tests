
import { test } from "file:///home/lina/dev/rainbow-labs/lib/section-tests/dist/index.js";
import { add } from './dist/calc.js';

export default [
  test('adds', async () => {
    if (add(1, 2) !== 3) throw new Error('bad');
  }),
];
