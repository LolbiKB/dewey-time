/**
 * ZKTeco PUSH protocol fingerprint FID 0–9 (protocol-flow.txt Appendix / §12.6.1).
 * Left hand: little → thumb (0–4), then right hand: thumb → little (5–9).
 */

export const ZK_PROTOCOL_FINGER_LABELS: Record<number, string> = {
  0: 'L-Little',
  1: 'L-Ring',
  2: 'L-Middle',
  3: 'L-Index',
  4: 'L-Thumb',
  5: 'R-Thumb',
  6: 'R-Index',
  7: 'R-Middle',
  8: 'R-Ring',
  9: 'R-Little',
}

export const ZK_PROTOCOL_FINGER_ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const

export const ZK_PROTOCOL_FINGER_GRID_LETTERS: Record<number, string> = {
  0: 'L',
  1: 'R',
  2: 'M',
  3: 'I',
  4: 'T',
  5: 'T',
  6: 'I',
  7: 'M',
  8: 'R',
  9: 'L',
}

export function isValidProtocolFid(fid: number): boolean {
  return Number.isInteger(fid) && fid >= 0 && fid <= 9
}

export function protocolFingerLabel(fid: number): string {
  return ZK_PROTOCOL_FINGER_LABELS[fid] ?? `FID ${fid}`
}

/** Enroll_FP / Enroll_BIO return codes (protocol-flow.txt Appendix 1). */
export const ZK_ENROLL_FP_ERROR_CODES: Record<
  string,
  { label: string; description: string; action?: string }
> = {
  '0': { label: 'Success', description: 'Enrollment completed.' },
  '2': {
    label: 'Already exists',
    description: 'Fingerprint for this finger already exists on the device.',
    action: 'Select a different finger or delete the existing template.',
  },
  '4': {
    label: 'Poor quality',
    description: 'Registration failed — poor print quality or inconsistent samples.',
    action: 'Clean finger and sensor, then try again.',
  },
  '5': {
    label: 'Duplicate',
    description: 'Fingerprint matches another user on the device.',
    action: 'Cannot enroll — use a different finger or check device users.',
  },
  '6': {
    label: 'Cancelled',
    description: 'Registration was cancelled on the device.',
    action: 'Confirm the correct finger slot on the device and try again.',
  },
  '7': {
    label: 'Device busy',
    description: 'Device could not start enrollment.',
    action: 'Wait a moment and try again.',
  },
}

export function parseZkEnrollFpError(errorMessage: string | null | undefined): {
  label: string
  description: string
  action?: string
  code?: string
} {
  if (!errorMessage) return { label: 'Failed', description: 'Enrollment failed.' }

  const codeMatch =
    errorMessage.match(/Return=(\d+)/i) ||
    errorMessage.match(/error\s*(?:code:?)?\s*(\d+)/i)

  if (codeMatch) {
    const code = codeMatch[1]
    const mapped = ZK_ENROLL_FP_ERROR_CODES[code]
    if (mapped) return { code, ...mapped }
    return { code, label: `Error ${code}`, description: errorMessage }
  }

  return { label: 'Failed', description: errorMessage }
}
