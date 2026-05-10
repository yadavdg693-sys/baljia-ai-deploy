// Verify the DISABLE_COST_CEILING env var path.
import { getCostCeilingForAgent } from '@/lib/agents/cost-ceilings';

console.log('DISABLE_COST_CEILING =', JSON.stringify(process.env.DISABLE_COST_CEILING));
console.log('');
console.log('Engineering complexity 3:', getCostCeilingForAgent(30, 3));
console.log('Engineering complexity 10:', getCostCeilingForAgent(30, 10));
console.log('Browser:', getCostCeilingForAgent(42));
console.log('CEO:', getCostCeilingForAgent(0));
console.log('Research:', getCostCeilingForAgent(29));
process.exit(0);
