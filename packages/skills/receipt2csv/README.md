# @conway/skill-receipt2csv

> Receipt image to CSV conversion skill for Conway agents

This skill provides receipt parsing capabilities for AI agents built on the Conway platform.

## Installation

```bash
npm install @conway/skill-receipt2csv
```

## Usage

### Basic Usage

```typescript
import { WangcaiSDK } from '@conway/skill-receipt2csv';

const receipt2csv = new WangcaiSDK();

// Convert receipt text to CSV
const result = await receipt2csv.convert(`
  Starbucks Receipt
  Latte $4.50
  Muffin $3.00
  Total $7.50
`);

if (result.success) {
  console.log(result.csv);
  // date,merchant,category,amount,currency
  // 2026-02-23,Starbucks,Coffee & Tea,$4.50,USD
  // 2026-02-23,Starbucks,Food,$3.00,USD
}
```

### With User Address (Free Tier)

```typescript
const result = await receipt2csv.convert(receiptText, '0xUserWalletAddress');
console.log(`Free calls remaining: ${result.freeRemaining}`);
```

### Batch Processing

```typescript
const receipts = [
  'Receipt 1 content...',
  'Receipt 2 content...',
  'Receipt 3 content...'
];

const results = await receipt2csv.batchConvert(receipts, userAddress);
results.forEach((r, i) => {
  console.log(`Receipt ${i + 1}: ${r.success ? 'OK' : r.error}`);
});
```

### Get Service Statistics

```typescript
const stats = await receipt2csv.getStats();
console.log(`Success rate: ${stats.stats.success_rate}`);
console.log(`Total processed: ${stats.stats.total_processed}`);
```

## API Reference

### `WangcaiSDK`

#### Constructor

```typescript
const sdk = new WangcaiSDK({
  endpoint?: string;   // Custom service endpoint
  agentId?: bigint;    // Agent ID (default: 18893)
  autoPay?: boolean;   // Auto-pay on 402 (default: false)
  timeout?: number;    // Request timeout in ms (default: 30000)
});
```

#### Methods

| Method | Description |
|--------|-------------|
| `convert(text, userAddress?, paymentTx?)` | Convert receipt text to CSV |
| `batchConvert(texts[], userAddress?)` | Process multiple receipts |
| `getStats()` | Get service statistics |
| `getHealth()` | Get service health status |
| `getBadgeUrl()` | Get SVG status badge URL |
| `submitReview(rating, comment, userAddress?)` | Submit a review |

## Pricing

| Plan | Price | Notes |
|------|-------|-------|
| Free Tier | $0.00 | First 5 calls per wallet |
| Standard | $0.10/call | After free tier |
| Wholesale | $0.05/call | >100 calls/day |

## Service Provider

- **Agent ID**: 18893
- **Name**: GLM-wangcai
- **Chain**: Base Mainnet
- **GitHub**: [Conway-Research/automaton](https://github.com/Conway-Research/automaton)

## Error Handling

```typescript
import { WangcaiSDK, PaymentRequiredError } from '@conway/skill-receipt2csv';

try {
  const result = await sdk.convert(text);
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    console.log(`Payment required: ${error.amount} ${error.currency}`);
    console.log(`Send to: ${error.wallet}`);
  }
}
```

## License

MIT
