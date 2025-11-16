/**
 * Utilidades para obtener metadata de polls desde el smart contract
 */

import { ContractPromise } from '@polkadot/api-contract'
import { logger } from './logger'
import { PollMetadata, savePollMetadata, getPollMetadata, updatePollMetadata } from './database'
import { getDevAccounts } from './polkadot'

export interface ContractPollData {
  exists: boolean
  id: number
  title: string
  description: string
  merkleRoot: string
  maxOptions: number
  creator: string
  isActive: boolean
  totalVotes: number
  createdAt: number
  endsAt: number
  voteTallies: number[]
}

/**
 * Obtiene la metadata completa de una poll desde el contrato
 */
export async function getPollMetadataFromContract(
  contract: ContractPromise,
  pollId: number,
  queryAddress?: string
): Promise<ContractPollData | null> {
  try {
    // Obtener dirección de query si no se proporciona
    let address = queryAddress
    if (!address) {
      const devAccounts = await getDevAccounts()
      if (devAccounts.length > 0) {
        address = devAccounts[0].address
      } else {
        throw new Error('No se pudo obtener dirección de query')
      }
    }

    const gasLimit = contract.abi.registry.createType('WeightV2', {
      refTime: 100000000000,
      proofSize: 1000000
    }) as any

    logger.debug(`Obteniendo metadata de poll #${pollId} desde contrato`, { pollId, address }, 'contract')

    // Obtener datos básicos de la poll
    const pollResult = await contract.query.getPoll(
      address,
      { value: 0, gasLimit },
      pollId
    )

    const output = pollResult.output?.toHuman() as any
    if (!output || !output.Ok) {
      logger.warning(`Poll #${pollId} no encontrada en el contrato`, { pollId }, 'contract')
      return null
    }

    // get_poll devuelve: (exists, id, title, description, merkleRoot, maxOptions, creator, isActive, totalVotes, created_at, ends_at)
    const [exists, id, title, description, merkleRoot, maxOptions, creator, isActive, totalVotes, createdAt, endsAt] = output.Ok

    if (!exists) {
      logger.warning(`Poll #${pollId} no existe`, { pollId }, 'contract')
      return null
    }

    // Procesar creator (puede venir como H160 o AccountId32)
    let creatorAddress = ''
    try {
      if (creator) {
        if (typeof creator === 'object' && creator !== null) {
          creatorAddress = Object.values(creator)[0] as string || String(creator)
        } else {
          creatorAddress = String(creator)
        }
      }
    } catch (e) {
      logger.warning('Error procesando creator', { error: e }, 'contract')
      creatorAddress = String(creator || '')
    }

    // Obtener tallies de votos
    let voteTallies: number[] = []
    try {
      const talliesResult = await contract.query.getAllTallies(
        address,
        { value: 0, gasLimit },
        pollId
      )

      const talliesOutput = talliesResult.output?.toHuman() as any
      if (talliesOutput && talliesOutput.Ok && Array.isArray(talliesOutput.Ok)) {
        voteTallies = talliesOutput.Ok.map((t: any) => Number(t || 0))
      }
    } catch (e) {
      logger.warning(`Error obteniendo tallies para poll ${pollId}`, { error: e }, 'contract')
      // Crear array vacío si falla
      voteTallies = Array(Number(maxOptions || 0)).fill(0)
    }

    const pollData: ContractPollData = {
      exists: exists === true,
      id: Number(id || 0),
      title: String(title || ''),
      description: String(description || ''),
      merkleRoot: String(merkleRoot || ''),
      maxOptions: Number(maxOptions || 0),
      creator: creatorAddress,
      isActive: isActive === true,
      totalVotes: Number(totalVotes || 0),
      createdAt: Number(createdAt || 0),
      endsAt: Number(endsAt || 0),
      voteTallies
    }

    logger.success(`Metadata de poll #${pollId} obtenida del contrato`, {
      pollId: pollData.id,
      title: pollData.title,
      maxOptions: pollData.maxOptions,
      totalVotes: pollData.totalVotes,
      isActive: pollData.isActive
    }, 'contract')

    return pollData
  } catch (error: any) {
    logger.error(`Error obteniendo metadata de poll #${pollId} desde contrato`, {
      pollId,
      error: error.message,
      stack: error.stack
    }, 'contract')
    return null
  }
}

/**
 * Sincroniza la metadata de una poll: combina datos del contrato con la BD local
 * Los datos del contrato tienen prioridad (son la fuente de verdad)
 */
