// Base de datos local para almacenar metadata de polls y votos
// Usa IndexedDB para persistencia
import { logger } from './logger'

export interface PollMetadata {
  pollId: number
  // Datos del formulario (guardados localmente)
  title: string
  description: string
  optionNames: string[]
  maxOptions: number
  duration: number // Duración en segundos
  endsAt: number // Timestamp de finalización (calculado)
  createdAt: number
  // Metadata de la blockchain
  blockNumber?: number
  blockHash?: string
  transactionHash?: string
  chainMetadata?: {
    chainName: string
    chainId: string
    specVersion?: string
  }
  // Datos adicionales del contrato para sincronización
  totalVotes?: number
  isActive?: boolean
  creator?: string
  lastSynced?: number // Timestamp de última sincronización con el contrato
}

interface VoteRecord {
  pollId: number
  optionIndex: number
  timestamp: number
  blockNumber?: number
  transactionHash?: string
}

const DB_NAME = 'zk-anonymous-poll-db'
const DB_VERSION = 1
const STORE_POLLS = 'polls'
const STORE_VOTES = 'votes'

let dbInstance: IDBDatabase | null = null

export async function initDatabase(): Promise<IDBDatabase> {
  if (dbInstance) {
    logger.debug('Base de datos ya inicializada', null, 'database')
    return dbInstance
  }

  return new Promise((resolve, reject) => {
    logger.info('Inicializando base de datos IndexedDB...', { name: DB_NAME, version: DB_VERSION }, 'database')
    
    // Verificar si IndexedDB está disponible
    if (!window.indexedDB) {
      const error = new Error('IndexedDB no está disponible en este navegador')
      logger.error('IndexedDB no disponible', error, 'database')
      reject(error)
      return
    }
    
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = (event) => {
      const error = (event.target as IDBOpenDBRequest).error
      logger.error('Error abriendo la base de datos', { 
        error: error?.message,
        name: error?.name,
        code: (error as any)?.code
      }, 'database')
      reject(new Error(`Error abriendo la base de datos: ${error?.message || 'Unknown error'}`))
    }

    request.onsuccess = () => {
      dbInstance = request.result
      const stores = Array.from(dbInstance.objectStoreNames)
      logger.success('Base de datos IndexedDB inicializada correctamente', {
        name: DB_NAME,
        version: DB_VERSION,
        stores
      }, 'database')
      
      // Verificar que los stores existan
      if (!stores.includes(STORE_POLLS)) {
        logger.warning('Store de polls no encontrado, puede requerir upgrade', null, 'database')
      }
      if (!stores.includes(STORE_VOTES)) {
        logger.warning('Store de votes no encontrado, puede requerir upgrade', null, 'database')
      }
      
      resolve(dbInstance)
    }

    request.onupgradeneeded = (event) => {
      const target = event.target as IDBOpenDBRequest
      const oldVersion = (event as any).oldVersion || target.result?.version || 0
      logger.info('Actualizando esquema de base de datos...', {
        oldVersion,
        newVersion: DB_VERSION
      }, 'database')
      
      const db = (event.target as IDBOpenDBRequest).result

      // Eliminar stores antiguos si existen (para recrearlos)
      if (db.objectStoreNames.contains(STORE_POLLS)) {
        logger.debug('Eliminando store de polls antiguo', null, 'database')
        db.deleteObjectStore(STORE_POLLS)
      }
      if (db.objectStoreNames.contains(STORE_VOTES)) {
        logger.debug('Eliminando store de votes antiguo', null, 'database')
        db.deleteObjectStore(STORE_VOTES)
      }

      // Crear store para polls
      logger.info(`Creando store: ${STORE_POLLS}`, null, 'database')
      const pollStore = db.createObjectStore(STORE_POLLS, { keyPath: 'pollId' })
      pollStore.createIndex('createdAt', 'createdAt', { unique: false })
      logger.success(`Store ${STORE_POLLS} creado`, null, 'database')

      // Crear store para votes
      logger.info(`Creando store: ${STORE_VOTES}`, null, 'database')
      const voteStore = db.createObjectStore(STORE_VOTES, { keyPath: ['pollId', 'timestamp'] })
      voteStore.createIndex('pollId', 'pollId', { unique: false })
      voteStore.createIndex('timestamp', 'timestamp', { unique: false })
      logger.success(`Store ${STORE_VOTES} creado`, null, 'database')
      
      logger.success('Esquema de base de datos actualizado', {
        stores: Array.from(db.objectStoreNames)
      }, 'database')
    }
    
    request.onblocked = () => {
      logger.warning('Base de datos bloqueada, esperando cierre de otras conexiones...', null, 'database')
    }
  })
}

