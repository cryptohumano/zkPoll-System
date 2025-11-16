import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import {
  getSs58AddressInfo,
  SS58String,
  fromBufferToBase58 as fromBufferToBase58Factory,
} from './ss58-util'

/**
 * Convierte una dirección SS58 a buffer
 */
function fromBase58ToBuffer(nBytes: number, _ss58Format: number) {
  return (address: SS58String): Uint8Array => {
    const info = getSs58AddressInfo(address)
    if (!info.isValid) throw new Error('Invalid checksum')
    const { publicKey } = info
    if (publicKey.length !== nBytes)
      throw new Error(`Invalid public key length: expected ${nBytes}, got ${publicKey.length}`)

    return publicKey
  }
}

/**
 * Codec para AccountId que maneja conversiones entre SS58 y bytes
 * 
 * @param ss58Format - Formato SS58 (42 para Substrate, 0 para Polkadot, etc.)
 * @param nBytes - Número de bytes (32 para AccountId32, 33 para AccountId33)
 * @returns Objeto con métodos encode/decode
 */
export const AccountId = (ss58Format: number = 42, nBytes: 32 | 33 = 32) => {
  const fromBufferToBase58 = fromBufferToBase58Factory(ss58Format)
  
  return {
    /**
     * Decodifica una dirección SS58 a bytes
     */
    decode: (address: SS58String): Uint8Array => {
      return fromBase58ToBuffer(nBytes, ss58Format)(address)
    },
    
    /**
     * Codifica bytes a dirección SS58
     */
    encode: (buffer: Uint8Array): SS58String => {
      if (buffer.length !== nBytes) {
        throw new Error(`Invalid buffer length: expected ${nBytes}, got ${buffer.length}`)
      }
      return fromBufferToBase58(buffer)
    },
    
    /**
     * Valida una dirección SS58
     */
    isValid: (address: SS58String): boolean => {
      try {
        const decoded = fromBase58ToBuffer(nBytes, ss58Format)(address)
        return decoded.length === nBytes
      } catch {
        return false
      }
    }
  }
}

/**
 * Utilidad para convertir entre H160 (20 bytes) y AccountId32 (32 bytes)
 * Útil para contratos Ink! que usan H160 pero necesitan AccountId32 para queries
 */
export const AccountId32 = AccountId(42, 32)
export const AccountId33 = AccountId(42, 33)

/**
 * Convierte una dirección H160 (hex) a AccountId32 (SS58)
 * Nota: Esto es una conversión directa, no una conversión real de clave
 * Para desarrollo/testing solamente
 */
export function h160ToAccountId32(h160: string, ss58Format: number = 42): string {
  // Remover el prefijo 0x si existe
  const hex = h160.startsWith('0x') ? h160.slice(2) : h160
  
  if (hex.length !== 40) {
    throw new Error(`Invalid H160 length: expected 40 hex chars (20 bytes), got ${hex.length}`)
  }
  
  // Convertir a bytes
  const bytes = Uint8Array.from(Buffer.from(hex, 'hex'))
  
  // Para convertir H160 a AccountId32, necesitamos padding
  // En desarrollo, podemos usar los primeros 20 bytes y rellenar con ceros
  // O mejor, usar una función hash. Por ahora, usamos padding simple
  const padded = new Uint8Array(32)
  padded.set(bytes, 0) // Copiar los 20 bytes al inicio
  // Los últimos 12 bytes quedan en 0
  
  return encodeAddress(padded, ss58Format)
}

/**
 * Convierte AccountId32 a H160 (solo los primeros 20 bytes)
 * Útil para obtener la dirección del contrato en formato H160
 */
export function accountId32ToH160(accountId32: string): string {
  const decoded = decodeAddress(accountId32, false)
  if (decoded.length < 20) {
    throw new Error('AccountId32 must be at least 20 bytes')
  }
  
  // Tomar solo los primeros 20 bytes
  const h160Bytes = decoded.slice(0, 20)
  return '0x' + Buffer.from(h160Bytes).toString('hex')
}

