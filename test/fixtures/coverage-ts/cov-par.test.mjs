
import { test } from "file:///home/lina/dev/rainbow-labs/lib/section-tests/dist/index.js";
import { add } from './dist/calc.js';
export default [
  test('a', async () => { add(1, 0); }),
  test('b', async () => { add(0, 1); }),
];
