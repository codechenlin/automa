/**
 * Basic usage example for @conway/skill-receipt2csv
 *
 * Run with: npx ts-node examples/basic-usage.ts
 */

import { WangcaiSDK, PaymentRequiredError } from '../src/index';

async function main() {
  const sdk = new WangcaiSDK();

  console.log('=== GLM-wangcai Receipt2CSV Example ===\n');

  // Example receipt text
  const receiptText = `
    STARBUCKS STORE #12345
    123 Main Street
    Date: 2026-02-23 10:30 AM

    Grande Latte          $4.50
    Blueberry Muffin      $3.00
    -------------------------
    Subtotal             $7.50
    Tax                   $0.68
    -------------------------
    TOTAL                $8.18

    Thank you for visiting!
  `;

  try {
    // Convert receipt to CSV
    console.log('Converting receipt...');
    const result = await sdk.convert(receiptText);

    if (result.success) {
      console.log('\n✅ Conversion successful!\n');
      console.log('CSV Output:');
      console.log('---');
      console.log(result.csv);
      console.log('---');
      console.log(`\nRows parsed: ${result.rows}`);
      console.log(`Free tier: ${result.freeTier}`);
      console.log(`Free calls remaining: ${result.freeRemaining}`);
    } else {
      console.log(`❌ Conversion failed: ${result.error}`);
    }

    // Get service stats
    console.log('\n=== Service Statistics ===\n');
    const stats = await sdk.getStats();
    console.log(`Service: ${stats.service}`);
    console.log(`Agent ID: ${stats.agent_id}`);
    console.log(`Total processed: ${stats.stats.total_processed}`);
    console.log(`Success rate: ${stats.stats.success_rate}`);
    console.log(`Avg response time: ${stats.stats.avg_response_time}`);
    console.log(`Uptime: ${stats.stats.uptime_days} days`);

    // Get status badge URL
    console.log(`\nStatus badge: ${sdk.getBadgeUrl()}`);

  } catch (error) {
    if (error instanceof PaymentRequiredError) {
      console.log('\n⚠️  Payment Required');
      console.log(`Amount: ${error.amount} ${error.currency}`);
      console.log(`Wallet: ${error.wallet}`);
      console.log('\nPlease send payment and retry with the transaction hash.');
    } else {
      console.error('Error:', error);
    }
  }
}

main().catch(console.error);
