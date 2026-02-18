/**
 * Solana x402 Payment Protocol
 *
 * Handles x402 payments for Solana-native services (Ed25519 signatures).
 * This complements the existing EVM x402 module (EIP-712 / viem).
 *
 * Payment flow:
 * 1. GET url → 402 with X-PAYMENT-DETAILS header
 * 2. Detect Solana network in payment requirements
 * 3. Construct canonical message → SHA-256 → Ed25519 sign
 * 4. Retry with X-Payment header containing signed payload
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import { createHash, randomBytes } from "crypto";

interface SolanaPaymentRequirement {
  scheme: string;
  network: string;
  asset: string;
  maxAmountRequired: string;
  payTo: string;
  validUntil: number;
}

interface SolanaPaymentDetails {
  accepts: SolanaPaymentRequirement[];
  description: string;
  resource: string;
}

interface SolanaX402Result {
  success: boolean;
  response?: any;
  error?: string;
  status?: number;
}

/**
 * Check if a payment requirement is for a Solana network.
 */
export function isSolanaNetwork(network: string): boolean {
  const lower = network.toLowerCase();
  return lower === "solana" || lower === "solana-devnet" || lower === "solana-mainnet";
}

/**
 * Parse the X-PAYMENT-DETAILS header from a 402 response.
 * Supports both base64-encoded and raw JSON formats.
 */
function parsePaymentDetails(resp: Response): SolanaPaymentDetails | null {
  // Try X-PAYMENT-DETAILS header first
  const detailsHeader = resp.headers.get("X-PAYMENT-DETAILS");
  if (detailsHeader) {
    try {
      const decoded = Buffer.from(detailsHeader, "base64").toString("utf-8");
      return JSON.parse(decoded);
    } catch {
      // Try direct JSON parse
      try {
        return JSON.parse(detailsHeader);
      } catch {
        // fall through to body
      }
    }
  }

  return null;
}

/**
 * Find the first Solana payment requirement from a 402 response.
 */
function findSolanaRequirement(
  details: SolanaPaymentDetails,
): SolanaPaymentRequirement | null {
  if (!details.accepts || !Array.isArray(details.accepts)) return null;
  return details.accepts.find((r) => isSolanaNetwork(r.network)) ?? null;
}

/**
 * Sign a Solana x402 payment.
 * Constructs the canonical message matching Daybreak's server-side verification:
 *   JSON.stringify({scheme, network, asset, amount, payTo, nonce, timestamp, validUntil})
 *   → SHA-256 → Ed25519 sign
 */
function signSolanaPayment(
  requirement: SolanaPaymentRequirement,
  secretKey: Uint8Array,
  publicKey: Uint8Array,
): {
  paymentOption: SolanaPaymentRequirement;
  signature: string;
  payer: string;
  nonce: string;
  timestamp: number;
} {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Math.floor(Date.now() / 1000);

  // Canonical message format — must match server-side reconstruction
  const message = JSON.stringify({
    scheme: requirement.scheme,
    network: requirement.network,
    asset: requirement.asset,
    amount: requirement.maxAmountRequired,
    payTo: requirement.payTo,
    nonce,
    timestamp,
    validUntil: requirement.validUntil,
  });

  // SHA-256 hash of the message
  const messageBytes = new TextEncoder().encode(message);
  const messageHash = createHash("sha256").update(messageBytes).digest();

  // Ed25519 detached signature
  const signature = nacl.sign.detached(new Uint8Array(messageHash), secretKey);

  return {
    paymentOption: requirement,
    signature: bs58.encode(signature),
    payer: bs58.encode(publicKey),
    nonce,
    timestamp,
  };
}

/**
 * Fetch a URL with automatic Solana x402 payment.
 * If the endpoint returns 402 with a Solana payment requirement,
 * signs the payment with the Ed25519 keypair and retries.
 */
export async function solanaX402Fetch(
  url: string,
  secretKey: Uint8Array,
  publicKey: Uint8Array,
  method: string = "GET",
  body?: string,
  headers?: Record<string, string>,
): Promise<SolanaX402Result> {
  try {
    // Initial request
    const initialResp = await fetch(url, {
      method,
      headers: { ...headers, "Content-Type": "application/json" },
      body,
    });

    if (initialResp.status !== 402) {
      const data = await initialResp
        .json()
        .catch(() => initialResp.text());
      return {
        success: initialResp.ok,
        response: data,
        status: initialResp.status,
      };
    }

    // Parse payment details from 402 response
    const details = parsePaymentDetails(initialResp);
    if (!details) {
      // Try parsing from body
      try {
        const bodyJson = await initialResp.json();
        if (bodyJson.details) {
          const requirement = findSolanaRequirement(bodyJson.details);
          if (requirement) {
            return await retryWithPayment(
              url,
              requirement,
              secretKey,
              publicKey,
              method,
              body,
              headers,
            );
          }
        }
      } catch {
        // ignore
      }
      return {
        success: false,
        error: "Could not parse Solana payment requirements from 402 response",
        status: 402,
      };
    }

    const requirement = findSolanaRequirement(details);
    if (!requirement) {
      return {
        success: false,
        error:
          "402 response has no Solana payment option. Available networks: " +
          details.accepts.map((a) => a.network).join(", "),
        status: 402,
      };
    }

    return await retryWithPayment(
      url,
      requirement,
      secretKey,
      publicKey,
      method,
      body,
      headers,
    );
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

async function retryWithPayment(
  url: string,
  requirement: SolanaPaymentRequirement,
  secretKey: Uint8Array,
  publicKey: Uint8Array,
  method: string,
  body?: string,
  headers?: Record<string, string>,
): Promise<SolanaX402Result> {
  const payment = signSolanaPayment(requirement, secretKey, publicKey);
  const paymentHeader = Buffer.from(JSON.stringify(payment)).toString("base64");

  const paidResp = await fetch(url, {
    method,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      "X-Payment": paymentHeader,
    },
    body,
  });

  const data = await paidResp.json().catch(() => paidResp.text());
  return { success: paidResp.ok, response: data, status: paidResp.status };
}
