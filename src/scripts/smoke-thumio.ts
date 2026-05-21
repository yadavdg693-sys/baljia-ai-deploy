import { critiqueDesign } from '@/lib/services/design-critic.service';

(async () => {
  const url = process.argv[2] ?? 'https://equityzen.baljia.app';
  console.log('Critiquing', url);
  const t0 = Date.now();
  const result = await critiqueDesign(url);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n--- result (${elapsed}s) ---\n`);
  console.log(result);
})();
