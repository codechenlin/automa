/**
 * Solana Wallet Management for Automaton
 *
 * Generates and manages an Ed25519 keypair alongside the EVM wallet.
 * Enables the automaton to interact with Solana-native services (like Daybreak).
 * The Solana private key is stored in the same wallet.json file.
 */

import nacl from "tweetnacl";
import bs58 from "bs58";
import fs from "fs";
import path from "path";
import { getAutomatonDir, getWalletPath } from "./wallet.js";

interface WalletDataWithSolana {
  privateKey: `0x${string}`;
  createdAt: string;
  solanaPrivateKey?: string; // base58-encoded 64-byte secret key
}

/**
 * Get or create the automaton's Solana wallet.
 * Generates an Ed25519 keypair on first use, stores alongside EVM key.
 */
export function getSolanaWallet(): {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  address: string;
  isNew: boolean;
} {
  const walletPath = getWalletPath();

  if (!fs.existsSync(walletPath)) {
    throw new Error(
      "EVM wallet not initialized. Run getWallet() first to create the automaton identity.",
    );
  }

  const walletData: WalletDataWithSolana = JSON.parse(
    fs.readFileSync(walletPath, "utf-8"),
  );

  // If Solana key already exists, load it
  if (walletData.solanaPrivateKey) {
    const secretKey = bs58.decode(walletData.solanaPrivateKey);
    const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
    return {
      publicKey: keyPair.publicKey,
      secretKey: keyPair.secretKey,
      address: bs58.encode(keyPair.publicKey),
      isNew: false,
    };
  }

  // Generate new Ed25519 keypair
  const keyPair = nacl.sign.keyPair();

  // Store alongside EVM key
  walletData.solanaPrivateKey = bs58.encode(keyPair.secretKey);
  fs.writeFileSync(walletPath, JSON.stringify(walletData, null, 2), {
    mode: 0o600,
  });

  return {
    publicKey: keyPair.publicKey,
    secretKey: keyPair.secretKey,
    address: bs58.encode(keyPair.publicKey),
    isNew: true,
  };
}

/**
 * Get the Solana address without loading the full keypair.
 * Returns null if no Solana wallet has been generated yet.
 */
export function getSolanaAddress(): string | null {
  const walletPath = getWalletPath();

  if (!fs.existsSync(walletPath)) {
    return null;
  }

  const walletData: WalletDataWithSolana = JSON.parse(
    fs.readFileSync(walletPath, "utf-8"),
  );

  if (!walletData.solanaPrivateKey) {
    return null;
  }

  const secretKey = bs58.decode(walletData.solanaPrivateKey);
  const keyPair = nacl.sign.keyPair.fromSecretKey(secretKey);
  return bs58.encode(keyPair.publicKey);
}

/**
 * Sign a message with the Solana keypair (Ed25519 detached signature).
 * Returns the signature as a Uint8Array (64 bytes).
 */
export function signSolanaMessage(
  message: Uint8Array,
  secretKey: Uint8Array,
): Uint8Array {
  return nacl.sign.detached(message, secretKey);
}

/**
 * Check if a Solana wallet has been generated.
 */
export function hasSolanaWallet(): boolean {
  return getSolanaAddress() !== null;
}
