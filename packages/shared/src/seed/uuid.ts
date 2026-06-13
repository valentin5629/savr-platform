import { createHash } from 'node:crypto';

// UUID v5 — SHA-1, RFC 4122
// Namespace fixe "savr-fixtures" : uuid v5 du DNS namespace + "savr-fixtures"
// Valeur calculée une fois et figée : f8b3e2a1-7c4d-5e9f-a0b1-c2d3e4f50001
const SEED_NS = 'f8b3e2a1-7c4d-5e9f-a0b1-c2d3e4f50001';

function uuidToBytes(uuid: string): Buffer {
  const hex = uuid.replace(/-/g, '');
  return Buffer.from(hex, 'hex');
}

function bytesToUuid(b: Buffer): string {
  const h = b.toString('hex');
  return [
    h.slice(0, 8),
    h.slice(8, 12),
    h.slice(12, 16),
    h.slice(16, 20),
    h.slice(20, 32),
  ].join('-');
}

export function seedUuid(slug: string): string {
  const nsBytes = uuidToBytes(SEED_NS);
  const nameBytes = Buffer.from(slug, 'utf8');
  const hash = createHash('sha1').update(nsBytes).update(nameBytes).digest();
  // version 5
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  // variant RFC 4122
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash.subarray(0, 16));
}
