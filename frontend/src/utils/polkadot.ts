import { web3Accounts, web3Enable, web3FromAddress } from '@polkadot/extension-dapp'
import { ApiPromise } from '@polkadot/api'
import { decodeAddress, encodeAddress } from '@polkadot/util-crypto'
import { Keyring } from '@polkadot/keyring'
import { cryptoWaitReady } from '@polkadot/util-crypto'

export interface AccountInfo {
  address: string
  meta: {
    name?: string
    source: string
  }
  isDevAccount?: boolean
}

// Cuentas de desarrollo para ink-node local
const DEV_ACCOUNTS = ['//Alice', '//Bob', '//Charlie', '//Dave', '//Eve', '//Ferdie']

// Keyring global para mantener los pares
let globalKeyring: Keyring | null = null

async function getKeyring(): Promise<Keyring> {
  if (!globalKeyring) {
    await cryptoWaitReady()
    globalKeyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
    // Pre-agregar todas las cuentas de desarrollo
    DEV_ACCOUNTS.forEach(seed => {
      try {
        globalKeyring!.addFromUri(seed)
      } catch (e) {
        // Si ya existe, ignorar el error
        console.debug(`Cuenta ${seed} ya existe en keyring`)
      }
    })
  }
  return globalKeyring
}

export async function getDevAccounts(): Promise<AccountInfo[]> {
  const keyring = await getKeyring()
  
  return DEV_ACCOUNTS.map(seed => {
    // Crear un keyring temporal para obtener la dirección sin modificar el global
    const tempKeyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
    const tempPair = tempKeyring.addFromUri(seed)
    const address = tempPair.address
    
    // Asegurarnos de que el par esté en el keyring global
    let pair
    try {
      pair = keyring.getPair(address)
    } catch {
      // Si no existe, agregarlo
      pair = keyring.addFromUri(seed)
    }
    
    return {
      address: pair.address,
      meta: {
        name: seed,
        source: 'development'
      },
      isDevAccount: true
    }
  })
}

export async function connectPolkadotExtension(): Promise<AccountInfo[]> {
  try {
    const extensions = await web3Enable('ZK Anonymous Poll')
    if (extensions.length === 0) {
      throw new Error('No Polkadot extension found. Please install Polkadot.js extension.')
    }

    const accounts = await web3Accounts()
    if (accounts.length === 0) {
      throw new Error('No accounts found. Please create an account in Polkadot.js extension.')
    }

    // Filtrar solo cuentas Substrate (AccountId32 = 32 bytes)
    // y eliminar duplicados basados en address
    const seen = new Set<string>()
    const substrateAccounts = accounts
      .filter(acc => {
        // Validar que la dirección sea Substrate (32 bytes) y no Ethereum (20 bytes)
        try {
          const address = acc.address
          
          // Rechazar direcciones Ethereum (0x... con 42 caracteres)
          if (address.startsWith('0x') && address.length === 42) {
            return false
          }
          
          // Intentar decodificar la dirección SS58 para verificar que es válida
          // Si decodifica correctamente, es una cuenta Substrate
          const decoded = decodeAddress(address)
          // AccountId32 debe tener exactamente 32 bytes
          return decoded.length === 32
        } catch {
          // Si no se puede decodificar, no es una cuenta Substrate válida
          return false
        }
      })
      .filter(acc => {
        // Eliminar duplicados basados en la dirección normalizada
        try {
          // Normalizar la dirección para comparación
          const normalized = encodeAddress(decodeAddress(acc.address))
          if (seen.has(normalized)) {
            return false
          }
          seen.add(normalized)
          return true
        } catch {
          return false
        }
      })
      .map(acc => ({
        address: acc.address,
        meta: {
          name: acc.meta.name,
          source: acc.meta.source
        }
      }))

    if (substrateAccounts.length === 0) {
      throw new Error('No se encontraron cuentas Substrate compatibles. Por favor, crea una cuenta Substrate (no Ethereum) en la extensión de Polkadot.js')
    }

    return substrateAccounts
  } catch (error: any) {
    throw new Error(`Error connecting to Polkadot extension: ${error.message}`)
  }
}

// Cache de pares por dirección para evitar recrearlos
const pairCache = new Map<string, any>()

export async function getPairForAddress(address: string): Promise<any> {
  if (pairCache.has(address)) {
    return pairCache.get(address)
  }
  
  const keyring = await getKeyring()
  
  // Buscar el par en el keyring
  let pair
  try {
    pair = keyring.getPair(address)
  } catch {
    // Si no está, intentar encontrarlo por seed y agregarlo
    for (const seed of DEV_ACCOUNTS) {
      const tempKeyring = new Keyring({ type: 'sr25519', ss58Format: 42 })
      const tempPair = tempKeyring.addFromUri(seed)
      if (tempPair.address === address) {
        pair = keyring.addFromUri(seed)
        break
      }
    }
  }
  
  if (!pair) {
    throw new Error(`Cuenta de desarrollo no encontrada: ${address}`)
  }
  
  pairCache.set(address, pair)
  return pair
}

export async function setApiSigner(api: ApiPromise, address: string, isDevAccount?: boolean) {
  if (isDevAccount) {
    // Para cuentas de desarrollo, no necesitamos configurar el signer global
    // porque pasaremos el par directamente a signAndSend
    // Pero podemos configurarlo por si acaso
    const pair = await getPairForAddress(address)
    
    // Crear un signer wrapper para KeyringPair según la interfaz correcta
    // Ver: https://github.com/polkadot-api/polkadot-api/blob/main/packages/signers/pjs-signer/src/types.ts
    api.setSigner({
      signPayload: async (payload: any): Promise<{ signature: string; signedTransaction?: string | Uint8Array }> => {
        // payload es SignerPayloadJSON
        // Necesitamos construir el mensaje a firmar desde el payload
        const message = api.registry.createType('ExtrinsicPayload', payload, {
          version: payload.version
        })
        const signed = pair.sign(message.toU8a({ method: true }))
        return {
          signature: `0x${Buffer.from(signed).toString('hex')}`,
        }
      },
      signRaw: async (raw: { address: string; data: string; type: "bytes" }): Promise<{ id: number; signature: string }> => {
        // raw.data es un HexString
        const data = raw.data.startsWith('0x') ? raw.data.slice(2) : raw.data
        const message = Uint8Array.from(Buffer.from(data, 'hex'))
        const signed = pair.sign(message)
        return {
          id: 0,
          signature: `0x${Buffer.from(signed).toString('hex')}`,
        }
      }
    } as any)
  } else {
    // Para cuentas de extensión, usar injector
    const injector = await web3FromAddress(address)
    api.setSigner(injector.signer)
  }
}

