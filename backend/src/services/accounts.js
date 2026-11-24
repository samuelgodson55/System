/**
 * Shared account rules: username / password validation, temporary-password generation and the
 * one-time admin recovery codes. Used by the auth and user-management routes.
 */
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export const USERNAME_RE = /^[A-Za-z0-9._-]{3,50}$/
export const MIN_PASSWORD = 8
// bcrypt only reads the first 72 BYTES of a password: a longer one would be silently cut short, so refuse it
export const MAX_PASSWORD_BYTES = 72
export const ROLES = ['admin', 'staff']
export const BCRYPT_COST = 10

/** Returns an error message, or null when the password is acceptable. */
export function passwordProblem(pw, label = 'Password') {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD) return `${label} must be at least ${MIN_PASSWORD} characters`
  if (Buffer.byteLength(pw) > MAX_PASSWORD_BYTES) return `${label} is too long (at most ${MAX_PASSWORD_BYTES} bytes)`
  return null
}

const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' // no look-alikes (0/O, 1/l/I)

/** A random temporary password (cryptographically secure, unbiased). Shown once, must be changed at first sign-in. */
export function generateTempPassword(length = 12) {
  let out = ''
  for (let i = 0; i < length; i++) out += PW_ALPHABET[crypto.randomInt(PW_ALPHABET.length)]
  return out
}

// ---- recovery codes ---------------------------------------------------------------------------------
export const RECOVERY_CODE_COUNT = 10
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // 32 symbols, no look-alikes
const CODE_LENGTH = 12 // 12 x 5 bits = 60 bits of randomness per code, shown as XXXX-XXXX-XXXX

/** Upper-case, drop spaces/dashes: "abcd efgh-jkmn" and "ABCDEFGHJKMN" are the same code. */
export const normalizeRecoveryCode = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '')

function newCode() {
  let raw = ''
  for (let i = 0; i < CODE_LENGTH; i++) raw += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)]
  return raw
}
export const formatRecoveryCode = (raw) => raw.match(/.{1,4}/g).join('-')

/** Makes a fresh set. `plain` is shown to the admin once; `stored` (hashes only) goes in the database. */
export async function generateRecoveryCodes() {
  const raws = Array.from({ length: RECOVERY_CODE_COUNT }, newCode)
  const stored = await Promise.all(raws.map(async (r) => ({ h: await bcrypt.hash(r, BCRYPT_COST), used: null })))
  return { plain: raws.map(formatRecoveryCode), stored }
}

export const countUnusedCodes = (codes) =>
  Array.isArray(codes) ? codes.filter((c) => c && c.h && !c.used).length : 0

/** Index of the unused stored code that matches `input`, or -1. */
export async function findRecoveryCode(codes, input) {
  const raw = normalizeRecoveryCode(input)
  if (raw.length !== CODE_LENGTH || !Array.isArray(codes)) return -1
  for (let i = 0; i < codes.length; i++) {
    if (codes[i]?.h && !codes[i].used && (await bcrypt.compare(raw, codes[i].h))) return i
  }
  return -1
}

/** One line per security-relevant event, in the API log (who did what to whom; never a secret). */
export function auditLog(actor, action, target = '') {
  console.log(`[security] ${new Date().toISOString()} ${actor} ${action}${target ? ` ${target}` : ''}`)
}
