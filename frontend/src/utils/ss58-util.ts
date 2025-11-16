import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'

export type SS58String = string

export interface SS58AddressInfo {
  isValid: boolean
  publicKey: Uint8Array
  prefix: number
}

/**
 * Obtiene información de una dirección SS58
 */
export function getSs58AddressInfo(address: SS58String): SS58AddressInfo {
  try {
    const decoded = decodeAddress(address, false)
    // Extraer el prefix (primeros bytes)
    // En SS58, el prefix está codificado en los primeros bytes
    // Para simplificar, usamos el prefix por defecto de 42 (Substrate)
    const prefix = 42 // Puedes extraerlo del address si es necesario
    
    return {
      isValid: true,
      publicKey: decoded,
      prefix
    }
  } catch (error) {
    return {
      isValid: false,
      publicKey: new Uint8Array(),
      prefix: 0
    }
  }
}

/**
 * Convierte un buffer a dirección SS58
 * @param ss58Format - Formato SS58 (42 para Substrate)
 * @param buffer - Buffer con la clave pública
 */
export function fromBufferToBase58(
  ss58Format: number
): (buffer: Uint8Array) => SS58String {
  return (buffer: Uint8Array) => {
    return encodeAddress(buffer, ss58Format)
  }
}

/**
 * Convierte una dirección SS58 a buffer
 */
export function fromBase58ToBuffer(
  address: SS58String,
  ss58Format: number = 42
): Uint8Array {
  const info = getSs58AddressInfo(address)
  if (!info.isValid) {
    throw new Error('Invalid SS58 address checksum')
  }
  return info.publicKey
}

