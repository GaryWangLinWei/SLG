import test from 'node:test';
import assert from 'node:assert/strict';
import { createBuildPlan } from './build-editions.mjs';

test('creates isolated main and agent build steps', async () => {
  const plan = await createBuildPlan('1.2.0');
  assert.deepEqual(plan.map((x) => x.edition), ['main', 'agent']);
  assert.equal(plan[0].env.VITE_APP_EDITION, 'main');
  assert.equal(plan[1].env.VITE_APP_EDITION, 'agent');
  assert.equal(plan[0].metadata.id, 'main');
  assert.notEqual(plan[0].outputDir, plan[1].outputDir);
  assert.match(plan[1].artifactName, /代理商版/);
});
