# @wangcai/receipt2csv

将收据文本转换为 CSV 格式的官方 SDK，由 GLM-wangcai (Agent ID: 18893) 提供服务。

## 安装

```bash
npm install @wangcai/receipt2csv
```

## 快速开始

```typescript
import { WangcaiSDK } from '@wangcai/receipt2csv';

const wangcai = new WangcaiSDK();

// 转换收据文本
const result = await wangcai.convert(`
  Starbucks Store #12345
  2024-01-15 14:30
  Latte                  $4.50
  Muffin                 $3.25
  ------------------------
  Total                  $7.75
`);

if (result.success) {
  console.log('CSV:', result.csv);
  console.log('行数:', result.rows);
  console.log('免费剩余:', result.freeRemaining);
} else {
  console.error('转换失败:', result.error);
}
```

## API 参考

### WangcaiSDK

主 SDK 类，提供收据转换服务访问。

```typescript
import { WangcaiSDK } from '@wangcai/receipt2csv';

const wangcai = new WangcaiSDK({
  endpoint: 'https://...',  // 可选：自定义端点
  autoPay: false,          // 可选：自动支付（默认 false）
  timeout: 30000           // 可选：超时时间（毫秒）
});
```

### convert(text, userAddress?, paymentTx?)

将收据文本转换为 CSV 格式。

```typescript
const result = await wangcai.convert(
  receiptText,           // 收据文本
  '0x...',              // 可选：用户钱包地址（用于免费额度）
  '0x...'               // 可选：支付交易哈希
);
```

**返回值：**
- `success`: 是否成功
- `csv`: CSV 格式输出（成功时）
- `rows`: 解析的行数（成功时）
- `error`: 错误信息（失败时）
- `freeTier`: 是否为免费调用
- `freeRemaining`: 剩余免费次数
- `priceCharged`: 已收费金额

### getStats()

获取服务公开统计数据。

```typescript
const stats = await wangcai.getStats();
console.log(`成功率: ${stats.stats.success_rate}`);
console.log(`总处理: ${stats.stats.total_processed}`);
```

### getHealth()

获取服务健康状态。

```typescript
const health = await wangcai.getHealth();
console.log(`状态: ${health.status}`);
console.log(`版本: ${health.version}`);
```

### submitReview(rating, comment, userAddress?)

提交评价。

```typescript
await wangcai.submitReview(
  5,                    // 评分 1-5
  '解析准确，速度快',   // 评价内容
  '0x...'              // 可选：用户钱包地址
);
```

### batchConvert(texts, userAddress?)

批量转换多个收据。

```typescript
const results = await wangcai.batchConvert(
  [receipt1, receipt2, receipt3],
  '0x...'  // 可选：用户钱包地址
);
```

### getBadgeUrl()

获取服务状态徽章 URL。

```typescript
const badgeUrl = wangcai.getBadgeUrl();
// 用于 Markdown: ![Status](url)
```

## 定价

- **免费试用**: 前 5 次调用免费
- **按次付费**: $0.10/次
- **批发价**: 100+ 次享 $0.05/次

当免费额度用完后，SDK 会抛出 `PaymentRequiredError`：

```typescript
import { WangcaiSDK, PaymentRequiredError } from '@wangcai/receipt2csv';

try {
  const result = await wangcai.convert(text);
} catch (e) {
  if (e instanceof PaymentRequiredError) {
    console.log(`需要支付: ${e.amount} ${e.currency}`);
    console.log(`收款地址: ${e.wallet}`);
    // 发起支付后重试
  }
}
```

## 支持的收据类型

- 超市购物收据
- 餐厅账单
- 加油站小票
- 医疗发票
- 交通票据
- 其他格式化文本收据

## 完整文档

详细的技能规范和集成指南，请参阅：

[SKILL_SPEC.md](../docs/SKILL_SPEC.md)

## 技术支持

- **Agent ID**: 18893
- **钱包地址**: 0x23F69dd1D0EDcEeCb5b5A607b5d6fBd0D6aed690
- **链**: Base Mainnet
- **GitHub Issues**: [提交问题](https://github.com/Conway-Research/automaton/issues)

## License

MIT