export async function savePollMetadata(metadata: PollMetadata): Promise<void> {
  logger.database('Guardando metadata de poll en IndexedDB', {
    pollId: metadata.pollId,
    title: metadata.title,
    description: metadata.description,
    optionNames: metadata.optionNames,
    maxOptions: metadata.maxOptions,
    duration: metadata.duration,
    endsAt: metadata.endsAt
  })
  
  // Validar que los campos requeridos estén presentes
  if (!metadata.pollId) {
    const error = new Error('pollId es requerido')
    logger.error('Error validando metadata', error, 'database')
    throw error
  }
  
  if (!metadata.title) {
    logger.warning('Metadata sin título, se guardará de todas formas', { pollId: metadata.pollId }, 'database')
  }
  
  const db = await initDatabase()
  const stores = Array.from(db.objectStoreNames)
  logger.debug('Base de datos obtenida', { stores }, 'database')
  
  if (!stores.includes(STORE_POLLS)) {
    const error = new Error(`Store ${STORE_POLLS} no existe en la base de datos`)
    logger.error('Store no encontrado', { stores, expected: STORE_POLLS }, 'database')
    throw error
  }
  
  return new Promise((resolve, reject) => {
    try {
      const transaction = db.transaction([STORE_POLLS], 'readwrite')
      logger.debug('Transacción creada', { mode: 'readwrite' }, 'database')
      
      transaction.onerror = (event) => {
        const error = (event.target as IDBTransaction).error
        logger.error('Error en transacción', {
          name: error?.name,
          message: error?.message,
          code: (error as any)?.code
        }, 'database')
        reject(new Error(`Error en transacción: ${error?.message || 'Unknown error'}`))
      }
      
      transaction.oncomplete = () => {
        logger.debug('Transacción completada exitosamente', null, 'database')
      }
      
      const store = transaction.objectStore(STORE_POLLS)
      logger.debug('Object store obtenido', { store: STORE_POLLS }, 'database')
      
      // Validar que el objeto tenga la estructura correcta
      const dataToSave: PollMetadata = {
        pollId: metadata.pollId,
        title: metadata.title || '',
        description: metadata.description || '',
        optionNames: metadata.optionNames || [],
        maxOptions: metadata.maxOptions || 0,
        duration: metadata.duration || 0,
        endsAt: metadata.endsAt || 0,
        createdAt: metadata.createdAt || Date.now(),
        blockNumber: metadata.blockNumber,
        blockHash: metadata.blockHash,
        transactionHash: metadata.transactionHash,
        chainMetadata: metadata.chainMetadata,
        totalVotes: metadata.totalVotes,
        isActive: metadata.isActive,
        creator: metadata.creator,
        lastSynced: metadata.lastSynced
      }
      
      logger.debug('Datos a guardar', dataToSave, 'database')
      const request = store.put(dataToSave)
      logger.debug('Request de put creado', { pollId: metadata.pollId }, 'database')

      request.onsuccess = () => {
        logger.success('Metadata guardada exitosamente', { 
          pollId: metadata.pollId,
          title: metadata.title,
          optionCount: metadata.optionNames?.length || 0
        }, 'database')
        
        // Verificar que se guardó correctamente
        const verifyRequest = store.get(metadata.pollId)
        verifyRequest.onsuccess = () => {
          if (verifyRequest.result) {
            logger.success('Verificación: Metadata encontrada en BD', {
              pollId: verifyRequest.result.pollId,
              hasTitle: !!verifyRequest.result.title,
              hasDescription: !!verifyRequest.result.description,
              optionCount: verifyRequest.result.optionNames?.length || 0
            }, 'database')
          } else {
            logger.error('Verificación: No se encontró metadata después de guardar', {
              pollId: metadata.pollId
            }, 'database')
          }
        }
        verifyRequest.onerror = () => {
          logger.warning('Error al verificar metadata guardada', {
            error: verifyRequest.error
          }, 'database')
        }
        resolve()
      }
      
      request.onerror = (event) => {
        const error = (event.target as IDBRequest).error
        logger.error('Error en request de put', { 
          name: error?.name, 
          message: error?.message, 
          code: (error as any)?.code,
          pollId: metadata.pollId
        }, 'database')
        reject(new Error(`Error guardando metadata de poll: ${error?.message || 'Unknown error'}`))
      }
    } catch (error: any) {
      logger.error('Error creando transacción', {
        message: error.message,
        stack: error.stack
      }, 'database')
      reject(error)
    }
  })
}

