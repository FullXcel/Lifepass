import { ingestPolicySources } from './lib/ingestionRunner.js';

const result = await ingestPolicySources({ forceReview: process.argv.includes('--force-review') });
console.log(JSON.stringify(result, null, 2));