export async function syncPollMetadata(
  contract: ContractPromise,
  pollId: number,
  queryAddress?: string
): Promise<PollMetadata | null> {
  try {
    logger.info(`Sincronizando metadata de poll #${pollId}`, { pollId }, 'database')

    // Obtener datos del contrato (fuente de verdad)
    const contractData = await getPollMetadataFromContract(contract, pollId, queryAddress)
    if (!contractData) {
      logger.warning(`No se pudo obtener datos del contrato para poll #${pollId}`, { pollId }, 'database')
      return null
    }

    // Obtener datos de la BD local (puede tener datos adicionales como optionNames)
    const localMetadata = await getPollMetadata(pollId)

    // Combinar: datos del contrato + datos adicionales de la BD local
    const syncedMetadata: PollMetadata = {
      pollId: contractData.id,
      // Datos del contrato (prioridad)
      title: contractData.title,
      description: contractData.description,
      maxOptions: contractData.maxOptions,
      isActive: contractData.isActive,
      totalVotes: contractData.totalVotes,
      creator: contractData.creator,
      endsAt: contractData.endsAt,
      createdAt: contractData.createdAt,
      // Datos adicionales de la BD local (si existen)
      optionNames: localMetadata?.optionNames || [],
      duration: localMetadata?.duration || 0,
      // Metadata de blockchain (de la BD local si existe, o usar datos del contrato)
      blockNumber: localMetadata?.blockNumber,
      blockHash: localMetadata?.blockHash,
      transactionHash: localMetadata?.transactionHash,
      chainMetadata: localMetadata?.chainMetadata,
      // Timestamp de sincronización
      lastSynced: Date.now()
    }

    // Guardar/actualizar en la BD local
    await savePollMetadata(syncedMetadata)

    logger.success(`Poll #${pollId} sincronizada exitosamente`, {
      pollId,
      hasOptionNames: syncedMetadata.optionNames.length > 0,
      hasBlockData: !!syncedMetadata.blockNumber
    }, 'database')

    return syncedMetadata
  } catch (error: any) {
    logger.error(`Error sincronizando poll #${pollId}`, {
      pollId,
      error: error.message
    }, 'database')
    return null
  }
}

/**
 * Sincroniza todas las polls del contrato con la BD local
 */
export async function syncAllPollsMetadata(
  contract: ContractPromise,
  queryAddress?: string
): Promise<PollMetadata[]> {
  try {
    logger.info('Sincronizando todas las polls del contrato', null, 'database')

    // Obtener total de polls
    let address = queryAddress
    if (!address) {
      const devAccounts = await getDevAccounts()
      if (devAccounts.length > 0) {
        address = devAccounts[0].address
      }
    }

    if (!address) {
      throw new Error('No se pudo obtener dirección de query')
    }

    const gasLimit = contract.abi.registry.createType('WeightV2', {
      refTime: 100000000000,
      proofSize: 1000000
    }) as any

    const totalResult = await contract.query.getTotalPolls(
      address,
      { value: 0, gasLimit }
    )

    // Parsear resultado (mismo código que en PollList)
    let totalPolls = 0
    const output = totalResult.output
    
    // PRIORIDAD 1: Intentar toHuman() primero
    try {
      if (output && typeof output === 'object' && 'toHuman' in output) {
        const humanOutput = (output as any).toHuman()
        if (humanOutput && typeof humanOutput === 'object') {
          if ('Ok' in humanOutput) {
            const okValue = humanOutput.Ok
            totalPolls = typeof okValue === 'string' ? Number(okValue) || 0 : (typeof okValue === 'number' ? okValue : 0)
          } else if ('ok' in humanOutput) {
            const okValue = humanOutput.ok
            totalPolls = typeof okValue === 'string' ? Number(okValue) || 0 : (typeof okValue === 'number' ? okValue : 0)
          }
        }
      }
    } catch (e) {
      // Continuar con otros métodos
    }
    
    // PRIORIDAD 2: Si no se pudo parsear desde human, intentar métodos directos
    if (totalPolls === 0 && output) {
      if (typeof output === 'object' && 'ok' in output) {
        const okValue = (output as any).ok
        totalPolls = typeof okValue === 'number' ? okValue : Number(okValue) || 0
      } else if (typeof output === 'object' && 'Ok' in output) {
        const okValue = (output as any).Ok
        if (typeof okValue === 'object' && 'toNumber' in okValue) {
          totalPolls = okValue.toNumber() || 0
        } else {
          totalPolls = Number(okValue) || 0
        }
      } else if (typeof output === 'object' && 'toNumber' in output) {
        const numValue = (output as any).toNumber()
        if (numValue > 0) {
          totalPolls = numValue
        }
      }
    }

    logger.info(`Total de polls a sincronizar: ${totalPolls}`, { totalPolls }, 'database')

    const syncedPolls: PollMetadata[] = []

    // Sincronizar cada poll
    for (let i = 1; i <= totalPolls; i++) {
      try {
        const metadata = await syncPollMetadata(contract, i, address)
        if (metadata) {
          syncedPolls.push(metadata)
        }
      } catch (e: any) {
        logger.warning(`Error sincronizando poll #${i}`, { pollId: i, error: e.message }, 'database')
      }
    }

    logger.success(`${syncedPolls.length} polls sincronizadas exitosamente`, {
      total: totalPolls,
      synced: syncedPolls.length
    }, 'database')

    return syncedPolls
  } catch (error: any) {
    logger.error('Error sincronizando todas las polls', {
      error: error.message,
      stack: error.stack
    }, 'database')
    return []
  }
}