export async function getPollMetadata(pollId: number): Promise<PollMetadata | null> {
  const db = await initDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_POLLS], 'readonly')
    const store = transaction.objectStore(STORE_POLLS)
    const request = store.get(pollId)

    request.onsuccess = () => {
      resolve(request.result || null)
    }
    request.onerror = () => {
      reject(new Error('Error obteniendo metadata de poll'))
    }
  })
}

export async function getAllPollMetadata(): Promise<PollMetadata[]> {
  const db = await initDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_POLLS], 'readonly')
    const store = transaction.objectStore(STORE_POLLS)
    const request = store.getAll()

    request.onsuccess = () => {
      resolve(request.result || [])
    }
    request.onerror = () => {
      reject(new Error('Error obteniendo todas las metadata de polls'))
    }
  })
}

export async function saveVoteRecord(vote: VoteRecord): Promise<void> {
  const db = await initDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_VOTES], 'readwrite')
    const store = transaction.objectStore(STORE_VOTES)
    const request = store.put(vote)

    request.onsuccess = () => resolve()
    request.onerror = () => reject(new Error('Error guardando registro de voto'))
  })
}

export async function getVotesForPoll(pollId: number): Promise<VoteRecord[]> {
  const db = await initDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_VOTES], 'readonly')
    const store = transaction.objectStore(STORE_VOTES)
    const index = store.index('pollId')
    const request = index.getAll(pollId)

    request.onsuccess = () => {
      resolve(request.result || [])
    }
    request.onerror = () => {
      reject(new Error('Error obteniendo votos de poll'))
    }
  })
}

/**
 * Función de utilidad para verificar el estado de la base de datos
 * Útil para debugging
 */
export async function debugDatabase(): Promise<void> {
  try {
    const db = await initDatabase()
    logger.info('Estado de la base de datos', {
      name: DB_NAME,
      version: DB_VERSION,
      stores: Array.from(db.objectStoreNames)
    }, 'database')
    
    // Contar polls
    const polls = await getAllPollMetadata()
    logger.info(`Total de polls en BD: ${polls.length}`, { count: polls.length }, 'database')
    if (polls.length > 0) {
      logger.info('Polls en BD:', polls, 'database')
      polls.forEach(poll => {
        const hasTitle = !!poll.title
        const hasDescription = !!poll.description
        const hasOptions = poll.optionNames && poll.optionNames.length > 0
        logger.info(`Poll #${poll.pollId}`, {
          pollId: poll.pollId,
          hasTitle,
          hasDescription,
          hasOptions,
          optionCount: poll.optionNames?.length || 0,
          maxOptions: poll.maxOptions,
          duration: poll.duration,
          endsAt: poll.endsAt
        }, 'database')
      })
    }
  } catch (error: any) {
    logger.error('Error en debugDatabase', error, 'database')
  }
}

/**
 * Actualiza una poll existente con datos adicionales del contrato
 * Útil para polls creadas antes de agregar los campos title, description, etc.
 */
export async function updatePollMetadata(
  pollId: number,
  updates: Partial<PollMetadata>
): Promise<void> {
  try {
    const existing = await getPollMetadata(pollId)
    if (!existing) {
      throw new Error(`Poll ${pollId} no encontrada en la BD`)
    }
    
    const updated: PollMetadata = {
      ...existing,
      ...updates,
      pollId // Asegurar que pollId no se sobrescriba
    }
    
    await savePollMetadata(updated)
    logger.success(`Poll ${pollId} actualizada`, { pollId, updates }, 'database')
  } catch (error: any) {
    logger.error(`Error actualizando poll ${pollId}`, error, 'database')
    throw error
  }
}

/**
 * Fuerza la recreación de la base de datos
 * Útil para resolver problemas de esquema o datos corruptos
 */
export async function recreateDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    logger.info('Eliminando base de datos existente...', { name: DB_NAME }, 'database')
    
    const deleteRequest = indexedDB.deleteDatabase(DB_NAME)
    
    deleteRequest.onsuccess = () => {
      logger.success('Base de datos eliminada', null, 'database')
      // Resetear la instancia
      dbInstance = null
      // Recrear la BD
      initDatabase()
        .then(() => {
          logger.success('Base de datos recreada exitosamente', null, 'database')
          resolve()
        })
        .catch(reject)
    }
    
    deleteRequest.onerror = () => {
      const error = deleteRequest.error
      logger.error('Error eliminando base de datos', error, 'database')
      reject(error)
    }
    
    deleteRequest.onblocked = () => {
      logger.warning('Base de datos bloqueada, cierra otras pestañas y reintenta', null, 'database')
      reject(new Error('Base de datos bloqueada'))
    }
  })
}

// Exponer función para recrear BD desde la consola
if (typeof window !== 'undefined') {
  (window as any).recreatePollDatabase = recreateDatabase
}

