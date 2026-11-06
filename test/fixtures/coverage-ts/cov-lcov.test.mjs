
import { test } from "file:///home/lina/dev/rainbow-labs/lib/section-tests/dist/index.js";
import { add } from './dist/calc.js';

export default [ test('adds', async () => { if (add(0, 0) !== 0) throw new Error('x'); }) ];
